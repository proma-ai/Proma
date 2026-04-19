/**
 * Tab Atoms — 标签页状态管理
 *
 * 支持浏览器风格的多标签页。
 * 通过桥接 atom 与现有 currentConversationIdAtom / currentAgentSessionIdAtom 同步，
 * 确保所有现有派生 atoms 无需修改。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  streamingConversationIdsAtom,
} from './chat-atoms'
import {
  agentRunningSessionIdsAtom,
  agentSessionIndicatorMapAtom,
  workingDoneSessionIdsAtom,
} from './agent-atoms'
import type { SessionIndicatorStatus } from './agent-atoms'

// ===== 类型定义 =====

/** 标签页类型（Settings 不作为 Tab，保留独立视图） */
export type TabType = 'chat' | 'agent'

/** 标签页数据 */
export interface TabItem {
  /** 唯一标签 ID（直接使用 sessionId） */
  id: string
  /** 标签页类型 */
  type: TabType
  /** Chat conversationId 或 Agent sessionId */
  sessionId: string
  /** 标签页显示标题 */
  title: string
}

/** Tab 持久化数据（保存到 settings.json） */
export interface PersistedTabState {
  tabs: TabItem[]
  activeTabId: string | null
}

// ===== 核心 Atoms =====

/** 所有打开的标签页列表（有序，控制 TabBar 显示顺序） */
export const tabsAtom = atom<TabItem[]>([])

/** 当前激活的标签 ID */
export const activeTabIdAtom = atom<string | null>(null)

/** 标签页 MRU（最近使用）顺序，最近使用的 ID 排在前面 */
export const tabMruAtom = atom<string[]>([])

/** 侧边栏是否收起（持久化） */
export const sidebarCollapsedAtom = atomWithStorage<boolean>(
  'proma-sidebar-collapsed',
  false,
)

/** Tab 迷你地图缓存（每个 Tab 的消息预览列表，在消息组件中填充） */
export interface TabMinimapItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  avatar?: string
  model?: string
}
export const tabMinimapCacheAtom = atom<Map<string, TabMinimapItem[]>>(new Map())

// ===== 派生 Atoms =====

/** 当前活跃标签 */
export const activeTabAtom = atom<TabItem | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  return get(tabsAtom).find((t) => t.id === activeId) ?? null
})

/** 标签是否在流式输出中（派生，从现有流式 atoms 计算） */
export const tabStreamingMapAtom = atom<Map<string, boolean>>((get) => {
  const tabs = get(tabsAtom)
  const chatStreaming = get(streamingConversationIdsAtom)
  const agentRunning = get(agentRunningSessionIdsAtom)
  const map = new Map<string, boolean>()
  for (const tab of tabs) {
    if (tab.type === 'chat') {
      map.set(tab.id, chatStreaming.has(tab.sessionId))
    } else if (tab.type === 'agent') {
      map.set(tab.id, agentRunning.has(tab.sessionId))
    }
  }
  return map
})

/** 标签页指示点状态（chat 用 running/idle，agent 用完整 SessionIndicatorStatus） */
export const tabIndicatorMapAtom = atom<Map<string, SessionIndicatorStatus>>((get) => {
  const tabs = get(tabsAtom)
  const chatStreaming = get(streamingConversationIdsAtom)
  const agentIndicator = get(agentSessionIndicatorMapAtom)
  const workingDoneIds = get(workingDoneSessionIdsAtom)
  const map = new Map<string, SessionIndicatorStatus>()
  for (const tab of tabs) {
    if (tab.type === 'chat') {
      map.set(tab.id, chatStreaming.has(tab.sessionId) ? 'running' : 'idle')
    } else if (tab.type === 'agent') {
      const status = agentIndicator.get(tab.sessionId)
        ?? (workingDoneIds.has(tab.sessionId) ? 'completed' : 'idle')
      map.set(tab.id, status)
    }
  }
  return map
})

// ===== 操作函数 =====

/** 打开或聚焦标签页（如果已存在则聚焦，否则创建新标签） */
export function openTab(
  tabs: TabItem[],
  item: { type: TabType; sessionId: string; title: string },
): { tabs: TabItem[]; activeTabId: string } {
  const existingTab = tabs.find((t) => t.sessionId === item.sessionId && t.type === item.type)

  if (existingTab) {
    return { tabs, activeTabId: existingTab.id }
  }

  // 创建新标签
  const newTab: TabItem = {
    id: item.sessionId,
    type: item.type,
    sessionId: item.sessionId,
    title: item.title,
  }

  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
  }
}

/** 关闭标签页 */
export function closeTab(
  tabs: TabItem[],
  activeTabId: string | null,
  tabId: string,
): { tabs: TabItem[]; activeTabId: string | null } {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return { tabs, activeTabId }

  const newTabs = tabs.filter((t) => t.id !== tabId)

  // 如果关闭的是当前激活的标签，切换到相邻标签
  let newActiveTabId = activeTabId
  if (activeTabId === tabId) {
    if (newTabs.length > 0) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1)
      newActiveTabId = newTabs[nextIndex]!.id
    } else {
      newActiveTabId = null
    }
  }

  return { tabs: newTabs, activeTabId: newActiveTabId }
}

/** 重排标签顺序 */
export function reorderTabs(
  tabs: TabItem[],
  fromIndex: number,
  toIndex: number,
): TabItem[] {
  if (fromIndex === toIndex) return tabs
  const newTabs = [...tabs]
  const [moved] = newTabs.splice(fromIndex, 1)
  newTabs.splice(toIndex, 0, moved!)
  return newTabs
}

/** 更新标签标题 */
export function updateTabTitle(
  tabs: TabItem[],
  sessionId: string,
  title: string,
): TabItem[] {
  return tabs.map((t) =>
    t.sessionId === sessionId ? { ...t, title } : t
  )
}
