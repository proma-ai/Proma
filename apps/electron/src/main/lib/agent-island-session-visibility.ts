import type { AgentIslandPhase } from '@proma/shared'

/** 影响 Island 会话保留的最小状态；保持为纯函数以便回归测试。 */
export interface AgentIslandSessionVisibilityInput {
  phase: AgentIslandPhase
  attention: boolean
  unread: boolean
  terminalAt?: number
}

/**
 * 决定终态会话是否仍应保留在 Island。
 *
 * 运行与待接手会话持续可见；异常仅在尚未查看时作为“需关注”保留。
 * 已查看的异常不再占据 Island，用户可在已打开的会话中处理详情。
 */
export function shouldRetainAgentIslandSession(
  session: AgentIslandSessionVisibilityInput,
  now: number,
  unreadRetainMs: number,
): boolean {
  if (session.phase === 'running' || session.phase === 'needs-interaction') return true
  if (session.phase === 'error') return session.attention
  return session.phase === 'completed'
    && session.unread
    && session.terminalAt !== undefined
    && now - session.terminalAt < unreadRetainMs
}
