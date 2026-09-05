/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: TabBar + TabContent] | [RightSidePanel 可折叠]
 *
 * MainArea 支持多标签页，Settings 视图为独立覆盖。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { MainArea } from '@/components/tabs/MainArea'
import { appModeAtom } from '@/atoms/app-mode'
import { agentDiffPanelTabAtom, agentSessionComponentOpenMapAtom, agentSessionsAtom, agentSidePanelLayoutAtomFamily, agentSidePanelLayoutMapAtom, agentSidePanelSplitMapAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom, isWorkspaceComponentTab, pruneAgentSidePanelLayouts, fileBrowserExpandedPathsAtom, fileBrowserScrollTopMapAtom, pruneFileBrowserStateMap } from '@/atoms/agent-atoms'
import { leftSidebarWidthAtom } from '@/atoms/sidebar-atoms'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { clampRightPanelWidth, getRightPanelMaxWidth } from './right-panel-layout'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { productivityToolsAtom } from '@/atoms/ui-preferences'
import { useProjectActions } from '@/hooks/useProjectActions'
import { WorkspaceMemoryChangeObserver } from '@/components/agent-skills/WorkspaceMemoryChangeObserver'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { WindowControls } from '@/components/WindowControls'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { detectIsWindows } from '@/lib/platform'
import { getWindowTitlebarContentInsetClass } from '@/lib/window-titlebar-layout'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'

const MIN_RIGHT_PANEL_WIDTH = 300
// 浏览器、预览、终端等工作区在窄视图中优先允许连续阅读和基础操作；需要更多空间时可继续向左拖拽并折叠左栏。
const MIN_EXPANDED_WORKSPACE_PANEL_WIDTH = 360
// Todo 在 600px 起切换为双栏，避免将三栏导航、列表、详情强行压缩。
const MIN_TODO_PANEL_WIDTH = 600
// 两个 Pane 需要各自保留约 320px 内容区及中间分隔条。
const MIN_SPLIT_PANEL_WIDTH = 720
const EXPANDED_WORKSPACE_DEFAULT_VIEWPORT_RATIO = 2 / 5
const COLLAPSED_LEFT_SIDEBAR_WIDTH = 60

function isExpandedWorkspaceTab(tab: string | undefined): boolean {
  return Boolean(
    tab
    && (
      isWorkspaceComponentTab(tab)
      || tab === 'browser'
      || tab === 'preview'
      || tab.startsWith('browser:')
      || tab.startsWith('preview:')
      || tab.startsWith('terminal:')
      || tab.startsWith('exploration:')
      || tab === 'delegation'
    ),
  )
}

function getRightPanelMinWidth(isTodoTab: boolean, isExpandedWorkspace: boolean): number {
  return isTodoTab
    ? MIN_TODO_PANEL_WIDTH
    : isExpandedWorkspace
      ? MIN_EXPANDED_WORKSPACE_PANEL_WIDTH
      : MIN_RIGHT_PANEL_WIDTH
}

const MIN_LEFT_SIDEBAR_WIDTH = 240
const MAX_LEFT_SIDEBAR_WIDTH = 420

function clampLeftSidebarWidth(width: number): number {
  return Math.max(MIN_LEFT_SIDEBAR_WIDTH, Math.min(MAX_LEFT_SIDEBAR_WIDTH, width))
}

