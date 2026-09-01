import type { AgentActiveSessionSnapshot } from '@proma/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import { createQueuedAgentStreamState } from './agent-message-queue'

/** Runtime marker shared by active snapshots and terminal lifecycle events. */
export interface AgentRunMarker {
  startedAt?: number
  runGeneration?: number
}

/**
 * New protocols use the monotonic generation. Timestamps only remain a compatibility
 * fallback while an old main process or renderer is connected.
 */
export function isSameOrNewerRun(existing: AgentRunMarker, incoming: AgentRunMarker): boolean {
  if (existing.runGeneration != null && incoming.runGeneration != null) {
    return existing.runGeneration >= incoming.runGeneration
  }
  if (existing.startedAt != null && incoming.startedAt != null) {
    return existing.startedAt >= incoming.startedAt
  }
  return false
}

/** True only when a terminal event is allowed to affect the current run. */
export function isTerminalEventForCurrentRun(
  current: AgentStreamState | undefined,
  terminal: AgentRunMarker,
): boolean {
  if (!current) return true
  if (current.runGeneration != null && terminal.runGeneration != null) {
    return current.runGeneration === terminal.runGeneration
  }
  if (current.startedAt != null) {
    return terminal.startedAt != null && terminal.startedAt >= current.startedAt
  }
  return true
}

/**
 * 将主进程快照合并到 renderer 的运行态。旧快照不能覆盖已收到的更晚状态，
 * 防止初始化 IPC 与同一会话的完成事件交错时重新显示已结束的 Agent。
 */
export function mergeActiveAgentSessionSnapshot(
  current: AgentStreamState | undefined,
  snapshot: AgentActiveSessionSnapshot,
  latestTerminalRun?: AgentRunMarker,
): AgentStreamState | undefined {
  // 完成处理可能已回收 state.startedAt；单独保留本次挂载期间收到的终态标记，
  // 防止 IPC 快照先在主进程取到、却在完成事件之后才抵达 renderer 时复活旧 run。
  if (latestTerminalRun && isSameOrNewerRun(latestTerminalRun, snapshot)) return current
  if (current && isSameOrNewerRun(current, snapshot)) {
    // 同一 run 已由旧协议事件建立时，补写快照中的 generation，避免后续终态退回时间戳比较。
    if (current.runGeneration == null && snapshot.runGeneration != null && current.startedAt === snapshot.startedAt) {
      return { ...current, runGeneration: snapshot.runGeneration }
    }
    return current
  }
  return {
    ...createQueuedAgentStreamState(current, snapshot.startedAt),
    ...(snapshot.runGeneration != null ? { runGeneration: snapshot.runGeneration } : {}),
  }
}
