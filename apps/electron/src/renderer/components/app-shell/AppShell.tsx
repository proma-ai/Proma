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
import { agentSidePanelWidthAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom } from '@/atoms/agent-atoms'
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

const MIN_RIGHT_PANEL_WIDTH = 300
const MAX_RIGHT_PANEL_WIDTH = 560

function clampRightPanelWidth(width: number): number {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, width))
}

const MIN_LEFT_SIDEBAR_WIDTH = 300
const MAX_LEFT_SIDEBAR_WIDTH = 420

function clampLeftSidebarWidth(width: number): number {
  return Math.max(MIN_LEFT_SIDEBAR_WIDTH, Math.min(MAX_LEFT_SIDEBAR_WIDTH, width))
}

export function AppShell(): React.ReactElement {
  const appMode = useAtomValue(appModeAtom)
  const { workspaces, currentWorkspaceId } = useProjectActions()
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const isPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const automationForm = useAtomValue(automationFormAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const isClassic = interfaceVariant === 'classic'
  // 定时任务表单打开时隐藏右侧文件面板，让中间区域扩展到全宽（表单内含自己的右栏配置）
  const activeView = useAtomValue(activeViewAtom)
  const showRightPanel = appMode === 'agent' && !!currentSessionId && !automationForm.open && activeView !== 'planning' && activeView !== 'agent-skills'
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

  // 右侧面板可拖拽宽度
  const [rightPanelWidth, setRightPanelWidth] = useAtom(agentSidePanelWidthAtom)
  const dragging = React.useRef(false)
  const clampedRightPanelWidth = clampRightPanelWidth(rightPanelWidth)

  React.useEffect(() => {
    if (clampedRightPanelWidth !== rightPanelWidth) {
      setRightPanelWidth(clampedRightPanelWidth)
    }
  }, [clampedRightPanelWidth, rightPanelWidth, setRightPanelWidth])

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startWidth = clampedRightPanelWidth
    // 记录最新光标位置，rAF 回调读取它而非调度时捕获的旧事件，避免快拖时坐标滞后
    let latestClientX = startX
    let rafId = 0

    const applyWidth = () => {
      const delta = startX - latestClientX
      setRightPanelWidth(clampRightPanelWidth(startWidth + delta))
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
      dragging.current = false
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
  }, [clampedRightPanelWidth, setRightPanelWidth])

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
            </div>

            {/* 右侧边栏：Agent 文件面板 */}
            {showRightPanel && (
              <div
                className={cn(
                  'relative z-[60] flex flex-shrink-0 items-stretch crt-sidebar',
                  isClassic
                    ? 'transition-[padding] duration-300 ease-in-out'
                    : '',
                  isClassic && (isPanelOpen ? 'p-2 pl-0' : 'p-0')
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
                <RightSidePanel width={clampedRightPanelWidth} />
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
