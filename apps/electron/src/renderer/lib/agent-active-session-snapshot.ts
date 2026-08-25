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
  latestTerminalStartedAt?: number,
): AgentStreamState | undefined {
  // 完成处理可能已回收 state.startedAt；单独保留本次挂载期间收到的终态标记，
  // 防止 IPC 快照先在主进程取到、却在完成事件之后才抵达 renderer 时复活旧 run。
  if (latestTerminalStartedAt != null && latestTerminalStartedAt >= snapshot.startedAt) return current
  if (current?.startedAt != null && current.startedAt >= snapshot.startedAt) return current
  return createQueuedAgentStreamState(current, snapshot.startedAt)
}
