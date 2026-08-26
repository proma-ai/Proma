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
import { agentDiffPanelTabAtom, agentSessionsAtom, agentSidePanelLayoutAtomFamily, agentSidePanelLayoutMapAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom, isWorkspaceComponentTab, pruneAgentSidePanelLayouts } from '@/atoms/agent-atoms'
import { leftSidebarWidthAtom } from '@/atoms/sidebar-atoms'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useProjectActions } from '@/hooks/useProjectActions'
import { WorkspaceMemoryChangeObserver } from '@/components/agent-skills/WorkspaceMemoryChangeObserver'
import { interfaceVariantAtom } from '@/atoms/theme'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { WindowControls } from '@/components/WindowControls'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { detectIsWindows, WINDOW_CONTROLS_INSET_RIGHT } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'

const MIN_RIGHT_PANEL_WIDTH = 360
// 探索/委派 Agent 需要同时容纳消息正文、工具活动和输入区；略宽于普通文件栏，
// 但显著小于浏览器/预览的半屏宽视图。
const MIN_AGENT_SESSION_PANEL_WIDTH = 480
// Todo、日程、能力和记忆都含列表与详情；与临时 Agent 一样需要可读的并排空间。
const MIN_WORKSPACE_COMPONENT_PANEL_WIDTH = 480
const RIGHT_PANEL_MAX_VIEWPORT_RATIO = 3 / 5
const WIDE_RIGHT_PANEL_DEFAULT_VIEWPORT_RATIO = 1 / 2
// 窄窗口时优先保留主会话的最小可读宽度；Agent 侧栏的 480px 仅在空间足够时强制。
const MIN_MAIN_AREA_WIDTH = 320
const COLLAPSED_LEFT_SIDEBAR_WIDTH = 60
const CLASSIC_LEFT_SIDEBAR_LEADING_PADDING = 8

function getRightPanelMinWidth(isAgentSessionTab: boolean, isWorkspaceComponent: boolean): number {
  return isAgentSessionTab
    ? MIN_AGENT_SESSION_PANEL_WIDTH
    : isWorkspaceComponent
      ? MIN_WORKSPACE_COMPONENT_PANEL_WIDTH
      : MIN_RIGHT_PANEL_WIDTH
}

function getRightPanelMaxWidth(viewportWidth: number, leftSidebarOccupiedWidth: number): number {
  // 宽视图不超过 3/5；更重要的是右栏不能侵占主工作区的最小可读宽度。
  return Math.max(0, Math.min(
    Math.floor(viewportWidth * RIGHT_PANEL_MAX_VIEWPORT_RATIO),
    viewportWidth - leftSidebarOccupiedWidth - MIN_MAIN_AREA_WIDTH,
  ))
}

