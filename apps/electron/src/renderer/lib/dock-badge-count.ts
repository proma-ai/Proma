/**
 * Dock 角标计数工具
 *
 * 只统计需要用户回来看一眼或处理的事项。
 */

export interface DockBadgeCountInput {
  /** 已完成但尚未查看的 Agent 会话数量 */
  unviewedCompletedCount: number
  /** 待审批权限请求数量 */
  pendingPermissionCount: number
  /** 待回答 AskUser 请求数量 */
  pendingAskUserCount: number
  /** 待审批计划请求数量 */
  pendingExitPlanCount: number
}

/** 统计按会话分组的待处理请求数量 */
export function countPendingRequests<T>(requestsBySession: ReadonlyMap<string, readonly T[]>): number {
  let total = 0
  for (const requests of requestsBySession.values()) {
    total += requests.length
  }
  return total
}

/** 计算 Dock 角标应该展示的总数 */
export function calculateDockBadgeCount(input: DockBadgeCountInput): number {
  return Math.max(
    0,
    input.unviewedCompletedCount
      + input.pendingPermissionCount
      + input.pendingAskUserCount
      + input.pendingExitPlanCount,
  )
}
