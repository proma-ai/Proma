import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { BrowserStateChange, BrowserViewState } from '@proma/shared'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '@/types/settings'
import {
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
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)

  const publishBrowserState = React.useCallback((state: BrowserStateChange) => {
    if ('closed' in state) {
      setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, false); return next })
      setBrowserMinimizedMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setBrowserStateMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
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
  }, [setBrowserOpenMap, setBrowserMinimizedMap, setBrowserStateMap, setPendingNavigationMap])

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
          const [settings, state] = await Promise.all([
            window.electronAPI.getSettings(),
            openBrowser(sessionId),
          ])
          publishBrowserState(state)

          const riskAcknowledged = (settings.browserRiskDisclaimerVersion ?? 0) >= BROWSER_RISK_DISCLAIMER_VERSION
          if (!riskAcknowledged) {
            setPendingNavigationMap((previous) => {
              const next = new Map(previous)
              next.set(sessionId, url)
              return next
            })
            return
          }

          const nextState = shouldReuseInitialBrowserTab(state)
            ? await window.electronAPI.navigateAgentBrowser({ sessionId, url })
            : await window.electronAPI.createAgentBrowserTab({ sessionId, url })
          publishBrowserState(nextState)
        } catch (error) {
          console.error('[Agent 回复链接] 在受管浏览器中打开失败:', error)
        }
      })
    navigationQueues.set(sessionId, nextNavigation)
    void nextNavigation.finally(() => {
      if (navigationQueues.get(sessionId) === nextNavigation) navigationQueues.delete(sessionId)
    })
  }, [publishBrowserState, sessionId, setBrowserMinimizedMap, setPendingNavigationMap])

  const value = React.useMemo(() => ({ openLink }), [openLink])
  return <AgentBrowserLinkContext.Provider value={value}>{children}</AgentBrowserLinkContext.Provider>
}
