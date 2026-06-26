/**
 * Agent 协作会话纯工具函数
 *
 * 不依赖 Electron 和磁盘服务，便于单元测试。
 */

import {
  PROMA_DEFAULT_PERMISSION_MODE,
  type AgentDelegationRole,
  type AgentDelegationStatus,
  type AgentSessionMeta,
  type PromaPermissionMode,
} from '@proma/shared'

const PERMISSION_RANK: Record<PromaPermissionMode, number> = {
  plan: 0,
  auto: 1,
  bypassPermissions: 2,
}

export const MAX_RUNNING_DELEGATIONS_PER_PARENT = 50

export interface RecoveredDelegationState {
  delegationId: string
  parentSessionId: string
  childSessionId: string
  title: string
  role: AgentDelegationRole
  goal: string
  permissionMode: PromaPermissionMode
  status: AgentDelegationStatus
  startedAt: number
  completedAt?: number
}

export function resolveDelegationPermissionMode(
  parentMode: PromaPermissionMode | undefined,
  requestedMode: PromaPermissionMode | undefined,
): PromaPermissionMode {
  const parent = parentMode ?? PROMA_DEFAULT_PERMISSION_MODE
  const requested = requestedMode ?? parent
  return PERMISSION_RANK[requested] <= PERMISSION_RANK[parent] ? requested : parent
}

export function buildRecoveredDelegationState(input: {
  parentSessionId: string
  delegationId: string
  session: AgentSessionMeta
  fallbackPermissionMode?: PromaPermissionMode
}): RecoveredDelegationState {
  const persistedStatus = input.session.delegationStatus
  // 从持久化记录恢复但不在 live Map 中，说明当前进程并没有这个委派在跑。
  // 若磁盘里还残留 running（例如应用重启/崩溃后），应视为 interrupted，
  // 否则 continue_delegation 会把它误判为“仍在运行”而拒绝恢复。
  const status = persistedStatus === 'running'
    ? 'interrupted'
    : (persistedStatus ?? 'interrupted')
  return {
    delegationId: input.delegationId,
    parentSessionId: input.parentSessionId,
    childSessionId: input.session.id,
    title: input.session.title,
    role: input.session.delegationRole ?? 'custom',
    goal: input.session.delegationGoal ?? '',
    permissionMode: input.session.permissionMode ?? input.fallbackPermissionMode ?? PROMA_DEFAULT_PERMISSION_MODE,
    status,
    startedAt: input.session.createdAt,
    completedAt: persistedStatus ? input.session.updatedAt : undefined,
  }
}

export function buildDelegationPrompt(input: {
  parentSessionId: string
  delegationId: string
  role: AgentDelegationRole
  task: string
  expectedOutput?: string
}): string {
  const expectedOutput = input.expectedOutput?.trim()
  return `你是 Proma 协作子 Agent。你由父 Agent 会话 ${input.parentSessionId} 委派创建，委派 ID 为 ${input.delegationId}。

## 工作边界

- 只处理下面的子任务，不要扩展到父任务的其他部分。
- 不要创建新的协作子会话。
- 如需修改文件，保持改动最小，并在最终回复说明文件路径和验证结果。
- 如果信息不足，直接列出缺口，不要编造。

## 子任务角色

${input.role}

## 子任务

${input.task.trim()}

## 输出要求

${expectedOutput || '最终回复请包含：关键发现、已执行操作、验证结果、剩余风险或建议。'}`
}

export function buildDelegationTaskWithSharedContext(input: {
  sharedContext?: string
  task: string
}): string {
  const sharedContext = input.sharedContext?.trim()
  const task = input.task.trim()
  if (!sharedContext) return task

  return `共享背景：
${sharedContext}

子任务：
${task}`
}
