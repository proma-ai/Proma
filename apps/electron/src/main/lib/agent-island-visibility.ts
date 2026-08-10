import type { AgentIslandState } from '@proma/shared'

/**
 * 构建 Island 的可见性指纹（纯函数，便于单测）。
 *
 * dismiss 时主进程记录当前指纹，只有指纹变化才会让 Island 重新出现。
 * 运行中的会话会持续产生 token/工具事件，lastActivityAt 与 detail 毫秒级变化。
 * 若把它们计入指纹，用户 dismiss 后下一条事件就会让指纹变化、岛重新弹出，
 * 表现为「执行中关不掉」。因此 running 会话只保留稳定指纹（sessionId:phase），
 * 只有状态跳变（needs-interaction / error / completed）或新会话出现时才重新唤起；
 * planning 指纹（新到期 Todo/日程）保持原有敏感度。
 */
export function buildVisibilityKey(state: AgentIslandState, planningKeys: string[]): string {
  const agentKey = state.sessions
    .map((session) => session.phase === 'running'
      ? `${session.sessionId}:running`
      : `${session.sessionId}:${session.phase}:${session.lastActivityAt}:${session.detail}`)
    .join('|')
  const recentKey = state.recentSessions
    .map((session) => `${session.sessionId}:${session.lastActivityAt}`)
    .join('|')
  return `${agentKey}/${recentKey}#${planningKeys.join('|')}`
}
