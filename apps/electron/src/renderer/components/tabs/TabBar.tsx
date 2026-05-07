/**
 * TabBar — 顶部标签栏
 *
 * 显示所有打开的标签页，支持：
 * - 点击切换标签
 * - 中键关闭标签
 * - 拖拽重排序
 * - Chrome 风格等分宽度（溢出时可横向滚动）
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  tabIndicatorMapAtom,
  openTab,
  reorderTabs,
} from '@/atoms/tab-atoms'
import type { TabItem } from '@/atoms/tab-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { TabBarItem } from './TabBarItem'
import { TabCloseConfirmDialog } from './TabCloseConfirmDialog'
import { useCloseTab } from '@/hooks/useCloseTab'
import { detectIsWindows } from '@/lib/platform'
import { cn } from '@/lib/utils'

export function TabBar(): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const indicatorMap = useAtomValue(tabIndicatorMapAtom)

  // Tab 切换时同步 sidebar 状态
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  // 统一关闭逻辑：含 Agent 子进程 stop + 流式中的确认对话框
  // 详见 useCloseTab，修复 Issue #357 的 UI→IPC 断链
  const { requestClose } = useCloseTab()

  // 拖拽状态
  const dragState = React.useRef<{
    dragging: boolean
    tabId: string
    startX: number
    startIndex: number
  } | null>(null)

  const handleActivate = React.useCallback((tabId: string) => {
    setActiveTabId(tabId)

    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    if (tab.type === 'chat') {
      setAppMode('chat')
      setCurrentConversationId(tab.sessionId)
    } else if (tab.type === 'agent') {
      setAppMode('agent')
      setCurrentAgentSessionId(tab.sessionId)

      // 清除该会话的"已完成未查看"标记
      setUnviewedCompleted((prev) => {
        if (!prev.has(tab.sessionId)) return prev
        const next = new Set(prev)
        next.delete(tab.sessionId)
        return next
      })

      const session = agentSessions.find((s) => s.id === tab.sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
    }
  }, [setActiveTabId, tabs, agentSessions, setAppMode, setCurrentConversationId, setCurrentAgentSessionId, setCurrentAgentWorkspaceId, setUnviewedCompleted])

  const handleDragStart = React.useCallback((tabId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return // 只处理左键
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    dragState.current = {
      dragging: false,
      tabId,
      startX: e.clientX,
      startIndex: idx,
    }

    const handleMove = (me: PointerEvent): void => {
      if (!dragState.current) return
      const dx = Math.abs(me.clientX - dragState.current.startX)
      if (dx > 5) dragState.current.dragging = true
    }

    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      dragState.current = null
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }, [tabs])

  if (tabs.length === 0) return <div className="h-[34px] titlebar-drag-region" />

  return (
    <>
      <TabBarInner
        tabs={tabs}
        activeTabId={activeTabId}
        streamingMap={indicatorMap}
        onActivate={handleActivate}
        onClose={requestClose}
        onDragStart={handleDragStart}
      />
      <TabCloseConfirmDialog />
    </>
  )
}

/** 内部组件：管理全局 hover 状态，确保同一时刻只有一个预览面板 */
function TabBarInner({
  tabs,
  activeTabId,
  streamingMap,
  onActivate,
  onClose,
  onDragStart,
}: {
  tabs: TabItem[]
  activeTabId: string | null
  streamingMap: Map<string, SessionIndicatorStatus>
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onDragStart: (tabId: string, e: React.PointerEvent) => void
}): React.ReactElement {
  const [hoveredTabId, setHoveredTabId] = React.useState<string | null>(null)
  const [isLeaving, setIsLeaving] = React.useState(false)
  const enterTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const leaveTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  // 滚动容器 ref
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // 鼠标滚轮横向滚动
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (scrollRef.current) {
      e.preventDefault()
      scrollRef.current.scrollLeft += e.deltaY || e.deltaX
    }
  }, [])

  // 新增 tab 时自动滚动到最右
  const prevTabCount = React.useRef(tabs.length)
  React.useEffect(() => {
    if (tabs.length > prevTabCount.current && scrollRef.current) {
      scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' })
    }
    prevTabCount.current = tabs.length
  }, [tabs.length])

  React.useEffect(() => {
    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  const handleTabHoverEnter = React.useCallback((tabId: string) => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
    setIsLeaving(false)

    // 如果已经有面板打开（从一个 Tab 滑到另一个），立即切换
    if (hoveredTabId) {
      setHoveredTabId(tabId)
    } else {
      // 首次 hover，延迟 300ms
      enterTimerRef.current = setTimeout(() => setHoveredTabId(tabId), 300)
    }
  }, [hoveredTabId])

  const handleTabHoverLeave = React.useCallback(() => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setIsLeaving(true)
      fadeTimerRef.current = setTimeout(() => {
        setHoveredTabId(null)
        setIsLeaving(false)
      }, 80)
    }, 200)
  }, [])

  // 面板的 hover 进入（阻止关闭）
  const handlePanelHoverEnter = React.useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    setIsLeaving(false)
  }, [])

  return (
    <div className="flex items-end h-[34px] tabbar-bg relative">
      {/* 顶部 TabBar 的空白区域必须保持可拖拽，尤其是 macOS/Windows 自定义标题栏。
          注意：不要把 titlebar-no-drag 加到下面的整条 flex 容器上，否则标签右侧空白会再次失去拖拽能力。
          前景 flex 容器也必须是 drag-region，因为它会覆盖在背景拖拽层之上。
          需要交互的单个 Tab 会在 TabBarItem 内部自己声明 titlebar-no-drag。 */}
      <div className="absolute inset-0 titlebar-drag-region" />

      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className={cn("relative flex items-end flex-1 min-w-0 overflow-x-auto scrollbar-none titlebar-drag-region", isWindows && "pr-[140px]")}
      >
        {tabs.map((tab) => (
          <TabBarItem
            key={tab.id}
            id={tab.id}
            type={tab.type}
            title={tab.title}
            isActive={tab.id === activeTabId}
            isStreaming={streamingMap.get(tab.id) ?? 'idle'}
            isHovered={hoveredTabId === tab.id}
            isLeaving={hoveredTabId === tab.id && isLeaving}
            onActivate={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
            onMiddleClick={() => onClose(tab.id)}
            onDragStart={(e) => onDragStart(tab.id, e)}
            onHoverEnter={() => handleTabHoverEnter(tab.id)}
            onHoverLeave={handleTabHoverLeave}
            onPanelHoverEnter={handlePanelHoverEnter}
            onPanelHoverLeave={handleTabHoverLeave}
          />
        ))}
      </div>
    </div>
  )
}
