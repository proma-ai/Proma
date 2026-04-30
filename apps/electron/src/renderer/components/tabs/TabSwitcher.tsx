/**
 * TabSwitcher — Ctrl+Tab 标签快速切换器
 *
 * Chrome 风格的 Ctrl+Tab 行为：
 * 1. 快速按放 Ctrl+Tab → 切换到上一个标签（MRU 顺序）
 * 2. 长按 Ctrl + 反复按 Tab → 弹出选择器，循环选中，松开 Ctrl 确认
 * 3. Ctrl+Shift+Tab → 反向循环
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { MessageSquare, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  tabsAtom,
  activeTabIdAtom,
  tabMruAtom,
  tabIndicatorMapAtom,
} from '@/atoms/tab-atoms'
import type { TabItem } from '@/atoms/tab-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  currentAgentSessionIdAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

export function TabSwitcher(): React.ReactElement | null {
  const tabs = useAtomValue(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const [mruOrder, setMruOrder] = useAtom(tabMruAtom)
  const indicatorMap = useAtomValue(tabIndicatorMapAtom)

  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Refs 用于事件回调中读取最新值（避免闭包过期）
  const isOpenRef = useRef(false)
  const selectedIndexRef = useRef(0)
  const mruOrderRef = useRef<string[]>([])
  const tabsRef = useRef(tabs)
  const agentSessionsRef = useRef(agentSessions)

  isOpenRef.current = isOpen
  selectedIndexRef.current = selectedIndex
  mruOrderRef.current = mruOrder
  tabsRef.current = tabs
  agentSessionsRef.current = agentSessions

  // ===== MRU 维护 =====

  // 活跃标签变化时更新 MRU（切换器打开期间 activeTab 不会变）
  useEffect(() => {
    if (!activeTabId) return
    setMruOrder((prev) => {
      if (prev[0] === activeTabId) return prev
      const filtered = prev.filter((id) => id !== activeTabId)
      return [activeTabId, ...filtered]
    })
  }, [activeTabId, setMruOrder])

  // 标签列表变化时清理 MRU（移除已关闭的，追加新增的）
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id))
    setMruOrder((prev) => {
      const filtered = prev.filter((id) => tabIds.has(id))
      const prevSet = new Set(prev)
      const missing = tabs
        .filter((t) => !prevSet.has(t.id))
        .map((t) => t.id)
      if (filtered.length === prev.length && missing.length === 0) return prev
      return [...filtered, ...missing]
    })
  }, [tabs, setMruOrder])

  // ===== 激活标签（复用 TabBar 的同步逻辑） =====

  const activateTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId)

      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (!tab) return

      if (tab.type === 'chat') {
        setAppMode('chat')
        setCurrentConversationId(tab.sessionId)
      } else if (tab.type === 'agent') {
        setAppMode('agent')
        setCurrentAgentSessionId(tab.sessionId)

        // 清除"已完成未查看"标记
        setUnviewedCompleted((prev) => {
          if (!prev.has(tab.sessionId)) return prev
          const next = new Set(prev)
          next.delete(tab.sessionId)
          return next
        })

        const session = agentSessionsRef.current.find((s) => s.id === tab.sessionId)
        if (session?.workspaceId) {
          setCurrentAgentWorkspaceId(session.workspaceId)
          window.electronAPI
            .updateSettings({ agentWorkspaceId: session.workspaceId })
            .catch(console.error)
        }
      }
    },
    [
      setActiveTabId,
      setAppMode,
      setCurrentConversationId,
      setCurrentAgentSessionId,
      setCurrentAgentWorkspaceId,
      setUnviewedCompleted,
    ],
  )

  // ===== 键盘事件处理 =====

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ctrl+Tab 或 Ctrl+Shift+Tab（macOS 上 Ctrl 是物理 Control 键）
      if (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()

        const mru = mruOrderRef.current
        if (mru.length < 2) return

        if (!isOpenRef.current) {
          // 打开切换器，选中 MRU 第 2 项（上一个标签）
          setIsOpen(true)
          isOpenRef.current = true
          const idx = e.shiftKey ? mru.length - 1 : 1
          setSelectedIndex(idx)
          selectedIndexRef.current = idx
        } else {
          // 循环选择
          const len = mru.length
          const newIdx = e.shiftKey
            ? (selectedIndexRef.current - 1 + len) % len
            : (selectedIndexRef.current + 1) % len
          setSelectedIndex(newIdx)
          selectedIndexRef.current = newIdx
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control' && isOpenRef.current) {
        // 确认选择
        const selectedTabId = mruOrderRef.current[selectedIndexRef.current]
        if (selectedTabId) {
          activateTab(selectedTabId)
        }
        setIsOpen(false)
        isOpenRef.current = false
      }
    }

    // 窗口失焦时确认当前选择（与松开 Ctrl 行为一致）
    const handleBlur = (): void => {
      if (!isOpenRef.current) return
      const selectedTabId = mruOrderRef.current[selectedIndexRef.current]
      if (selectedTabId) activateTab(selectedTabId)
      setIsOpen(false)
      isOpenRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [activateTab])

  // ===== 渲染 =====

  if (!isOpen || mruOrder.length < 2) return null

  // 按 MRU 顺序构建显示列表
  const displayTabs = mruOrder
    .map((id) => tabs.find((t) => t.id === id))
    .filter(Boolean) as TabItem[]

  // 防止标签在切换器打开期间被关闭导致越界
  const safeIndex = Math.min(selectedIndex, displayTabs.length - 1)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/20" />

      {/* 切换器面板 */}
      <div className="relative bg-popover/95 backdrop-blur-md border border-border/50 rounded-xl shadow-2xl min-w-[380px] max-w-[480px] overflow-hidden">
        {/* Header：明确告知这是标签切换器并标注快捷键 */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-border/40 bg-muted/30">
          <span className="text-[13px] font-medium text-foreground">切换标签</span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>Tab</Kbd>
            <span className="opacity-60 ml-1">循环</span>
          </div>
        </div>

        {/* 标签列表 */}
        <div className="py-1.5">
          {displayTabs.map((tab, index) => {
            const status = indicatorMap.get(tab.id) ?? 'idle'
            const indicatorColor = getIndicatorColor(status, tab.type)
            const indicatorPulse = status === 'running' || status === 'blocked'
            const wsName = tab.type === 'agent'
              ? (() => {
                  const session = agentSessions.find((s) => s.id === tab.sessionId)
                  if (!session?.workspaceId) return undefined
                  return agentWorkspaces.find((w) => w.id === session.workspaceId)?.name
                })()
              : undefined
            return (
              <div
                key={tab.id}
                className={cn(
                  'relative flex items-center gap-3 pl-5 pr-5 py-2.5 text-[15px] cursor-default transition-colors',
                  index === safeIndex
                    ? 'bg-primary/15 text-foreground font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {/* 左侧状态竖线条 */}
                {indicatorColor && (
                  <span
                    className={cn(
                      'absolute left-1.5 top-2 bottom-2 w-[2px] rounded-full',
                      indicatorColor,
                      indicatorPulse && 'animate-pulse',
                    )}
                    aria-hidden="true"
                  />
                )}
                {tab.type === 'agent' ? (
                  <Bot className="w-4 h-4 shrink-0 opacity-60" />
                ) : (
                  <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                )}
                <span className="flex-1 truncate">{tab.title || '新对话'}</span>
                {wsName && (
                  <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[11px] leading-4 text-foreground/40 font-medium truncate max-w-[100px]">
                    {wsName}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer：操作提示 */}
        <div className="flex items-center justify-between gap-2 px-5 py-2 border-t border-border/40 bg-muted/30 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Kbd>Shift</Kbd>
            <span>+</span>
            <Kbd>Tab</Kbd>
            <span className="opacity-60 ml-1">反向</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-60">松开</span>
            <Kbd>Ctrl</Kbd>
            <span className="opacity-60">确认</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded border border-border/60 bg-background/80 text-[10px] font-medium text-foreground/80 shadow-sm">
      {children}
    </kbd>
  )
}

/**
 * 状态指示点颜色（与 TabBarItem 保持一致）
 * - completed → 绿色（已完成未查看）
 * - blocked → 橙色脉动（Agent 等待用户输入）
 * - running + chat → emerald 脉动
 * - running + agent → 蓝色脉动
 * - idle → 无
 */
function getIndicatorColor(
  status: SessionIndicatorStatus,
  type: TabItem['type'],
): string | undefined {
  if (status === 'idle') return undefined
  if (status === 'completed') return 'bg-green-500'
  if (status === 'blocked') return 'bg-orange-500'
  return type === 'chat' ? 'bg-emerald-500' : 'bg-blue-500'
}