function clampRightPanelWidth(
  width: number,
  viewportWidth: number,
  minimumWidth = MIN_RIGHT_PANEL_WIDTH,
  leftSidebarOccupiedWidth = 0,
): number {
  const maximumWidth = getRightPanelMaxWidth(viewportWidth, leftSidebarOccupiedWidth)
  // 480px 是 Agent 会话的理想下限；在窄窗口中放宽它，而不是把中间会话挤到不可用。
  const effectiveMinimumWidth = Math.min(minimumWidth, maximumWidth)
  return Math.max(effectiveMinimumWidth, Math.min(maximumWidth, width))
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
  const isPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const automationForm = useAtomValue(automationFormAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const isClassic = interfaceVariant === 'classic'
  // 定时任务表单打开时隐藏右侧文件面板，让中间区域扩展到全宽（表单内含自己的右栏配置）
  const activeView = useAtomValue(activeViewAtom)
  const showRightPanel = appMode === 'agent' && !!currentSessionId && !(automationForm.open && activeView !== 'conversations') && activeView !== 'planning' && activeView !== 'agent-skills'
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  // 左侧边栏可拖拽宽度
  const [leftSidebarWidth, setLeftSidebarWidth] = useAtom(leftSidebarWidthAtom)
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
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
  const [rightPanelLayout, setRightPanelLayout] = useAtom(agentSidePanelLayoutAtomFamily(currentSessionId ?? ''))
  const [viewportWidth, setViewportWidth] = React.useState(() => window.innerWidth)
  const dragging = React.useRef(false)
  const currentSessionIdRef = React.useRef(currentSessionId)
  const rightPanelDragCleanup = React.useRef<(() => void) | null>(null)
  const [draggedRightPanelWidth, setDraggedRightPanelWidth] = React.useState<number | null>(null)
  currentSessionIdRef.current = currentSessionId
  const isAgentSessionRightTab = Boolean(
    activeRightPanelTab?.startsWith('exploration:') || activeRightPanelTab?.startsWith('delegation:'),
  )
  const rightPanelMinimumWidth = getRightPanelMinWidth(isAgentSessionRightTab, Boolean(activeRightPanelTab && isWorkspaceComponentTab(activeRightPanelTab)))
  const leftSidebarContentWidth = sidebarCollapsed ? COLLAPSED_LEFT_SIDEBAR_WIDTH : clampedLeftSidebarWidth
  const leftSidebarOccupiedWidth = leftSidebarContentWidth + (isClassic ? CLASSIC_LEFT_SIDEBAR_LEADING_PADDING : 1)
  const clampedRightPanelWidth = clampRightPanelWidth(
    rightPanelLayout.width,
    viewportWidth,
    rightPanelMinimumWidth,
    leftSidebarOccupiedWidth,
  )
  const isWideRightWorkspace = Boolean(
    activeRightPanelTab?.startsWith('preview:') || activeRightPanelTab?.startsWith('browser:'),
  )
  // 首次打开预览/浏览器后，工作区维持宽视图；切回文件/改动不会自动收窄，交给用户拖拽决定。
  const effectiveWidePanelWidth = rightPanelLayout.widePanelWidthOverride === null
    ? clampRightPanelWidth(Math.floor(viewportWidth * WIDE_RIGHT_PANEL_DEFAULT_VIEWPORT_RATIO), viewportWidth, MIN_RIGHT_PANEL_WIDTH, leftSidebarOccupiedWidth)
    : clampRightPanelWidth(rightPanelLayout.widePanelWidthOverride, viewportWidth, MIN_RIGHT_PANEL_WIDTH, leftSidebarOccupiedWidth)
  // 会话中一旦打开过浏览器/预览等宽视图，后续切换到较窄 Tab 也保留该宽度，
  // 以当前已打开 Tab 的最大宽度为准，避免切换时工作区来回缩放。
  const usesWidePanelLayout = rightPanelLayout.hasOpenedWideWorkspace
  const persistedRightPanelWidth = usesWidePanelLayout ? effectiveWidePanelWidth : clampedRightPanelWidth
  const displayedRightPanelWidth = draggedRightPanelWidth ?? persistedRightPanelWidth

  React.useEffect(() => {
    return () => rightPanelDragCleanup.current?.()
  }, [currentSessionId])

  React.useEffect(() => {
    setRightPanelLayouts((previous) => pruneAgentSidePanelLayouts(previous, agentSessions, currentSessionId ?? undefined))
  }, [agentSessions, currentSessionId, setRightPanelLayouts])

  React.useEffect(() => {
    if (isWideRightWorkspace && currentSessionId && !rightPanelLayout.hasOpenedWideWorkspace) {
      setRightPanelLayout((previous) => ({ ...previous, hasOpenedWideWorkspace: true }))
    }
  }, [currentSessionId, isWideRightWorkspace, rightPanelLayout.hasOpenedWideWorkspace, setRightPanelLayout])

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
    const isWideWorkspace = usesWidePanelLayout
    // 记录最新光标位置，rAF 回调读取它而非调度时捕获的旧事件，避免快拖时坐标滞后
    let latestClientX = startX
    let latestWidth = startWidth
    let rafId = 0
    let cancelDrag: () => void

    const applyWidth = () => {
      const delta = startX - latestClientX
      latestWidth = clampRightPanelWidth(startWidth + delta, viewportWidth, rightPanelMinimumWidth, leftSidebarOccupiedWidth)
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
  }, [currentSessionId, displayedRightPanelWidth, leftSidebarOccupiedWidth, rightPanelMinimumWidth, setRightPanelLayout, usesWidePanelLayout, viewportWidth])

  return (
    <>
      {/* 可拖动标题栏区域，用于窗口拖动。
          Windows 上必须避开右上角的 WindowControls 区域（buttons ~118px + 8px buffer = 126px），
          否则 drag-region 与按钮区的 hitmask 重叠会让 OS 把单击当成标题栏点击，
          表现为"按钮要双击才响应"。 */}
      <div
        className={cn(
          'titlebar-drag-region fixed top-0 left-0 h-[50px] z-50',
          isWindows ? WINDOW_CONTROLS_INSET_RIGHT : 'right-0'
        )}
      />

      {/* Windows 自定义窗口控制按钮（最小化/最大化/关闭） */}
      <WindowControls />

      <div className="shell-bg relative h-screen w-screen overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        <div className={cn('flex h-full w-full', settingsOpen && 'hidden')} aria-hidden={settingsOpen}>
            {/* 左侧边栏：可折叠，可拖拽调整宽度 */}
            <div className={cn(isClassic ? 'p-2 pr-0' : '', 'relative z-[60] crt-sidebar')}>
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
            {!isClassic && (
              <div aria-hidden="true" className="relative z-[61] w-px flex-shrink-0 bg-border/80 dark:bg-border/70" />
            )}

            {/* 中间容器：relative z-[60] 使其在 z-50 拖动区域之上 */}
            <div className={cn('flex-1 min-w-0 relative z-[60]', isClassic && 'p-2')}>
              {/* 主内容区域（TabBar + TabContent） */}
              <MainArea />
              {/* 全局 Toast 固定在 Agent 历史主区右上角，不进入右侧原生浏览器面板。 */}
              <Toaster position="top-right" offset={{ top: 58, right: 12 }} className="agent-history-toaster" />
            </div>

            {/* 右侧边栏：Agent 文件面板 */}
            {showRightPanel && (
              <div
                className={cn(
                  'relative z-[60] flex flex-shrink-0 items-stretch crt-sidebar',
                  isClassic
                    ? 'transition-[padding] duration-300 ease-in-out'
                    : '',
                  isClassic && (isPanelOpen ? 'p-2' : 'p-0')
                )}
              >
                {!isClassic && (
                  <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-px bg-border/80 dark:bg-border/70" />
                )}
                {/* 拖拽手柄 */}
                {isPanelOpen && (
                  <div
                    className={cn(
                      'absolute left-0 top-0 bottom-0 w-[8px] -translate-x-1/2 cursor-col-resize active:bg-primary/50 transition-colors',
                      isClassic ? 'z-10' : 'z-20'
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
