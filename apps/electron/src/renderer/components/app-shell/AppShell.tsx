/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: TabBar + TabContent] | [RightSidePanel 可折叠]
 *
 * MainArea 支持多标签页，Settings 视图为独立覆盖。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { appModeAtom } from '@/atoms/app-mode'
import { agentSidePanelWidthAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom } from '@/atoms/agent-atoms'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { WindowControls } from '@/components/WindowControls'
import { detectIsWindows } from '@/lib/platform'
import { cn } from '@/lib/utils'

const MIN_RIGHT_PANEL_WIDTH = 300
const MAX_RIGHT_PANEL_WIDTH = 420

function clampRightPanelWidth(width: number): number {
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, width))
}

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const isPanelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const automationForm = useAtomValue(automationFormAtom)
  // 定时任务表单打开时隐藏右侧文件面板，让中间区域扩展到全宽（表单内含自己的右栏配置）
  const activeView = useAtomValue(activeViewAtom)
  const showRightPanel = appMode === 'agent' && !!currentSessionId && !automationForm.open && activeView !== 'automations' && activeView !== 'agent-skills'
  const isWindows = React.useMemo(() => detectIsWindows(), [])

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
    let rafId = 0

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = startX - ev.clientX
        const newWidth = clampRightPanelWidth(startWidth + delta)
        setRightPanelWidth(newWidth)
      })
    }

    const onMouseUp = () => {
      dragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [clampedRightPanelWidth, setRightPanelWidth])

  return (
    <AppShellProvider value={contextValue}>
      {/* 可拖动标题栏区域，用于窗口拖动。
          Windows 上必须避开右上角的 WindowControls 区域（buttons ~118px + 8px buffer = 126px），
          否则 drag-region 与按钮区的 hitmask 重叠会让 OS 把单击当成标题栏点击，
          表现为"按钮要双击才响应"。 */}
      <div
        className={cn(
          'titlebar-drag-region fixed top-0 left-0 h-[50px] z-50',
          isWindows ? 'right-[126px]' : 'right-0'
        )}
      />

      {/* Windows 自定义窗口控制按钮（最小化/最大化/关闭） */}
      <WindowControls />

      <div className="shell-bg h-screen w-screen flex overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        {/* 左侧边栏：可折叠，带圆角和内边距 */}
        <div className="p-2 pr-0 relative z-[60]">
          <LeftSidebar />
        </div>

        {/* 中间容器：relative z-[60] 使其在 z-50 拖动区域之上 */}
        <div className="flex-1 min-w-0 p-2 relative z-[60]">
          {/* 主内容区域（TabBar + TabContent） */}
          <MainArea />
        </div>

        {/* 右侧边栏：Agent 文件面板，拖拽手柄在间距中间 */}
        {showRightPanel && (
          <div className={cn('relative z-[60] flex items-stretch transition-[padding] duration-300 ease-in-out', isPanelOpen ? 'p-2 pl-0' : 'p-0')}>
            {/* 拖拽手柄 — 绝对定位，居中于主区域和右侧面板的缝隙 */}
            {isPanelOpen && (
              <div
                className="absolute left-0 top-0 bottom-0 w-[8px] -translate-x-1/2 cursor-col-resize active:bg-primary/50 transition-colors z-10"
                onMouseDown={handleMouseDown}
              />
            )}
            <RightSidePanel width={clampedRightPanelWidth} />
          </div>
        )}
      </div>
    </AppShellProvider>
  )
}
