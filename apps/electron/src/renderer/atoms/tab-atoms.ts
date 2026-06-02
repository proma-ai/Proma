/**
 * Tab Atoms — 当前工作区入口状态管理
 *
 * 顶部只保留 Scratch Pad 与当前会话两个入口；会话恢复与导航交给左侧列表。
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
  unviewedCompletedSessionIdsAtom,
} from './agent-atoms'
import type { SessionIndicatorStatus } from './agent-atoms'
import type { PreviewFile } from './preview-atoms'

// ===== 类型定义 =====

/** 标签页类型（Settings 不作为 Tab，保留独立视图） */
export type TabType = 'chat' | 'agent' | 'scratch' | 'preview'

/** Scratch Pad 专用的固定 sessionId */
export const SCRATCH_PAD_ID = '__scratch-pad__'

/** 会话预览 Tab 的 ID 前缀：运行时临时入口，不参与持久化 */
const PREVIEW_TAB_PREFIX = '__preview__:'

/** Scratch Pad 标签默认标题 */
export const SCRATCH_PAD_TITLE = 'Scratch Pad'

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

/** 会话上次停留的视图：会话对话 vs 文件预览 */
export type SessionView = 'session' | 'preview'

/**
 * 每会话的视图状态（仅运行期内存态，不持久化到磁盘）。
 * 用于在切走再切回同一会话时，重建预览 Tab 并回到上次停留的视图。
 */
export interface SessionViewState {
  /** 该会话的预览 Tab 是否处于"打开"状态（用户主动关闭后置 false） */
  previewTabOpen: boolean
  /** 上次激活的是会话对话还是文件预览 */
  lastView: SessionView
}

/** 切回会话时重建预览 Tab 的提示（由调用方读取 atom 后传入纯函数 openTab） */
export interface OpenTabRestore {
  /** 该会话是否应重建预览 Tab（previewTabOpen && 存在预览文件时为 true） */
  previewTabOpen: boolean
  /** 预览 Tab 标题（重建时使用） */
  previewTitle: string
  /** 上次停留的视图，决定重建后激活预览 Tab 还是会话 Tab */
  lastView: SessionView
}

// ===== 核心 Atoms =====

/** 顶部入口列表：Scratch Pad + 当前会话 */
export const tabsAtom = atom<TabItem[]>([])

/** 当前激活的标签 ID */
export const activeTabIdAtom = atom<string | null>(null)

/** 标签页 MRU（最近使用）顺序，最近使用的 ID 排在前面 */
export const tabMruAtom = atom<string[]>([])

/**
 * 每会话视图状态 Map（仅运行期内存态，不持久化）。
 * key = sessionId，value = { previewTabOpen, lastView }。
 * 切走会话时预览 Tab 被 openTab 丢弃，切回时据此重建并回到上次视图。
 */
export const sessionViewStateMapAtom = atom<Map<string, SessionViewState>>(new Map())

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

/** Scratch Pad 编辑内容（HTML 字符串，供 TipTap 编辑器使用） */
export const scratchPadContentAtom = atom<string>('')
/** Scratch Pad 内容是否已从磁盘加载 */
export const scratchPadLoadedAtom = atom<boolean>(false)

// ===== 派生 Atoms =====

/** 当前活跃标签 */
export const activeTabAtom = atom<TabItem | null>((get) => {
  const activeId = get(activeTabIdAtom)
  if (!activeId) return null
  return get(tabsAtom).find((t) => t.id === activeId) ?? null
})

/**
 * 当前活跃标签所属的会话 ID。
 * 预览 Tab 归一化为其 owner 会话的 sessionId，使"会话高亮"与"Ctrl+Tab 定位"
 * 都把预览 Tab 视为所属会话的一部分（preview tab 的 id 自身不参与这些判定）。
 */
export const activeSessionIdAtom = atom<string | null>((get) => {
  const activeTab = get(activeTabAtom)
  return activeTab?.sessionId ?? null
})

