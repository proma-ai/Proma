/**
 * Agent ExitPlanMode 计划审批服务
 *
 * 核心职责：
 * - 拦截 ExitPlanMode 工具调用
 * - 解析 allowedPrompts 和经校验的计划文档，发送到渲染进程展示审批 UI
 * - 等待用户选择（批准/拒绝/反馈），返回对应 PermissionResult
 * - 根据用户选择切换权限模式
 *
 * 复用 AskUserService 的 Promise + Map 异步等待模式。
 */

import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ExitPlanModeRequest,
  ExitPlanModeResponse,
  ExitPlanAllowedPrompt,
  ExitPlanDocument,
  PromaPermissionMode,
} from '@proma/shared'

/** ExitPlanMode 审批结果（扩展 SDK PermissionResult，附加 targetMode） */
export type ExitPlanPermissionResult = {
  behavior: 'allow'
  updatedInput: Record<string, unknown>
  /** 用户选择的目标权限模式 */
  targetMode?: PromaPermissionMode
} | {
  behavior: 'deny'
  message: string
}

/** 待处理的 ExitPlanMode 请求 */
interface PendingExitPlan {
  resolve: (result: ExitPlanPermissionResult) => void
  request: ExitPlanModeRequest
  toolInput: Record<string, unknown>
  /** 审批前复核路径归属与内容版本，防止符号链接或文件替换绕过初始校验。 */
  planDirectory?: string
}

/** ExitPlanMode 审批结果回调（通知编排层切换权限模式） */
export interface ExitPlanModeCallbacks {
  /** 切换权限模式 */
  onPermissionModeChange: (mode: PromaPermissionMode) => void
}

/**
 * Agent ExitPlanMode 计划审批服务
 *
 * 单例模式，管理所有会话的 ExitPlanMode 请求。
 */
const MAX_PLAN_DOCUMENT_BYTES = 1024 * 1024

export class AgentExitPlanService {
  /** 待处理的请求 Map（requestId → PendingExitPlan） */
  private pendingRequests = new Map<string, PendingExitPlan>()

  /**
   * 处理 ExitPlanMode 工具调用
   *
   * 解析 allowedPrompts 与计划 Markdown 工件，发送到渲染进程，阻塞等待用户选择。
   */
  handleExitPlanMode(
    sessionId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    sendToRenderer: (request: ExitPlanModeRequest) => void,
    options?: { planDirectory?: string },
  ): Promise<ExitPlanPermissionResult> {
    console.log(`[ExitPlanService] handleExitPlanMode 开始: sessionId=${sessionId}, signal.aborted=${signal.aborted}`)
    const allowedPrompts = this.parseAllowedPrompts(input)
    const planDocument = this.resolvePlanDocument(input.planFile, options?.planDirectory)
    if (!planDocument) {
      return Promise.resolve({
        behavior: 'deny' as const,
        message: '提交计划审批前必须提供当前会话 plan/ 目录内、大小不超过 1 MB 的 Markdown 计划文件',
      })
    }

    const request: ExitPlanModeRequest = {
      requestId: randomUUID(),
      sessionId,
      toolInput: input,
      allowedPrompts,
      planDocument,
    }

    sendToRenderer(request)

    return new Promise<ExitPlanPermissionResult>((resolve) => {
      this.pendingRequests.set(request.requestId, {
        resolve,
        request,
        toolInput: input,
        planDirectory: options?.planDirectory,
      })

      signal.addEventListener('abort', () => {
        if (this.pendingRequests.has(request.requestId)) {
          console.warn(`[ExitPlanService] AbortSignal 触发，deny: requestId=${request.requestId}`)
          this.pendingRequests.delete(request.requestId)
          resolve({ behavior: 'deny', message: '操作已中止' })
        }
      }, { once: true })
    })
  }

