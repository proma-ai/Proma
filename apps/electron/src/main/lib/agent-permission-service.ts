/**
 * Agent 权限服务
 *
 * 核心职责：
 * - 实现 canUseTool 回调（供 SDK query 使用）
 * - 管理 pending 权限请求（Promise + Map 模式）
 * - 维护会话级白名单
 * - 工具/命令分类判断
 *
 * 参考 Craft Agents OSS 的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import type {
  PromaPermissionMode,
  PermissionRequest,
  DangerLevel,
  AskUserRequest,
} from '@proma/shared'
import {
  SAFE_TOOLS,
  isSafeBashCommand,
  isDangerousCommand,
  hasDangerousStructure,
} from '@proma/shared'

/** SDK PermissionResult 类型（避免直接依赖 SDK 内部类型） */
type PermissionResult = {
  behavior: 'allow'
  /** SDK CLI 的 Zod 校验要求此字段为 record 类型，不能省略 */
  updatedInput: Record<string, unknown>
} | {
  behavior: 'deny'
  message: string
  interrupt?: boolean
}

/** canUseTool 回调的 options 参数 */
interface CanUseToolOptions {
  signal: AbortSignal
  toolUseID: string
  decisionReason?: string
  suggestions?: unknown[]
}

/** 待处理的权限请求 */
interface PendingPermission {
  resolve: (result: PermissionResult) => void
  request: PermissionRequest
}

/** 会话级白名单 */
interface SessionWhitelist {
  /** 总是允许的工具名（如 'Write', 'Edit'） */
  allowedTools: Set<string>
  /** 总是允许的 Bash 基础命令（如 'git push', 'npm install'） */
  allowedBashCommands: Set<string>
}

/**
 * Agent 权限服务
 *
 * 单例模式，管理所有会话的权限状态。
 */
export class AgentPermissionService {
  /** 待处理的权限请求 Map（requestId → PendingPermission） */
  private pendingPermissions = new Map<string, PendingPermission>()

  /** 会话级白名单 Map（sessionId → SessionWhitelist） */
  private sessionWhitelists = new Map<string, SessionWhitelist>()

