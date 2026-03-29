/**
 * Agent ExitPlanMode 计划审批服务
 *
 * 核心职责：
 * - 拦截 ExitPlanMode 工具调用
 * - 解析 allowedPrompts，发送到渲染进程展示审批 UI
 * - 等待用户选择（批准/拒绝/反馈），返回对应 PermissionResult
 * - 根据用户选择切换权限模式
 *
 * 复用 AskUserService 的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import type {
  ExitPlanModeRequest,
  ExitPlanModeResponse,
  ExitPlanAllowedPrompt,
  PromaPermissionMode,
} from '@proma/shared'

/** canUseTool 返回的权限结果 */
type PermissionResult = {
  behavior: 'allow'
  updatedInput: Record<string, unknown>
} | {
  behavior: 'deny'
  message: string
}

/** 待处理的 ExitPlanMode 请求 */
interface PendingExitPlan {
  resolve: (result: PermissionResult) => void
  request: ExitPlanModeRequest
  toolInput: Record<string, unknown>
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
export class AgentExitPlanService {
  /** 待处理的请求 Map（requestId → PendingExitPlan） */
  private pendingRequests = new Map<string, PendingExitPlan>()

  /**
   * 处理 ExitPlanMode 工具调用
   *
   * 解析 allowedPrompts，发送到渲染进程，阻塞等待用户选择。
   */
  handleExitPlanMode(
    sessionId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    sendToRenderer: (request: ExitPlanModeRequest) => void,
  ): Promise<PermissionResult> {
    const allowedPrompts = this.parseAllowedPrompts(input)

    const request: ExitPlanModeRequest = {
      requestId: randomUUID(),
      sessionId,
      toolInput: input,
      allowedPrompts,
    }

    sendToRenderer(request)

    return new Promise<PermissionResult>((resolve) => {
      this.pendingRequests.set(request.requestId, { resolve, request, toolInput: input })

      signal.addEventListener('abort', () => {
        if (this.pendingRequests.has(request.requestId)) {
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
      case 'approve_auto': {
        // 批准 + 切换到完全自动模式
        pending.resolve({
          behavior: 'allow' as const,
          updatedInput: pending.toolInput,
        })
        return { sessionId, targetMode: 'bypassPermissions' }
      }
      case 'approve_edit': {
        // 批准 + 保持手动审批模式
        pending.resolve({
          behavior: 'allow' as const,
          updatedInput: pending.toolInput,
        })
        return { sessionId, targetMode: 'acceptEdits' }
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