/** 标签是否在流式输出中（派生，从现有流式 atoms 计算） */
export const tabStreamingMapAtom = atom<Map<string, boolean>>((get) => {
  const tabs = get(tabsAtom)
  const chatStreaming = get(streamingConversationIdsAtom)
  const agentRunning = get(agentRunningSessionIdsAtom)
  const map = new Map<string, boolean>()
  for (const tab of tabs) {
    if (tab.type === 'scratch') continue
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
  const unviewedCompletedIds = get(unviewedCompletedSessionIdsAtom)
  const map = new Map<string, SessionIndicatorStatus>()
  for (const tab of tabs) {
    if (tab.type === 'scratch') continue
    if (tab.type === 'chat') {
      map.set(tab.id, chatStreaming.has(tab.sessionId) ? 'running' : 'idle')
    } else if (tab.type === 'agent') {
      const status = agentIndicator.get(tab.sessionId)
        ?? (unviewedCompletedIds.has(tab.sessionId) ? 'completed' : 'idle')
      map.set(tab.id, status)
    }
  }
  return map
})

// ===== 操作函数 =====

function createScratchPadTab(): TabItem {
  return {
    id: SCRATCH_PAD_ID,
    type: 'scratch',
    sessionId: SCRATCH_PAD_ID,
    title: SCRATCH_PAD_TITLE,
  }
}

export function createPreviewTabId(sessionId: string): string {
  return `${PREVIEW_TAB_PREFIX}${sessionId}`
}

export function getFileBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath
}

export function getPreviewTabTitle(filePath: string): string {
  return `预览：${getFileBaseName(filePath)}`
}

export function isPreviewTab(tab: TabItem): boolean {
  return tab.type === 'preview' || tab.id.startsWith(PREVIEW_TAB_PREFIX)
}

function isSessionTab(tab: TabItem): boolean {
  return tab.type === 'chat' || tab.type === 'agent'
}

function getPersistentTabs(tabs: TabItem[]): TabItem[] {
  return tabs.filter((tab) => tab.id !== SCRATCH_PAD_ID && !isPreviewTab(tab))
}

export function getPersistableTabState(
  tabs: TabItem[],
  activeTabId: string | null,
): PersistedTabState {
  const persistentTabs = getPersistentTabs(tabs)
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : null
  const persistentActiveTabId = activeTab && isPreviewTab(activeTab)
    ? persistentTabs.find((tab) => tab.sessionId === activeTab.sessionId && tab.type === 'agent')?.id
      ?? persistentTabs.at(-1)?.id
      ?? null
    : activeTabId

  return {
    tabs: persistentTabs,
    activeTabId: persistentActiveTabId,
  }
}

/** 打开或聚焦会话入口：始终用目标会话替换当前会话，避免顶部累积多个 Tab。
 *  restore 提示存在时，切回带预览的会话会一并重建其预览 Tab 并回到上次视图。 */
export function openTab(
  tabs: TabItem[],
  item: { type: TabType; sessionId: string; title: string },
  restore?: OpenTabRestore,
): { tabs: TabItem[]; activeTabId: string } {
  const scratchTab = tabs.find((t) => t.id === SCRATCH_PAD_ID) ?? createScratchPadTab()

  if (item.type === 'scratch') {
    return {
      tabs: [scratchTab],
      activeTabId: SCRATCH_PAD_ID,
    }
  }

  if (item.type === 'preview') {
    const ownerAgentTab = tabs.find((t) => t.type === 'agent' && t.sessionId === item.sessionId) ?? {
      id: item.sessionId,
      type: 'agent' as const,
      sessionId: item.sessionId,
      title: 'Agent 会话',
    }
    const previewTab: TabItem = {
      id: createPreviewTabId(item.sessionId),
      type: 'preview',
      sessionId: item.sessionId,
      title: item.title,
    }

    return {
      tabs: [scratchTab, ownerAgentTab, previewTab],
      activeTabId: previewTab.id,
    }
  }

  const existingTab = tabs.find((t) => t.sessionId === item.sessionId && t.type === item.type)
  const sessionTab: TabItem = existingTab ?? {
    id: item.sessionId,
    type: item.type,
    sessionId: item.sessionId,
    title: item.title,
  }

  // 切回带预览的会话：重建该会话的预览 Tab，并按 lastView 决定激活哪个。
  if (restore?.previewTabOpen) {
    const previewTab: TabItem = {
      id: createPreviewTabId(item.sessionId),
      type: 'preview',
      sessionId: item.sessionId,
      title: restore.previewTitle,
    }
    return {
      tabs: [scratchTab, sessionTab, previewTab],
      activeTabId: restore.lastView === 'preview' ? previewTab.id : sessionTab.id,
    }
  }

  return {
    tabs: [scratchTab, sessionTab],
    activeTabId: sessionTab.id,
  }
}