  /**
   * 创建 canUseTool 回调（绑定到特定会话和模式）
   *
   * 返回的函数签名匹配 SDK 的 CanUseTool 类型。
   */
  createCanUseTool(
    sessionId: string,
    mode: PromaPermissionMode,
    sendToRenderer: (request: PermissionRequest) => void,
    askUserHandler?: (sessionId: string, input: Record<string, unknown>, signal: AbortSignal, sendToRenderer: (request: AskUserRequest) => void) => Promise<PermissionResult>,
    sendAskUserToRenderer?: (request: AskUserRequest) => void,
  ): (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult> {
    return async (toolName, input, options) => {
      // AskUserQuestion 拦截：委托给交互式问答服务
      if (toolName === 'AskUserQuestion' && askUserHandler && sendAskUserToRenderer) {
        return askUserHandler(sessionId, input, options.signal, sendAskUserToRenderer)
      }

      const allow = (): PermissionResult => ({ behavior: 'allow' as const, updatedInput: input })

      // 自动模式：全部允许（理论上不会到这里，auto 模式使用 bypassPermissions）
      if (mode === 'auto') return allow()

      // 智能模式：只读工具自动允许
      if (mode === 'smart') {
        if (this.isReadOnlyTool(toolName, input)) return allow()
        if (this.isWhitelisted(sessionId, toolName, input)) return allow()
      }

      // 监督模式：安全工具自动允许 + 检查白名单
      if (mode === 'supervised') {
        if (this.isReadOnlyTool(toolName, input)) return allow()
        if (this.isWhitelisted(sessionId, toolName, input)) return allow()
      }

      // 需要询问用户：构建请求并发送到 UI
      const request = this.buildPermissionRequest(sessionId, toolName, input, options)
      sendToRenderer(request)

      return new Promise<PermissionResult>((resolve) => {
        this.pendingPermissions.set(request.requestId, { resolve, request })

        // 如果 signal 被中止，自动拒绝
        options.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.has(request.requestId)) {
            this.pendingPermissions.delete(request.requestId)
            resolve({ behavior: 'deny' as const, message: '操作已中止' })
          }
        }, { once: true })
      })
    }
  }

  /**
   * 响应权限请求（由 IPC handler 调用）
   *
   * @returns 对应的 sessionId，用于向渲染进程发送 resolved 事件；未找到请求时返回 null
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', alwaysAllow: boolean): string | null {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId

    // "总是允许"选项：加入会话白名单
    if (alwaysAllow && behavior === 'allow') {
      this.addToWhitelist(sessionId, pending.request.toolName, pending.request.toolInput)
    }

    pending.resolve(
      behavior === 'allow'
        ? { behavior: 'allow' as const, updatedInput: pending.request.toolInput }
        : { behavior: 'deny' as const, message: '用户拒绝了此操作' }
    )
    this.pendingPermissions.delete(requestId)
    return sessionId
  }

  /**
   * 清除指定会话的所有待处理请求（会话结束或中止时调用）
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ behavior: 'deny' as const, message: '会话已结束' })
        this.pendingPermissions.delete(requestId)
      }
    }
  }

  /**
   * 清除指定会话的白名单（会话结束时调用）
   */
  clearSessionWhitelist(sessionId: string): void {
    this.sessionWhitelists.delete(sessionId)
  }

  // ===== 工具分类判断 =====

  /**
   * 判断工具是否为只读操作（智能模式下自动允许）
   */
  private isReadOnlyTool(toolName: string, input: Record<string, unknown>): boolean {
    // 安全工具白名单
    if (SAFE_TOOLS.includes(toolName)) return true

    // Bash 工具：检查命令是否匹配安全模式
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      return isSafeBashCommand(command)
    }

    return false
  }

  /**
   * 判断工具/命令是否在会话白名单中
   */
  private isWhitelisted(sessionId: string, toolName: string, input: Record<string, unknown>): boolean {
    const whitelist = this.sessionWhitelists.get(sessionId)
    if (!whitelist) return false

    // 非 Bash 工具：检查工具名是否在白名单中
    if (toolName !== 'Bash') {
      return whitelist.allowedTools.has(toolName)
    }

    // Bash 工具：即使基础命令在白名单中，也要重新检查完整命令的安全性
    const command = typeof input.command === 'string' ? input.command : ''
    if (hasDangerousStructure(command)) return false
    if (isDangerousCommand(command)) return false
    const baseCommand = this.extractBaseCommand(command)
    return whitelist.allowedBashCommands.has(baseCommand)
  }

  /**
   * 将工具/命令加入会话白名单
   */
  private addToWhitelist(sessionId: string, toolName: string, input: Record<string, unknown>): void {
    const whitelist = this.getOrCreateWhitelist(sessionId)

    if (toolName !== 'Bash') {
      whitelist.allowedTools.add(toolName)
    } else {
      const command = typeof input.command === 'string' ? input.command : ''
      const baseCommand = this.extractBaseCommand(command)
      if (baseCommand) {
        whitelist.allowedBashCommands.add(baseCommand)
      }
    }
  }

  /**
   * 获取或创建会话白名单
   */
  private getOrCreateWhitelist(sessionId: string): SessionWhitelist {
    const existing = this.sessionWhitelists.get(sessionId)
    if (existing) return existing

    const whitelist: SessionWhitelist = {
      allowedTools: new Set(),
      allowedBashCommands: new Set(),
    }
    this.sessionWhitelists.set(sessionId, whitelist)
    return whitelist
  }

  /**
   * 提取 Bash 命令的基础命令（用于白名单匹配）
   *
   * 提取前两个词（如 "git push"、"npm install"）或第一个词（如 "ls"）。
   */
  private extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/)
    // 两词组合命令（git push, npm install 等）
    if (parts.length >= 2 && ['git', 'npm', 'bun', 'yarn', 'pnpm'].includes(parts[0]!)) {
      return `${parts[0]} ${parts[1]}`
    }
    return parts[0] ?? ''
  }

  /**
   * 构建权限请求对象
   */
  private buildPermissionRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): PermissionRequest {
    const command = toolName === 'Bash' && typeof input.command === 'string'
      ? input.command
      : undefined

    return {
      requestId: randomUUID(),
      sessionId,
      toolName,
      toolInput: input,
      description: this.buildDescription(toolName, input),
      command,
      dangerLevel: this.assessDangerLevel(toolName, input),
      decisionReason: options.decisionReason,
    }
  }

  /**
   * 生成人类可读的操作描述
   */
  private buildDescription(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return typeof input.command === 'string'
          ? `执行命令: ${input.command.slice(0, 200)}`
          : '执行 Bash 命令'
      case 'Write':
        return typeof input.file_path === 'string'
          ? `写入文件: ${input.file_path}`
          : '写入文件'
      case 'Edit':
        return typeof input.file_path === 'string'
          ? `编辑文件: ${input.file_path}`
          : '编辑文件'
      case 'NotebookEdit':
        return typeof input.notebook_path === 'string'
          ? `编辑 Notebook: ${input.notebook_path}`
          : '编辑 Notebook'
      case 'Task':
        return typeof input.description === 'string'
          ? `启动子任务: ${input.description}`
          : '启动子任务'
      default:
        return `使用工具: ${toolName}`
    }
  }

  /**
   * 评估操作的危险等级
   */
  private assessDangerLevel(toolName: string, input: Record<string, unknown>): DangerLevel {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (isDangerousCommand(command)) return 'dangerous'
      if (hasDangerousStructure(command)) return 'normal'
      return 'normal'
    }

    // 文件写入操作默认为 normal
    if (['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return 'normal'

    // Task 工具默认为 normal
    if (toolName === 'Task') return 'normal'

    return 'normal'
  }
}

/** 全局权限服务实例 */
export const permissionService = new AgentPermissionService()
