import { atom } from 'jotai'
import type { BrowserViewState } from '@proma/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

/** 每个 Agent 会话的受管浏览器面板开关。主进程仍是状态权威。 */
export const browserPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())
/** 用户最小化面板后保留浏览器 session，直到用户主动恢复或关闭。 */
export const browserPanelMinimizedMapAtom = atom<Map<string, boolean>>(new Map())
export const browserStateMapAtom = atom<Map<string, BrowserViewState>>(new Map())
/** Agent 回复链接请求将右侧工作区切换到对应浏览器标签；值为目标 tab ID。 */
export const browserFocusRequestMapAtom = atom<Map<string, string>>(new Map())
/** 首次风险确认完成后自动加载的 Agent 回复链接。 */
export const browserPendingNavigationMapAtom = atom<Map<string, string>>(new Map())

/**
 * 删除会话时清理其全部受管浏览器 UI 状态。
 *
 * 主进程会销毁对应的原生 WebContentsView；这里同时移除 renderer 缓存，
 * 避免 IPC 关闭事件晚到或丢失时右侧工作区继续渲染已删除会话的浏览器。
 */
export const clearBrowserSessionStateAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    const removeEntry = <T,>(previous: Map<string, T>): Map<string, T> => {
      if (!previous.has(sessionId)) return previous
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    }

    set(browserPanelOpenMapAtom, removeEntry)
    set(browserPanelMinimizedMapAtom, removeEntry)
    set(browserStateMapAtom, removeEntry)
    set(browserFocusRequestMapAtom, removeEntry)
    set(browserPendingNavigationMapAtom, removeEntry)
  },
)

export const currentSessionBrowserStateAtom = atom<BrowserViewState | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  return sessionId ? get(browserStateMapAtom).get(sessionId) ?? null : null
})