/**
 * 从视图状态与预览文件 Map 构造 openTab 的 restore 提示。
 * 仅当该会话预览 Tab 处于打开状态且确实有预览文件时才返回提示，否则返回 undefined。
 * 供 useOpenSession / TabSwitcher 等切换入口在调用 openTab 前读取 atom 后传入。
 */
export function buildOpenTabRestore(
  sessionId: string,
  viewStateMap: Map<string, SessionViewState>,
  previewFileMap: Map<string, PreviewFile | null>,
): OpenTabRestore | undefined {
  const viewState = viewStateMap.get(sessionId)
  const previewFile = previewFileMap.get(sessionId)
  if (!viewState?.previewTabOpen || !previewFile) return undefined
  return {
    previewTabOpen: true,
    previewTitle: getPreviewTabTitle(previewFile.filePath),
    lastView: viewState.lastView,
  }
}

/** 关闭标签页（scratch tab 不可关闭） */
export function closeTab(
  tabs: TabItem[],
  activeTabId: string | null,
  tabId: string,
): { tabs: TabItem[]; activeTabId: string | null } {
  // Scratch Pad 不可关闭
  if (tabId === SCRATCH_PAD_ID) return { tabs, activeTabId }

  const tabIndex = tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) return { tabs, activeTabId }
  const closingTab = tabs[tabIndex]!
  const boundPreviewId = isSessionTab(closingTab) ? createPreviewTabId(closingTab.sessionId) : null

  const newTabs = tabs.filter((t) => t.id !== tabId && (!boundPreviewId || t.id !== boundPreviewId))

  // 如果关闭的是当前激活的标签，切换到相邻标签
  let newActiveTabId = activeTabId
  if (activeTabId === tabId || (boundPreviewId !== null && activeTabId === boundPreviewId)) {
    if (newTabs.length > 0) {
      const nextIndex = Math.min(tabIndex, newTabs.length - 1)
      newActiveTabId = newTabs[nextIndex]!.id
    } else {
      newActiveTabId = null
    }
  }

  return { tabs: newTabs, activeTabId: newActiveTabId }
}

/** 重排标签顺序（当前只保留 Scratch + 当前会话，保留函数用于兼容旧调用） */
export function reorderTabs(
  tabs: TabItem[],
  fromIndex: number,
  toIndex: number,
): TabItem[] {
  if (fromIndex === toIndex) return tabs
  // Scratch 不可移出第 0 位
  if (tabs[0]?.id === SCRATCH_PAD_ID && (fromIndex === 0 || toIndex === 0)) return tabs
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
    t.sessionId === sessionId && !isPreviewTab(t) ? { ...t, title } : t
  )
}

/** 确保 Scratch Pad 标签存在并位于首位，同时只保留一个会话入口 */
export function ensureScratchPadTab(tabs: TabItem[]): TabItem[] {
  const scratchTab = tabs.find((t) => t.id === SCRATCH_PAD_ID)
  const sessionTab = tabs.filter((t) => t.id !== SCRATCH_PAD_ID && !isPreviewTab(t)).at(-1)
  if (scratchTab) {
    return sessionTab ? [scratchTab, sessionTab] : [scratchTab]
  }
  const newTab = createScratchPadTab()
  return sessionTab ? [newTab, sessionTab] : [newTab]
}
