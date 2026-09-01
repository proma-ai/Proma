import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { BrowserStateChange, BrowserViewState } from '@proma/shared'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '@/types/settings'
import {
  browserFocusRequestMapAtom,
  browserPanelMinimizedMapAtom,
  browserPanelOpenMapAtom,
  browserPendingNavigationMapAtom,
  browserStateMapAtom,
} from '@/atoms/browser-atoms'
import { shouldReuseInitialBrowserTab } from './agent-browser-link-utils'

interface AgentBrowserLinkContextValue {
  openLink: (url: string) => void
}

const AgentBrowserLinkContext = React.createContext<AgentBrowserLinkContextValue | null>(null)

/** 同一会话的所有 Agent 回复共用队列，避免跨消息快速点击时覆盖首个导航。 */
const navigationQueues = new Map<string, Promise<void>>()

/** Agent 回复内网页链接的打开目标；未提供时保留原有系统浏览器行为。 */
export function useAgentBrowserLink(): AgentBrowserLinkContextValue | null {
  return React.useContext(AgentBrowserLinkContext)
}

export function AgentBrowserLinkProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: React.ReactNode
}): React.ReactElement {
  const setBrowserOpenMap = useSetAtom(browserPanelOpenMapAtom)
  const setBrowserMinimizedMap = useSetAtom(browserPanelMinimizedMapAtom)
  const setBrowserStateMap = useSetAtom(browserStateMapAtom)
  const setBrowserFocusRequestMap = useSetAtom(browserFocusRequestMapAtom)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)

  const publishBrowserState = React.useCallback((state: BrowserStateChange) => {
    if ('closed' in state) {
      setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, false); return next })
      setBrowserMinimizedMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setBrowserStateMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setBrowserFocusRequestMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setPendingNavigationMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      return
    }
    setBrowserStateMap((previous) => {
      const next = new Map(previous)
      next.set(state.sessionId, state)
      return next
    })
    setBrowserOpenMap((previous) => {
      const next = new Map(previous)
      next.set(state.sessionId, true)
      return next
    })
  }, [setBrowserFocusRequestMap, setBrowserOpenMap, setBrowserMinimizedMap, setBrowserStateMap, setPendingNavigationMap])

  const requestBrowserFocus = React.useCallback((state: BrowserViewState) => {
    setBrowserFocusRequestMap((previous) => {
      const next = new Map(previous)
      next.set(state.sessionId, state.activeTabId)
      return next
    })
  }, [setBrowserFocusRequestMap])

  const openLink = React.useCallback((url: string) => {
    const openBrowser = (window.electronAPI as Partial<typeof window.electronAPI>).openAgentBrowser
    if (typeof openBrowser !== 'function') {
      void window.electronAPI.openExternal(url)
      return
    }

    const nextNavigation = (navigationQueues.get(sessionId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        try {
          setBrowserMinimizedMap((previous) => {
            const next = new Map(previous)
            next.delete(sessionId)
            return next
          })
          const [settings, existingState] = await Promise.all([
            window.electronAPI.getSettings(),
            window.electronAPI.getAgentBrowserState(sessionId),
          ])
          const riskAcknowledged = (settings.browserRiskDisclaimerVersion ?? 0) >= BROWSER_RISK_DISCLAIMER_VERSION

          if (!riskAcknowledged) {
            // 风险告知尚未确认时，先打开空白浏览器展示确认弹窗，确认后再导航。
            const state = existingState ?? await openBrowser(sessionId)
            publishBrowserState(state)
            requestBrowserFocus(state)
            setPendingNavigationMap((previous) => {
              const next = new Map(previous)
              next.set(sessionId, url)
              return next
            })
            return
          }

          // 带目标 URL 的首次打开直接创建并导航 Agent 标签，避免 openAgentBrowser
          // 先将初始空白标签加载为 Google 后再额外创建一个目标标签。
          const nextState = existingState && shouldReuseInitialBrowserTab(existingState)
            ? await window.electronAPI.navigateAgentBrowser({ sessionId, url })
            : await window.electronAPI.createAgentBrowserTab({ sessionId, url })
          publishBrowserState(nextState)
          requestBrowserFocus(nextState)
        } catch (error) {
          console.error('[Agent 回复链接] 在受管浏览器中打开失败:', error)
        }
      })
    navigationQueues.set(sessionId, nextNavigation)
    void nextNavigation.finally(() => {
      if (navigationQueues.get(sessionId) === nextNavigation) navigationQueues.delete(sessionId)
    })
  }, [publishBrowserState, requestBrowserFocus, sessionId, setBrowserMinimizedMap, setPendingNavigationMap])

  const value = React.useMemo(() => ({ openLink }), [openLink])
  return <AgentBrowserLinkContext.Provider value={value}>{children}</AgentBrowserLinkContext.Provider>
}
