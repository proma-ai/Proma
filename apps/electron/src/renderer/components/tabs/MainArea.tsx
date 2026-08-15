/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。Agent 模式下若预览面板打开，则在同一个 Panel 内分屏：
 * 顶部一行：左侧 TabBar + 右侧预览顶栏（含文件名、复制按钮）
 * 主体：左侧 TabContent + 右侧预览内容
 */

import * as React from 'react'
import type { BrowserViewState } from '@proma/shared'
import { useAtomValue, useSetAtom, useAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
  scratchPadPanelOpenAtom,
  rightWorkspaceSplitRatioAtom,
} from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { previewPanelOpenMapAtom, previewSplitRatioAtom } from '@/atoms/preview-atoms'
import { PreviewPanel } from '@/components/diff/PreviewPanel'
import { ScratchPadPane } from '@/components/scratch-pad/ScratchPadView'
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
import { browserPanelOpenMapAtom, browserPendingNavigationMapAtom, browserStateMapAtom } from '@/atoms/browser-atoms'
import { BrowserPanel } from '@/components/browser/BrowserPanel'
import { nextBrowserLayoutRevision } from '@/components/browser/browser-layout-revision'

interface BrowserClosingState {
  sessionId: string
  state: BrowserViewState | null
}

export function MainArea(): React.ReactElement {
  // 记录每个会话上次停留的视图（对话 / 预览），供切回时重建预览 Tab
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

  const previewOpenMap = useAtomValue(previewPanelOpenMapAtom)
  const [browserOpenMap, setBrowserOpenMap] = useAtom(browserPanelOpenMapAtom)
  const [browserStateMap, setBrowserStateMap] = useAtom(browserStateMapAtom)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)
  const [splitRatio, setSplitRatio] = useAtom(previewSplitRatioAtom)
  const [rightWorkspaceRatio, setRightWorkspaceRatio] = useAtom(rightWorkspaceSplitRatioAtom)
  const previewDragging = React.useRef(false)
  const rightWorkspaceDragging = React.useRef(false)
  const browserSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null

  // 原生 WebContentsView 不受 React DOM 卸载同步控制。Session 或主视图切换时先在
  // layout effect 中清空共享展示槽，避免旧 Session 的页面参与新一帧绘制。
  React.useLayoutEffect(() => {
    const hidePresentation = (window.electronAPI as Partial<typeof window.electronAPI>).hideAgentBrowserPresentation
    if (typeof hidePresentation !== 'function') return
    void hidePresentation(nextBrowserLayoutRevision()).catch(() => undefined)
  }, [activeView, browserSessionId])

  const publishBrowserState = React.useCallback((state: BrowserViewState) => {
    setBrowserStateMap((previous) => { const next = new Map(previous); next.set(state.sessionId, state); return next })
    setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, true); return next })
  }, [setBrowserOpenMap, setBrowserStateMap])

  React.useEffect(() => {
    // Vite renderer 可在 preload 热重载前先更新；旧 bridge 时浏览器功能不可用，
    // 但绝不能让整个主界面崩溃。完整 Electron preload 就绪后会正常订阅。
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
      .then((state) => {
        if (!cancelled && state) publishBrowserState(state)
      })
      // 后台会话及已删除会话会被主进程拒绝或返回空状态；无需打断当前界面。
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [browserSessionId, publishBrowserState])

  const [browserClosingState, setBrowserClosingState] = React.useState<BrowserClosingState | null>(null)
  const browserIsOpen = !!browserSessionId && (browserOpenMap.get(browserSessionId) ?? false)
  const showBrowserPanel = browserIsOpen && activeView === 'conversations'
  const showBrowserClosing = !!browserClosingState
    && browserClosingState.sessionId === browserSessionId
    && activeView === 'conversations'
    && !showBrowserPanel
  const browserState = browserSessionId ? browserStateMap.get(browserSessionId) ?? null : null
  const browserPanelSessionId = showBrowserPanel
    ? browserSessionId
    : showBrowserClosing
      ? browserClosingState?.sessionId ?? null
      : null
  const browserPanelState = showBrowserPanel ? browserState : browserClosingState?.state ?? null
  const previewOpen =
    activeTab?.type === 'agent'
    && (previewOpenMap.get(activeTab.sessionId) ?? false)
    && !showBrowserPanel
    && !showBrowserClosing
  const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const scratchPanelOpen = useAtomValue(scratchPadPanelOpenAtom)
  const showScratchPanel =
    activeTab?.type === 'agent'
    && scratchPanelOpen
    && activeView === 'conversations'
    && !showBrowserPanel
    && !showBrowserClosing

  const requestCloseBrowser = React.useCallback((sessionId: string) => {
    setBrowserClosingState({ sessionId, state: browserStateMap.get(sessionId) ?? null })
    setBrowserOpenMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, false)
      return next
    })
  }, [browserStateMap, setBrowserOpenMap])

  const clearClosedBrowser = React.useCallback((sessionId: string) => {
    setBrowserClosingState((previous) => previous?.sessionId === sessionId ? null : previous)
    setBrowserStateMap((previous) => {
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    })
    setPendingNavigationMap((previous) => {
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    })
  }, [setBrowserStateMap, setPendingNavigationMap])

  React.useEffect(() => {
    if (!browserClosingState) return
    if (showBrowserPanel) {
      setBrowserClosingState(null)
      return
    }
    if (browserClosingState.sessionId !== browserSessionId || activeView !== 'conversations') {
      clearClosedBrowser(browserClosingState.sessionId)
    }
  }, [activeView, browserClosingState, browserSessionId, clearClosedBrowser, showBrowserPanel])

  // 关闭动画状态：当 previewOpen 从 true → false 时，播放退出动画再移除 DOM
  // 在 render 阶段同步派生 closing，避免中间帧出现 flex: 1 1 auto 导致左侧瞬间跳到 100% 宽
  // （flex-basis: auto 与 calc() 之间无法插值，transition 不生效，视觉上会被解读为"重新渲染"）
  const [closingState, setClosingState] = React.useState(false)
  const prevPreviewStateRef = React.useRef({ open: previewOpen, sessionId: previewSessionId })

  let closing = closingState
  const prev = prevPreviewStateRef.current
  if (prev.open && !previewOpen && prev.sessionId === previewSessionId) {
    closing = true
  }
  if (previewOpen || prev.sessionId !== previewSessionId) {
    closing = false
  }
  if (closing !== closingState) {
    setClosingState(closing)
  }

  React.useEffect(() => {
    prevPreviewStateRef.current = { open: previewOpen, sessionId: previewSessionId }
  }, [previewOpen, previewSessionId])

  const showPreview = (previewOpen || closing) && previewSessionId && activeView === 'conversations'
  const showPreviewClosingOnly = closing && !previewOpen
  const showPreviewPane = !!showPreview && !(showPreviewClosingOnly && showScratchPanel)
  const showBothRightPanels = showPreviewPane && showScratchPanel

  const handlePreviewDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    previewDragging.current = true
    const startX = e.clientX
    const startRatio = splitRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-split-container]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!previewDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.8, startRatio + delta / containerWidth))
        setSplitRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      previewDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [splitRatio, setSplitRatio])

  const handleRightWorkspaceDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    rightWorkspaceDragging.current = true
    const startX = e.clientX
    const startRatio = rightWorkspaceRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-right-workspace]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!rightWorkspaceDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.7, startRatio + delta / containerWidth))
        setRightWorkspaceRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      rightWorkspaceDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [rightWorkspaceRatio, setRightWorkspaceRatio])

  const handleCloseScratchPanel = React.useCallback(() => {
    closeScratchInSplit(store)
  }, [store])

  React.useEffect(() => {
    if (tabs.length === 0) {
      console.warn('[FLASH-DEBUG] MainArea: tabs.length === 0, showing WelcomeView!', new Error().stack)
    }
  }, [tabs.length])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0]!.id)
    }
  }, [tabs, activeTabId, setActiveTabId])

  // 关闭动画期间右侧面板脱离 flex 流，保持原宽度，只使用 transform/opacity 做退出动画。
  const rightPanelClosing = showBrowserClosing || (closing && !showScratchPanel)
  const closingOverlayStyle: React.CSSProperties | undefined = rightPanelClosing
    ? {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${splitRatio * 100}%`,
        width: `${(1 - splitRatio) * 100}%`,
        zIndex: 1,
        display: 'flex',
        pointerEvents: 'none',
      }
    : undefined

  // 左侧容器宽度：右侧工作区打开时固定占 splitRatio；关闭动画结束后再恢复全宽。
  const showRightPanel = showBrowserPanel || showBrowserClosing || showScratchPanel || showPreviewPane
  const leftFlexStyle: React.CSSProperties = showRightPanel
    ? { flex: `0 0 calc(${splitRatio * 100}% - 6px)` }
    : { flex: '1 1 auto' }
  const previewPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${rightWorkspaceRatio * 100}% - 4px)` }
    : { flex: '1 1 auto' }
  const scratchPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${(1 - rightWorkspaceRatio) * 100}% - 4px)` }
    : { flex: '1 1 auto' }

  return (
    <>
      <Panel
        variant="grow"
        className={cn('bg-content-area', isClassic && 'rounded-2xl shadow-xl dark:shadow-sm')}
      >
        <div className="flex flex-1 min-h-0 relative overflow-hidden" data-split-container>
          {/* 左侧：TabBar + TabContent（始终保持在同一 DOM 位置，避免 Tab 切换时 unmount）
              注：宽度变化不用 transition——文字逐帧 reflow 会导致行末字符抖动，
              视觉上像"内容从右向左推送"。让左侧瞬间变宽，由右侧 absolute 滑出动画
              覆盖期内呈现"被剥离"的视觉效果。 */}
          <div
            className={cn('flex flex-col min-w-0 h-full relative', showPreview && 'mr-0.5')}
            style={leftFlexStyle}
          >
            {activeView === 'planning' ? (
              automationFormOpen ? (
                // 自动化设置页：与任务/日程同层级替换中间区，不经过 TabBar。
                <AutomationFormView />
              ) : (
                <PlanningView />
              )
            ) : activeView === 'agent-skills' ? (
              // Agent 技能视图：全屏取代 TabBar + TabContent
              <AgentSkillsView />
            ) : (
              <>
                <TabBar />
                {automationFormOpen ? (
                  // 兼容从会话内入口打开任务设置的场景。
                  <AutomationFormView />
                ) : tabs.length === 0 ? (
                  <WelcomeView />
                ) : activeTabId ? (
                  <div className="flex-1 min-h-0 titlebar-no-drag">
                    {/* 会话内容必须与侧栏/右侧面板使用同一个活动 Tab，不能延迟到旧会话。 */}
                    <TabContent tabId={activeTabId} />
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* 右侧：预览/草稿工作区。Preview 和草稿可在同一右侧槽位内并排显示。 */}
          {showRightPanel && (
            <div
              className={cn(rightPanelClosing ? 'animate-preview-slide-out' : 'flex flex-1 min-w-0')}
              style={rightPanelClosing ? closingOverlayStyle : undefined}
              onAnimationEnd={(e) => {
                if (!rightPanelClosing || e.target !== e.currentTarget) return
                if (showBrowserClosing && browserClosingState) clearClosedBrowser(browserClosingState.sessionId)
                else if (closing) setClosingState(false)
              }}
            >
              {!rightPanelClosing && (
                <div
                  className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
                  onMouseDown={handlePreviewDragStart}
                />
              )}
              <div className="flex flex-1 min-w-0 h-full overflow-hidden" data-right-workspace>
                {(showBrowserPanel || showBrowserClosing) && browserPanelSessionId && (
                  <div className="min-w-0 h-full overflow-hidden flex-1">
                    <BrowserPanel
                      key={browserPanelSessionId}
                      sessionId={browserPanelSessionId}
                      state={browserPanelState}
                      isClosing={showBrowserClosing}
                      onClose={() => requestCloseBrowser(browserPanelSessionId)}
                    />
                  </div>
                )}
                {showPreviewPane && previewSessionId && (
                  <div className="min-w-0 h-full overflow-hidden" style={previewPaneStyle}>
                    <PreviewPanel sessionId={previewSessionId} />
                  </div>
                )}
                {showBothRightPanels && (
                  <div
                    className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
                    onMouseDown={handleRightWorkspaceDragStart}
                  />
                )}
                {showScratchPanel && (
                  <div className="min-w-0 h-full overflow-hidden" style={scratchPaneStyle}>
                    <ScratchPadPane onClose={handleCloseScratchPanel} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </>
  )
}
