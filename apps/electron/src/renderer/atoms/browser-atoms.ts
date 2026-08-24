import { atom } from 'jotai'
import type { BrowserViewState } from '@proma/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

/** 每个 Agent 会话的受管浏览器面板开关。主进程仍是状态权威。 */
export const browserPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())
/** 用户最小化面板后保留浏览器 session，直到用户主动恢复或关闭。 */
export const browserPanelMinimizedMapAtom = atom<Map<string, boolean>>(new Map())
export const browserStateMapAtom = atom<Map<string, BrowserViewState>>(new Map())
/** 首次风险确认完成后自动加载的 Agent 回复链接。 */
export const browserPendingNavigationMapAtom = atom<Map<string, string>>(new Map())

export const currentSessionBrowserStateAtom = atom<BrowserViewState | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  return sessionId ? get(browserStateMapAtom).get(sessionId) ?? null : null
})
