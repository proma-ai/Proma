/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。文件、Markdown 和 Diff 预览统一由右侧工作区承载；
 * MainArea 仅保留对话主区。
 */

import * as React from 'react'
import type { BrowserStateChange, BrowserTabFocusChange } from '@proma/shared'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
} from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { useTrackSessionView } from '@/hooks/useTrackSessionView'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { PlanningView } from '@/components/planning/PlanningView'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { VaultView } from '@/components/vault/VaultView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { registerShortcut } from '@/lib/shortcut-registry'
import {
  agentDiffPanelTabAtom,
  agentSidePanelOpenAtomFamily,
  currentSessionSidePanelOpenAtom,
  getBrowserSidePanelTab,
} from '@/atoms/agent-atoms'
import {
  browserPanelMinimizedMapAtom,
  browserPanelOpenMapAtom,
  browserPendingNavigationMapAtom,
  browserStateMapAtom,
} from '@/atoms/browser-atoms'

export function MainArea(): React.ReactElement {
  useTrackSessionView()

  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const automationFormOpen = useAtomValue(automationFormAtom).open
  const activeView = useAtomValue(activeViewAtom)
  const store = useStore()

  // TabBar 立即反馈，较重的中心内容可让出当前交互帧；Agent 历史则保持当前会话避免旧内容占屏。
  const deferredActiveTabId = React.useDeferredValue(activeTabId)
  const contentTabId = activeTab?.type === 'agent' ? activeTabId : deferredActiveTabId
  // Agent 会话从左侧历史列表切换，中心区不再重复展示同一组顶部 Tab。
  const showCenterTabBar = activeTab?.type !== 'agent'
  const [isRightPanelOpen, setRightPanelOpen] = useAtom(currentSessionSidePanelOpenAtom)
  const toggleRightPanel = React.useCallback(() => {
    if (activeTab?.type !== 'agent') return
    setRightPanelOpen(!isRightPanelOpen)
  }, [activeTab?.type, isRightPanelOpen, setRightPanelOpen])

  // 不能依赖 TabBar 注册：Agent 会话已不渲染中心 TabBar，快捷键需要在常驻主内容区监听。
  React.useEffect(() => registerShortcut('toggle-right-panel', toggleRightPanel), [toggleRightPanel])

  // 浏览器状态仍由主内容区常驻订阅，右侧工作区只读取 atom 渲染，避免侧栏收起时遗漏状态更新。
  const setBrowserOpenMap = useSetAtom(browserPanelOpenMapAtom)
  const setBrowserMinimizedMap = useSetAtom(browserPanelMinimizedMapAtom)
  const setBrowserStateMap = useSetAtom(browserStateMapAtom)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)
  const setAgentSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const browserSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  // 同一条状态会因原生视图显示/隐藏重复广播；仅新的 Agent 浏览器活动才激活对应右侧 Tab。
  const handledBrowserActivityIdsRef = React.useRef(new Map<string, string>())

  const publishBrowserState = React.useCallback((state: BrowserStateChange) => {
    if ('closed' in state) {
      setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, false); return next })
      setBrowserMinimizedMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setBrowserStateMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      setPendingNavigationMap((previous) => { const next = new Map(previous); next.delete(state.sessionId); return next })
      return
    }
    setBrowserStateMap((previous) => { const next = new Map(previous); next.set(state.sessionId, state); return next })
    const isMinimized = store.get(browserPanelMinimizedMapAtom).get(state.sessionId) === true
    setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, !isMinimized); return next })

    const activity = state.activity
    const shouldActivateAgentBrowserTab = Boolean(
      activity
      && activeTab?.type === 'agent'
      && activeTab.sessionId === state.sessionId
      && state.agentTabId === state.activeTabId
      && activity.tabId === state.activeTabId
      && handledBrowserActivityIdsRef.current.get(state.sessionId) !== activity.id,
    )
    if (shouldActivateAgentBrowserTab) {
      handledBrowserActivityIdsRef.current.set(state.sessionId, activity!.id)
      store.set(agentSidePanelOpenAtomFamily(state.sessionId), true)
      setAgentSidePanelTabMap((previous) => {
        const next = new Map(previous)
        next.set(state.sessionId, getBrowserSidePanelTab(state.activeTabId))
        return next
      })
    }
  }, [activeTab, setAgentSidePanelTabMap, setBrowserOpenMap, setBrowserMinimizedMap, setBrowserStateMap, setPendingNavigationMap, store])

  React.useEffect(() => {
    const subscribe = (window.electronAPI as Partial<typeof window.electronAPI>).onAgentBrowserStateChanged
    if (typeof subscribe !== 'function') return
    return subscribe(publishBrowserState)
  }, [publishBrowserState])

  const focusNativeBrowserTab = React.useCallback((change: BrowserTabFocusChange) => {
    // WebContentsView 不在 React DOM 中；点击后台 Browser Pane 的网页正文只能由主进程
    // 把原生 focus 映射回右侧 Pane/Tab 焦点。后台 Agent Session 不得借此抢前台。
    if (activeTab?.type !== 'agent' || activeTab.sessionId !== change.sessionId) return
    store.set(agentSidePanelOpenAtomFamily(change.sessionId), true)
    setAgentSidePanelTabMap((previous) => {
      if (previous.get(change.sessionId) === getBrowserSidePanelTab(change.tabId)) return previous
      const next = new Map(previous)
      next.set(change.sessionId, getBrowserSidePanelTab(change.tabId))
      return next
    })
  }, [activeTab, setAgentSidePanelTabMap, store])

  React.useEffect(() => {
    const subscribe = (window.electronAPI as Partial<typeof window.electronAPI>).onAgentBrowserTabFocused
    if (typeof subscribe !== 'function') return
    return subscribe(focusNativeBrowserTab)
  }, [focusNativeBrowserTab])

  React.useEffect(() => {
    if (!browserSessionId) return
    const getState = (window.electronAPI as Partial<typeof window.electronAPI>).getAgentBrowserState
    if (typeof getState !== 'function') return
    let cancelled = false
    void getState(browserSessionId)
      .then((state) => { if (!cancelled && state) publishBrowserState(state) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [browserSessionId, publishBrowserState])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) setActiveTabId(tabs[0]!.id)
  }, [tabs, activeTabId, setActiveTabId])


  return (
    <Panel variant="grow" className="bg-content-area">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-1 flex-col min-w-0 h-full">
          {activeView === 'planning' ? (
            automationFormOpen ? <AutomationFormView /> : <PlanningView />
          ) : activeView === 'agent-skills' ? (
            <AgentSkillsView />
          ) : activeView === 'vault' ? (
            <VaultView />
          ) : (
            <>
              {showCenterTabBar && <TabBar />}
              {automationFormOpen && activeView !== 'conversations' ? (
                <AutomationFormView />
              ) : tabs.length === 0 ? (
                <WelcomeView />
              ) : contentTabId ? (
                <div className="flex-1 min-h-0 titlebar-no-drag"><TabContent tabId={contentTabId} /></div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}
