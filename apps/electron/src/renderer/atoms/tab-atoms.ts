/**
 * Tab Atoms — 标签页和分屏布局状态管理
 *
 * 支持浏览器风格的多标签页 + 最多 4 面板分屏。
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
} from './agent-atoms'

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

/** 分屏布局模式 */
export type SplitMode = 'single' | 'horizontal-2' | 'vertical-2' | 'grid-4'

/** 分屏面板 */
export interface SplitPanel {
  /** 面板位置索引（0-3） */
  index: number
  /** 该面板激活的标签 ID（null = 空面板） */
  activeTabId: string | null
}

/** 分屏布局状态 */
export interface SplitLayoutState {
  /** 布局模式 */
  mode: SplitMode
  /** 面板列表（1-4 个面板） */
  panels: SplitPanel[]
  /** 当前焦点面板索引 */
  focusedPanelIndex: number
}

/** Tab 持久化数据（保存到 settings.json） */
export interface PersistedTabState {
  tabs: TabItem[]
  splitLayout: SplitLayoutState
}

// ===== 默认值 =====

const DEFAULT_SPLIT_LAYOUT: SplitLayoutState = {
  mode: 'single',
  panels: [{ index: 0, activeTabId: null }],
  focusedPanelIndex: 0,
}

// ===== 核心 Atoms =====

/** 所有打开的标签页列表（有序，控制 TabBar 显示顺序） */
export const tabsAtom = atom<TabItem[]>([])

/** 分屏布局状态 */
export const splitLayoutAtom = atom<SplitLayoutState>(DEFAULT_SPLIT_LAYOUT)

/** 侧边栏是否收起（持久化） */
export const sidebarCollapsedAtom = atomWithStorage<boolean>(
  'proma-sidebar-collapsed',
  false,
)

// ===== 派生 Atoms =====

/** 当前焦点面板的活跃标签 ID */
export const activeTabIdAtom = atom<string | null>((get) => {
  const layout = get(splitLayoutAtom)
  const focusedPanel = layout.panels[layout.focusedPanelIndex]
  return focusedPanel?.activeTabId ?? null
})

/** 当前焦点面板的活跃标签 */
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

// ===== 操作函数 =====

/** 打开或聚焦标签页（如果已存在则聚焦，否则创建新标签） */
export function openTab(
  tabs: TabItem[],
  layout: SplitLayoutState,
  item: { type: TabType; sessionId: string; title: string },
): { tabs: TabItem[]; layout: SplitLayoutState } {
  const existingTab = tabs.find((t) => t.sessionId === item.sessionId && t.type === item.type)

  if (existingTab) {
    // 已存在 → 聚焦到该标签
    const newLayout = focusTab(layout, existingTab.id)
    return { tabs, layout: newLayout }
  }

  // 创建新标签
  const newTab: TabItem = {
    id: item.sessionId,
    type: item.type,
    sessionId: item.sessionId,
    title: item.title,
  }

  const newTabs = [...tabs, newTab]

  // 在焦点面板中激活新标签
  const newPanels = layout.panels.map((panel, idx) =>
    idx === layout.focusedPanelIndex
      ? { ...panel, activeTabId: newTab.id }
      : panel
  )

  return {
    tabs: newTabs,
    layout: { ...layout, panels: newPanels },
  }
}

/** 关闭标签页 */
export function closeTab(
  tabs: TabItem[],
  layout: SplitLayoutState,
  tabId: string,
): { tabs: TabItem[]; layout: SplitLayoutState } {
  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return { tabs, layout }

  const newTabs = tabs.filter((t) => t.id !== tabId)

  // 更新所有面板：如果面板的活跃标签被关闭，切换到相邻标签
  const newPanels = layout.panels.map((panel) => {
    if (panel.activeTabId !== tabId) return panel

    // 找到相邻标签（优先右侧，其次左侧）
    let nextTabId: string | null = null
    if (newTabs.length > 0) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1)
      nextTabId = newTabs[nextIndex]!.id
    }

    return { ...panel, activeTabId: nextTabId }
  })

  return {
    tabs: newTabs,
    layout: { ...layout, panels: newPanels },
  }
}

/** 聚焦到指定标签（在焦点面板中激活） */
export function focusTab(
  layout: SplitLayoutState,
  tabId: string,
): SplitLayoutState {
  // 先检查是否已在某个面板中激活
  const panelIndex = layout.panels.findIndex((p) => p.activeTabId === tabId)
  if (panelIndex >= 0) {
    // 已在面板中 → 切换焦点到该面板
    return { ...layout, focusedPanelIndex: panelIndex }
  }

  // 不在任何面板 → 在焦点面板中激活
  const newPanels = layout.panels.map((panel, idx) =>
    idx === layout.focusedPanelIndex
      ? { ...panel, activeTabId: tabId }
      : panel
  )
  return { ...layout, panels: newPanels }
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

/** 设置分屏模式 */
export function setSplitMode(
  layout: SplitLayoutState,
  mode: SplitMode,
): SplitLayoutState {
  const panelCount = mode === 'single' ? 1
    : mode === 'horizontal-2' || mode === 'vertical-2' ? 2
    : 4

  // 保留现有面板，补充不足的
  const panels: SplitPanel[] = []
  for (let i = 0; i < panelCount; i++) {
    panels.push(
      layout.panels[i] ?? { index: i, activeTabId: null }
    )
  }

  return {
    mode,
    panels: panels.map((p, i) => ({ ...p, index: i })),
    focusedPanelIndex: Math.min(layout.focusedPanelIndex, panelCount - 1),
  }
}