  /**
   * 响应 ExitPlanMode 请求（由 IPC handler 调用）
   *
   * @returns { sessionId, targetMode } 用于通知编排层；未找到返回 null
   */
  respondToExitPlanMode(response: ExitPlanModeResponse): { sessionId: string; targetMode: PromaPermissionMode | null } | null {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId
    this.pendingRequests.delete(response.requestId)

    switch (response.action) {
      case 'approve_bypass': {
        if (pending.request.planDocument && !this.isPlanDocumentCurrent(pending.request.planDocument, pending.planDirectory)) {
          pending.resolve({
            behavior: 'deny' as const,
            message: '计划文档在审批期间已变更，请重新提交计划审批',
          })
          return { sessionId, targetMode: null }
        }
        // 批准 + 切换到完全自动模式
        pending.resolve({
          behavior: 'allow' as const,
          updatedInput: pending.toolInput,
          targetMode: 'bypassPermissions',
        })
        return { sessionId, targetMode: 'bypassPermissions' }
      }
      case 'deny': {
        // 拒绝计划
        pending.resolve({
          behavior: 'deny' as const,
          message: '用户拒绝了计划',
        })
        return { sessionId, targetMode: null }
      }
      case 'feedback': {
        // 用户提供反馈，拒绝并附带反馈内容
        pending.resolve({
          behavior: 'deny' as const,
          message: response.feedback ?? '用户要求修改计划',
        })
        return { sessionId, targetMode: null }
      }
      default: {
        pending.resolve({
          behavior: 'deny' as const,
          message: '未知操作',
        })
        return { sessionId, targetMode: null }
      }
    }
  }

  /**
   * 获取当前所有待处理的 ExitPlanMode 请求（用于渲染进程重载后恢复状态）
   */
  getPendingRequests(): ExitPlanModeRequest[] {
    return [...this.pendingRequests.values()].map((p) => p.request)
  }

  /**
   * 清除指定会话的所有待处理请求
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ behavior: 'deny', message: '会话已结束' })
        this.pendingRequests.delete(requestId)
      }
    }
  }

  /**
   * 计划文档必须是当前会话 plan/ 目录内的真实 Markdown 常规文件。
   * 使用 realpath 同时阻止 `..` 与符号链接逃逸；缺失、越界或超限时直接拒绝审批。
   */
  private resolvePlanDocument(value: unknown, planDirectory: string | undefined): ExitPlanDocument | undefined {
    if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim()) || !planDirectory) return undefined

    try {
      const planDirectoryStat = lstatSync(planDirectory)
      if (planDirectoryStat.isSymbolicLink() || !planDirectoryStat.isDirectory()) return undefined
      const resolvedPlanDirectory = realpathSync(planDirectory)
      const candidatePath = resolve(value.trim())
      const candidateStat = lstatSync(candidatePath)
      if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) return undefined
      const resolvedFilePath = realpathSync(candidatePath)
      const relativePath = relative(resolvedPlanDirectory, resolvedFilePath)
      const isInsidePlanDirectory = relativePath.length > 0
        && !relativePath.startsWith(`..${sep}`)
        && relativePath !== '..'
        && !isAbsolute(relativePath)

      if (!isInsidePlanDirectory || extname(resolvedFilePath).toLowerCase() !== '.md' || !lstatSync(resolvedFilePath).isFile()) {
        return undefined
      }
      const fileSize = statSync(resolvedFilePath).size
      if (fileSize > MAX_PLAN_DOCUMENT_BYTES) return undefined

      return {
        filePath: resolvedFilePath,
        displayName: basename(resolvedFilePath),
        contentHash: createHash('sha256').update(readFileSync(resolvedFilePath)).digest('hex'),
      }
    } catch (error) {
      console.warn('[ExitPlanService] 忽略无效计划文档:', error)
      return undefined
    }
  }

  /** 批准前重新验证文档位置和哈希，确保用户批准的是提交时的同一版本。 */
  private isPlanDocumentCurrent(document: ExitPlanDocument, planDirectory: string | undefined): boolean {
    const current = this.resolvePlanDocument(document.filePath, planDirectory)
    return current?.filePath === document.filePath && current.contentHash === document.contentHash
  }

  /**
   * 从工具输入中解析 allowedPrompts
   */
  private parseAllowedPrompts(input: Record<string, unknown>): ExitPlanAllowedPrompt[] {
    const raw = input.allowedPrompts
    if (!Array.isArray(raw)) return []

    return raw
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item): ExitPlanAllowedPrompt => ({
        tool: typeof item.tool === 'string' ? item.tool as 'Bash' : 'Bash',
        prompt: typeof item.prompt === 'string' ? item.prompt : '',
      }))
      .filter((item) => item.prompt.length > 0)
  }
}

/** 全局 ExitPlanMode 服务实例 */
export const exitPlanService = new AgentExitPlanService()
