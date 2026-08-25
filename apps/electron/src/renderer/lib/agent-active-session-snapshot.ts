import type { AgentActiveSessionSnapshot } from '@proma/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import { createQueuedAgentStreamState } from './agent-message-queue'

/**
 * 将主进程快照合并到 renderer 的运行态。旧快照不能覆盖已收到的更晚状态，
 * 防止初始化 IPC 与同一会话的完成事件交错时重新显示已结束的 Agent。
 */
export function mergeActiveAgentSessionSnapshot(
  current: AgentStreamState | undefined,
  snapshot: AgentActiveSessionSnapshot,
): AgentStreamState | undefined {
  if (current?.startedAt != null && current.startedAt >= snapshot.startedAt) return current
  return createQueuedAgentStreamState(current, snapshot.startedAt)
}
