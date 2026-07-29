import type { AgentSendInput, PromaPermissionMode } from '@proma/shared'

const PLANNING_DELETION_TOOLS = new Set([
  'mcp__planning__delete_todo',
  'mcp__planning__delete_calendar_event',
  'mcp__planning__delete_group',
  'mcp__planning__delete_tag',
  'mcp__planning__delete_reminder',
])

// Todo 与日程条目属于用户明确指定的删除目标，完全自动模式下不再额外弹出权限审核。
const FULLY_AUTOMATIC_PLANNING_DELETION_TOOLS = new Set([
  'mcp__planning__delete_todo',
  'mcp__planning__delete_calendar_event',
])

export type PlanningDeletionPermissionDecision =
  | 'not-planning-deletion'
  | 'allow'
  | 'require-single-approval'
  | 'deny-unattended'
  | 'defer-to-plan-mode'

/**
 * 将 Planning 删除操作映射为编排层可执行的权限决策。
 * 自动任务与协作子会话始终不能删除；计划模式则继续由只读策略拒绝。
 */
export function resolvePlanningDeletionPermission(
  toolName: string,
  permissionMode: PromaPermissionMode,
  triggeredBy: AgentSendInput['triggeredBy'],
): PlanningDeletionPermissionDecision {
  if (!PLANNING_DELETION_TOOLS.has(toolName)) return 'not-planning-deletion'

  if (triggeredBy === 'automation' || triggeredBy === 'delegation') {
    return 'deny-unattended'
  }

  if (permissionMode === 'plan') return 'defer-to-plan-mode'

  return FULLY_AUTOMATIC_PLANNING_DELETION_TOOLS.has(toolName)
    ? 'allow'
    : 'require-single-approval'
}