export function AppShell(): React.ReactElement {
  const appMode = useAtomValue(appModeAtom)
  const { workspaces, currentWorkspaceId } = useProjectActions()
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const activeRightPanelTab = useAtomValue(agentDiffPanelTabAtom).get(currentSessionId ?? '')
  const setAgentDiffPanelTabs = useSetAtom(agentDiffPanelTabAtom)
  const setAgentSessionComponentOpenMap = useSetAtom(agentSessionComponentOpenMapAtom)
  const activeRightPanelSplit = useAtomValue(agentSidePanelSplitMapAtom).get(currentSessionId ?? '') ?? null
  const isPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const automationForm = useAtomValue(automationFormAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const appContentRef = React.useRef<HTMLDivElement>(null)

  // Settings 覆盖原内容时，用 inert 移除后台焦点目标；不能在仍持有焦点的节点上设置 aria-hidden。
  React.useLayoutEffect(() => {
    appContentRef.current?.toggleAttribute('inert', settingsOpen)
  }, [settingsOpen])

  // 定时任务表单打开时隐藏右侧文件面板，让中间区域扩展到全宽（表单内含自己的右栏配置）
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const productivityTools = useAtomValue(productivityToolsAtom)
  React.useEffect(() => {
    if (!productivityTools.obsidianEnabled && activeView === 'vault') setActiveView('conversations')

    const isEnabled = (tab: string): boolean => (
      (tab !== 'todos' || productivityTools.todosEnabled)
      && (tab !== 'calendar' || productivityTools.calendarEnabled)
      && (tab !== 'vault' || productivityTools.obsidianEnabled)
    )
    setAgentSessionComponentOpenMap((previous) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(previous).map(([sessionId, tabs]) => {
        const enabledTabs = tabs.filter(isEnabled)
        if (enabledTabs.length !== tabs.length) changed = true
        return [sessionId, enabledTabs]
      }))
      return changed ? next : previous
    })
    setAgentDiffPanelTabs((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const [sessionId, tab] of previous) {
        if (!isEnabled(tab)) {
          next.set(sessionId, 'files')
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [activeView, productivityTools.calendarEnabled, productivityTools.obsidianEnabled, productivityTools.todosEnabled, setActiveView, setAgentDiffPanelTabs, setAgentSessionComponentOpenMap])
  const showRightPanel = appMode === 'agent' && !!currentSessionId && !(automationForm.open && activeView !== 'conversations') && activeView !== 'planning' && activeView !== 'agent-skills'
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  // 左侧边栏可拖拽宽度
  const [leftSidebarWidth, setLeftSidebarWidth] = useAtom(leftSidebarWidthAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const leftDragging = React.useRef(false)
  const [isDraggingLeftSidebar, setIsDraggingLeftSidebar] = React.useState(false)
  const clampedLeftSidebarWidth = clampLeftSidebarWidth(leftSidebarWidth)

  React.useEffect(() => {
    if (clampedLeftSidebarWidth !== leftSidebarWidth) {
      setLeftSidebarWidth(clampedLeftSidebarWidth)
    }
  }, [clampedLeftSidebarWidth, leftSidebarWidth, setLeftSidebarWidth])

  const handleLeftSidebarMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    leftDragging.current = true
    setIsDraggingLeftSidebar(true)
    const startX = e.clientX
    const startWidth = clampedLeftSidebarWidth
    // 记录最新光标位置，rAF 回调读取它而非调度时捕获的旧事件，避免快拖时坐标滞后
    let latestClientX = startX
    let rafId = 0

    const applyWidth = () => {
      const delta = latestClientX - startX
      setLeftSidebarWidth(clampLeftSidebarWidth(startWidth + delta))
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!leftDragging.current) return
      latestClientX = ev.clientX
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        applyWidth()
      })
    }

    const onMouseUp = () => {
      leftDragging.current = false
      setIsDraggingLeftSidebar(false)
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      // 补一次最终 flush，保证落点停在光标实际位置而非上一帧
      applyWidth()
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [clampedLeftSidebarWidth, setLeftSidebarWidth])

  // 右侧工作区可拖拽到应用视口的 3/5；每个 Session 恢复自己的普通与宽视图布局。
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setRightPanelLayouts = useSetAtom(agentSidePanelLayoutMapAtom)
  const setFileBrowserExpandedPaths = useSetAtom(fileBrowserExpandedPathsAtom)
  const setFileBrowserScrollTopMap = useSetAtom(fileBrowserScrollTopMapAtom)
  const setRightPanelSplitMap = useSetAtom(agentSidePanelSplitMapAtom)
  const [rightPanelLayout, setRightPanelLayout] = useAtom(agentSidePanelLayoutAtomFamily(currentSessionId ?? ''))
  const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth)
  const dragging = React.useRef(false)
  const currentSessionIdRef = React.useRef(currentSessionId)
  const rightPanelDragCleanup = React.useRef<(() => void) | null>(null)
  const [draggedRightPanelWidth, setDraggedRightPanelWidth] = React.useState<number | null>(null)
  currentSessionIdRef.current = currentSessionId
  const isExpandedRightWorkspace = isExpandedWorkspaceTab(activeRightPanelTab)
  // 普通宽度必须独立计算：分屏的临时 720px 下限不能被 effect 写回 Session 的普通 width。
  const ordinaryRightPanelMinimumWidth = getRightPanelMinWidth(
    activeRightPanelSplit === null && activeRightPanelTab === 'todos',
    rightPanelLayout.hasOpenedWideWorkspace || (activeRightPanelSplit === null && isExpandedRightWorkspace),
  )
  const rightPanelMinimumWidth = activeRightPanelSplit
    ? MIN_SPLIT_PANEL_WIDTH
    : ordinaryRightPanelMinimumWidth
  const leftSidebarContentWidth = sidebarCollapsed ? COLLAPSED_LEFT_SIDEBAR_WIDTH : clampedLeftSidebarWidth
  // 经典界面已移除，侧栏始终只占内容宽度与分隔线。
  const leftSidebarOccupiedWidth = leftSidebarContentWidth + 1
  // 右侧面板是完整的工作区：不论当前为文件、改动或扩展 Tab，继续向左拖拽时
  // 都应能收起左侧 Sidebar，并使用释放出的全部宽度；主区域仍由 MIN_MAIN_AREA_WIDTH 兜底。
  const canUseCollapsedSidebarSpace = sidebarCollapsed
  const canAutoCollapseSidebarForRightPanel = !sidebarCollapsed
  const clampedRightPanelWidth = clampRightPanelWidth(
    rightPanelLayout.width,
    viewportWidth,
    ordinaryRightPanelMinimumWidth,
    leftSidebarOccupiedWidth,
    canUseCollapsedSidebarSpace,
  )
  const effectiveWidePanelWidth = rightPanelLayout.widePanelWidthOverride === null
    ? clampRightPanelWidth(
      Math.floor(viewportWidth * EXPANDED_WORKSPACE_DEFAULT_VIEWPORT_RATIO),
      viewportWidth,
      rightPanelMinimumWidth,
      leftSidebarOccupiedWidth,
      canUseCollapsedSidebarSpace,
    )
    : clampRightPanelWidth(
      rightPanelLayout.widePanelWidthOverride,
      viewportWidth,
      rightPanelMinimumWidth,
      leftSidebarOccupiedWidth,
      canUseCollapsedSidebarSpace,
    )
  // 打开任一扩展工作区后，当前会话保持该宽度，避免在右侧 Tab 间切换时反复缩放。
  // 并排仅临时借用宽布局；退出后自动回到 Session 先前的普通/宽工作区宽度。
  const usesWidePanelLayout = rightPanelLayout.hasOpenedWideWorkspace || activeRightPanelSplit !== null
  const persistedRightPanelWidth = usesWidePanelLayout ? effectiveWidePanelWidth : clampedRightPanelWidth
  const displayedRightPanelWidth = draggedRightPanelWidth ?? persistedRightPanelWidth

  React.useEffect(() => {
    return () => rightPanelDragCleanup.current?.()
  }, [currentSessionId])

  React.useEffect(() => {
    setRightPanelLayouts((previous) => pruneAgentSidePanelLayouts(previous, agentSessions, currentSessionId ?? undefined))
    const retainedSessionIds = new Set(agentSessions.map((session) => session.id))
    if (currentSessionId) retainedSessionIds.add(currentSessionId)
    setFileBrowserExpandedPaths((previous) => pruneFileBrowserStateMap(previous, retainedSessionIds))
    setFileBrowserScrollTopMap((previous) => pruneFileBrowserStateMap(previous, retainedSessionIds))
    setRightPanelSplitMap((previous) => {
      const next = new Map([...previous].filter(([sessionId]) => retainedSessionIds.has(sessionId)))
      return next.size === previous.size ? previous : next
    })
  }, [agentSessions, currentSessionId, setFileBrowserExpandedPaths, setFileBrowserScrollTopMap, setRightPanelLayouts, setRightPanelSplitMap])

  React.useEffect(() => {
    // 分屏本身是临时宽布局，不能因为其中一个 Pane 是 Browser/Preview 就污染退出后的宽度。
    if (!activeRightPanelSplit && isExpandedRightWorkspace && currentSessionId && !rightPanelLayout.hasOpenedWideWorkspace) {
      setRightPanelLayout((previous) => ({ ...previous, hasOpenedWideWorkspace: true }))
    }
  }, [activeRightPanelSplit, currentSessionId, isExpandedRightWorkspace, rightPanelLayout.hasOpenedWideWorkspace, setRightPanelLayout])

  React.useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  React.useEffect(() => {
    if (currentSessionId && clampedRightPanelWidth !== rightPanelLayout.width) {
      setRightPanelLayout((previous) => ({ ...previous, width: clampedRightPanelWidth }))
    }
  }, [clampedRightPanelWidth, currentSessionId, rightPanelLayout.width, setRightPanelLayout])

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (!currentSessionId) return

    e.preventDefault()
    rightPanelDragCleanup.current?.()
    dragging.current = true
    const dragSessionId = currentSessionId
    const startX = e.clientX
    const startWidth = displayedRightPanelWidth
    const isWideWorkspace = usesWidePanelLayout || isExpandedRightWorkspace
    let sidebarCollapsedDuringDrag = sidebarCollapsed
    // 记录最新光标位置，rAF 回调读取它而非调度时捕获的旧事件，避免快拖时坐标滞后
    let latestClientX = startX
    let latestWidth = startWidth
    let rafId = 0
    let cancelDrag: () => void

    const applyWidth = () => {
      const requestedWidth = startWidth + startX - latestClientX
      const normalMaximumWidth = getRightPanelMaxWidth(viewportWidth, leftSidebarOccupiedWidth)
      const shouldCollapseSidebar = canAutoCollapseSidebarForRightPanel && requestedWidth > normalMaximumWidth
      const nextSidebarCollapsed = sidebarCollapsedDuringDrag || shouldCollapseSidebar
      const nextLeftSidebarContentWidth = nextSidebarCollapsed ? COLLAPSED_LEFT_SIDEBAR_WIDTH : clampedLeftSidebarWidth
      const nextLeftSidebarOccupiedWidth = nextLeftSidebarContentWidth + 1
      const allowFullAvailableWidth = nextSidebarCollapsed && (
        activeRightPanelSplit !== null || isExpandedRightWorkspace || rightPanelLayout.hasOpenedWideWorkspace
      )

      if (shouldCollapseSidebar && !sidebarCollapsedDuringDrag) {
        sidebarCollapsedDuringDrag = true
        setSidebarCollapsed(true)
      }
      latestWidth = clampRightPanelWidth(
        requestedWidth,
        viewportWidth,
        rightPanelMinimumWidth,
        nextLeftSidebarOccupiedWidth,
        allowFullAvailableWidth,
      )
      setDraggedRightPanelWidth(latestWidth)
    }

    const finishDrag = (persist: boolean) => {
      dragging.current = false
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      setDraggedRightPanelWidth(null)
      if (rightPanelDragCleanup.current === cancelDrag) rightPanelDragCleanup.current = null

      // 会话切换后取消旧拖拽，不能把旧闭包的尺寸写入先前的 Session。
      if (persist && currentSessionIdRef.current === dragSessionId) {
        setRightPanelLayout((previous) => isWideWorkspace
          ? { ...previous, widePanelWidthOverride: latestWidth }
          : { ...previous, width: latestWidth })
      }
    }

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      latestClientX = ev.clientX
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        applyWidth()
      })
    }

    const onMouseUp = () => {
      // 补一次最终 flush，保证落点停在光标实际位置而非上一帧。
      applyWidth()
      finishDrag(true)
    }

    cancelDrag = () => finishDrag(false)
    rightPanelDragCleanup.current = cancelDrag
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [activeRightPanelSplit, canAutoCollapseSidebarForRightPanel, clampedLeftSidebarWidth, currentSessionId, displayedRightPanelWidth, isExpandedRightWorkspace, leftSidebarOccupiedWidth, rightPanelLayout.hasOpenedWideWorkspace, rightPanelMinimumWidth, setRightPanelLayout, setSidebarCollapsed, sidebarCollapsed, usesWidePanelLayout, viewportWidth])

  return (
    <>
      <WindowControls />

      <div className="shell-bg relative h-screen w-screen overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        <div
          ref={appContentRef}
          className={cn('flex h-full w-full', getWindowTitlebarContentInsetClass(isWindows), settingsOpen && 'hidden')}
        >
            {/* 左侧边栏：可折叠，可拖拽调整宽度 */}
            <div className="relative z-[60] crt-sidebar">
              <LeftSidebar width={clampedLeftSidebarWidth} noTransition={isDraggingLeftSidebar} />
              {/* 侧边栏展开时显示拖拽手柄，折叠态隐藏 */}
              {!sidebarCollapsed && (
                <div
                  className={cn(
                    'absolute right-0 top-0 bottom-0 w-4 translate-x-1/2 cursor-col-resize hover:bg-primary/5 active:bg-primary/50 transition-colors z-20'
                  )}
                  onMouseDown={handleLeftSidebarMouseDown}
                />
              )}
            </div>
            <div aria-hidden="true" className="relative z-[61] w-px flex-shrink-0 bg-border/80 dark:bg-border/70" />

            {/* 中间容器：relative z-[60] 使其在 z-50 拖动区域之上 */}
            <div className="flex-1 min-w-0 relative z-[60]">
              {/* 主内容区域（TabBar + TabContent） */}
              <MainArea />
              {/* 全局 Toast 固定在 Agent 历史主区右上角，不进入右侧原生浏览器面板。 */}
              <Toaster position="top-right" offset={{ top: 58, right: 12 }} className="agent-history-toaster" />
            </div>

            {/* 右侧边栏：Agent 文件面板 */}
            {showRightPanel && (
              <div
                className="relative z-[60] flex flex-shrink-0 items-stretch crt-sidebar"
              >
                <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-px bg-border/80 dark:bg-border/70" />
                {/* 拖拽手柄 */}
                {isPanelOpen && (
                  <div
                    className={cn(
                      'absolute left-0 top-0 bottom-0 w-[8px] -translate-x-1/2 cursor-col-resize active:bg-primary/50 transition-colors z-20'
                    )}
                    onMouseDown={handleMouseDown}
                  />
                )}
                <RightSidePanel width={displayedRightPanelWidth} />
              </div>
            )}
        </div>
        {currentWorkspace && <WorkspaceMemoryChangeObserver workspaceSlug={currentWorkspace.slug} />}
        {settingsOpen && (
          <div className="absolute inset-0 z-[60]">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        )}

      </div>
    </>
  )
}
