/**
 * TabBar — 顶部标签栏
 *
 * 显示所有打开的标签页，支持：
 * - 点击切换标签
 * - 中键关闭标签
 * - 拖拽重排序
 * - 溢出时水平滚动
 * - 分屏模式切换按钮
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  tabsAtom,
  splitLayoutAtom,
  tabStreamingMapAtom,
  activeTabIdAtom,
  openTab,
  closeTab,
  focusTab,
  reorderTabs,
} from '@/atoms/tab-atoms'
import {
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
  currentConversationIdAtom,
} from '@/atoms/chat-atoms'
import {
  agentSidePanelOpenMapAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { TabBarItem } from './TabBarItem'
import { SplitModeToggle } from './SplitModeToggle'

export function TabBar(): React.ReactElement {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const streamingMap = useAtomValue(tabStreamingMapAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Tab 切换时同步 sidebar 状态
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)

  // per-conversation/session Map atoms（用于关闭标签时清理）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)

  /** 清理关闭标签对应的 per-conversation/session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((tabId: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(tabId)) return prev
      const map = new Map(prev)
      map.delete(tabId)
      return map
    }
    // Chat per-conversation atoms
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    // Agent per-session atoms
    setAgentSidePanelOpen(deleteKey)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setAgentSidePanelOpen])

  // 拖拽状态
  const dragState = React.useRef<{
    dragging: boolean
    tabId: string
    startX: number
    startIndex: number
  } | null>(null)

  const handleActivate = React.useCallback((tabId: string) => {
    setLayout((prev) => focusTab(prev, tabId))

    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    if (tab.type === 'chat') {
      setAppMode('chat')
      setCurrentConversationId(tab.sessionId)
    } else if (tab.type === 'agent') {
      setAppMode('agent')
      setCurrentAgentSessionId(tab.sessionId)

      const session = agentSessions.find((s) => s.id === tab.sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
    }
  }, [setLayout, tabs, agentSessions, setAppMode, setCurrentConversationId, setCurrentAgentSessionId, setCurrentAgentWorkspaceId])

  const handleClose = React.useCallback((tabId: string) => {
    setTabs((prevTabs) => {
      const result = closeTab(prevTabs, layout, tabId)
      // 需要同时更新 layout，使用 setTimeout 保证原子性
      setTimeout(() => setLayout(result.layout), 0)
      return result.tabs
    })
    // 清理 per-conversation/session Map atoms 条目，防止内存泄漏
    cleanupMapAtoms(tabId)
  }, [layout, setTabs, setLayout, cleanupMapAtoms])

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

  // 水平滚动支持
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

  if (tabs.length === 0) return <div className="h-[34px] titlebar-drag-region" />

  return (
    <div className="flex items-end h-[34px] tabbar-bg">
      {/* 标签区域（可滚动） */}
      <div
        ref={scrollRef}
        className="flex items-end shrink min-w-0 max-w-full overflow-x-auto scrollbar-none titlebar-no-drag"
        onWheel={handleWheel}
      >
        {tabs.map((tab, _index) => (
          <TabBarItem
            key={tab.id}
            id={tab.id}
            type={tab.type}
            title={tab.title}
            isActive={tab.id === activeTabId}
            isStreaming={streamingMap.get(tab.id) ?? false}
            onActivate={() => handleActivate(tab.id)}
            onClose={() => handleClose(tab.id)}
            onMiddleClick={() => handleClose(tab.id)}
            onDragStart={(e) => handleDragStart(tab.id, e)}
          />
        ))}
      </div>

      {/* 空白拖拽区域：支持拖动窗口 */}
      <div className="flex-1 h-full titlebar-drag-region" />

      {/* 分屏模式切换 */}
      <SplitModeToggle />
    </div>
  )
}
