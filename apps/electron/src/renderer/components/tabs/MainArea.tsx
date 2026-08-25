/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。文件、Markdown 和 Diff 预览统一由右侧工作区承载；
 * MainArea 仅保留对话主区，以及 Scratch Pad 的临时分屏。
 */

import * as React from 'react'
import type { BrowserStateChange } from '@proma/shared'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
  scratchPadPanelOpenAtom,
} from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { ScratchPadPane } from '@/components/scratch-pad/ScratchPadView'
import { previewSplitRatioAtom } from '@/atoms/preview-atoms'
import { closeScratchInSplit } from '@/components/scratch-pad/scratch-pad-opener'
import { useTrackSessionView } from '@/hooks/useTrackSessionView'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { PlanningView } from '@/components/planning/PlanningView'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { interfaceVariantAtom } from '@/atoms/theme'
import { cn } from '@/lib/utils'
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
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'
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

  const scratchPanelOpen = useAtomValue(scratchPadPanelOpenAtom)
  const showScratchPanel = activeTab?.type === 'agent' && scratchPanelOpen && activeView === 'conversations'
  // Scratch 复用旧的预览分栏比例，保持已有用户布局。
  const [scratchSplitRatio, setScratchSplitRatio] = useAtom(previewSplitRatioAtom)
  const scratchDragging = React.useRef(false)

  const handleScratchDragStart = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    scratchDragging.current = true
    const startX = event.clientX
    const startRatio = scratchSplitRatio
    const container = (event.currentTarget as HTMLElement).closest('[data-scratch-split-container]') as HTMLElement | null
    const containerWidth = container?.clientWidth ?? 1
    let latestClientX = startX
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!scratchDragging.current) return
      latestClientX = moveEvent.clientX
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const nextRatio = Math.max(0.3, Math.min(0.8, startRatio + (latestClientX - startX) / containerWidth))
        setScratchSplitRatio(nextRatio)
      })
    }
    const onMouseUp = () => {
      scratchDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [scratchSplitRatio, setScratchSplitRatio])

  const handleCloseScratchPanel = React.useCallback(() => closeScratchInSplit(store), [store])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) setActiveTabId(tabs[0]!.id)
  }, [tabs, activeTabId, setActiveTabId])

  const leftFlexStyle: React.CSSProperties = showScratchPanel
    ? { flex: `0 0 calc(${scratchSplitRatio * 100}% - 6px)` }
    : { flex: '1 1 auto' }

  return (
    <Panel variant="grow" className={cn('bg-content-area', isClassic && 'rounded-2xl shadow-xl dark:shadow-sm')}>
      <div className="flex flex-1 min-h-0 overflow-hidden" data-scratch-split-container>
        <div className="flex flex-col min-w-0 h-full" style={leftFlexStyle}>
          {activeView === 'planning' ? (
            automationFormOpen ? <AutomationFormView /> : <PlanningView />
          ) : activeView === 'agent-skills' ? (
            <AgentSkillsView />
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
        {showScratchPanel && (
          <>
            <div
              className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
              onMouseDown={handleScratchDragStart}
            />
            <div className="flex-1 min-w-0 h-full overflow-hidden"><ScratchPadPane onClose={handleCloseScratchPanel} /></div>
          </>
        )}
      </div>
    </Panel>
  )
}
