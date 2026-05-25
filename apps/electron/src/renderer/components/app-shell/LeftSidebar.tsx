/**
 * LeftSidebar - 左侧导航栏
 *
 * 包含：
 * - Chat/Agent 模式切换器
 * - 导航菜单项（点击切换主内容区视图）
 * - 置顶对话区域（可展开/收起）
 * - 对话列表（新对话按钮 + 右键菜单 + 按 updatedAt 降序排列）
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Pin, PinOff, Settings, Plus, Trash2, Pencil, ChevronDown, ChevronRight, Plug, Zap, PanelLeftClose, PanelLeftOpen, ArrowRightLeft, Search, Archive, ArchiveRestore, ArrowLeft, Hammer, Bot, MessageSquare, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ModeSwitcher } from './ModeSwitcher'
import { SearchDialog } from './SearchDialog'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import {
  conversationsAtom,
  currentConversationIdAtom,
  selectedModelAtom,
  streamingConversationIdsAtom,
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentSessionIndicatorMapAtom,
  unviewedCompletedSessionIdsAtom,
  workingDoneSessionIdsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
  agentDiffPanelTabAtom,
  agentDiffRefreshVersionAtom,
  agentDiffUnseenChangesAtom,
  agentDiffUnseenFilesAtom,
  agentDiffDataAtom,
} from '@/atoms/agent-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { previewPanelOpenMapAtom, previewFileMapAtom } from '@/atoms/preview-atoms'
import { clearPreviewCacheForSession } from '@/components/diff/DiffTabContent'
import {
  tabsAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  closeTab,
  updateTabTitle,
} from '@/atoms/tab-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { sidebarViewModeAtom, agentSidebarTopHeightAtom } from '@/atoms/sidebar-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { hasUpdateAtom } from '@/atoms/updater'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { workingSessionGroupsAtom, workingSessionIdsSetAtom } from '@/atoms/working-atoms'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { promptConfigAtom, selectedPromptIdAtom, conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { WorkspaceSelector } from '@/components/agent/WorkspaceSelector'
import { CollapsedWorkspacePopover } from '@/components/agent/CollapsedWorkspacePopover'
import { MoveSessionDialog } from '@/components/agent/MoveSessionDialog'
import { detectIsMac } from '@/lib/platform'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { ActiveView } from '@/atoms/active-view'
import type { ConversationMeta, AgentSessionMeta, WorkspaceCapabilities } from '@proma/shared'
import { CloudSidebarDownloadButton, CloudSidebarCreditIndicator } from './CloudSidebarExtension'

interface SidebarItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  /** 右侧额外元素（如展开/收起箭头） */
  suffix?: React.ReactNode
  onClick?: () => void
}

function SidebarItem({ icon, label, active, suffix, onClick }: SidebarItemProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] transition-colors duration-100 titlebar-no-drag',
        active
          ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/60 hover:bg-primary/5 hover:text-foreground'
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>
        <span>{label}</span>
      </div>
      {suffix}
    </button>
  )
}

export interface LeftSidebarProps {
  /** 可选固定宽度，默认使用 CSS 响应式宽度 */
  width?: number
}

/** 侧边栏导航项标识 */
type SidebarItemId = 'pinned' | 'all-chats'

/** 导航项到视图的映射 */
const ITEM_TO_VIEW: Record<SidebarItemId, ActiveView> = {
  pinned: 'conversations',
  'all-chats': 'conversations',
}

/** 日期分组标签 */
type DateGroup = '今天' | '昨天' | '更早'

/** 按 updatedAt 将项目分为 今天 / 昨天 / 更早 三组 */
function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    if (item.updatedAt >= todayStart) {
      today.push(item)
    } else if (item.updatedAt >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

const RAIL_STATUS_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'hidden',
  running: 'bg-blue-500 animate-pulse',
  blocked: 'bg-orange-500',
  completed: 'bg-emerald-500',
}

const SIDEBAR_DRAG_STRIP_HEIGHT = {
  collapsedMac: 50,
  expandedMac: 30,
  collapsed: 8,
  expanded: 4,
} as const

const AGENT_TOP_MIN_HEIGHT = 80
const AGENT_TOP_MAX_RATIO = 0.7

function computeAgentTopMaxHeight(containerHeight: number): number {
  return Math.max(AGENT_TOP_MIN_HEIGHT, Math.floor(containerHeight * AGENT_TOP_MAX_RATIO))
}

function getRailInitial(title: string): string {
  return title.trim().slice(0, 1).toUpperCase() || '·'
}

function SidebarWindowDragStrip({ height }: { height: number }): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="sidebar-window-drag-strip"
      style={{ height }}
    />
  )
}

export function LeftSidebar({ width }: LeftSidebarProps): React.ReactElement {
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [activeItem, setActiveItem] = React.useState<SidebarItemId>('all-chats')
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [currentConversationId, setCurrentConversationId] = useAtom(currentConversationIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  /** 待删除对话 ID，非空时显示确认弹窗 */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  /** 待迁移会话 ID，非空时显示迁移对话框 */
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)
  /** 置顶区域展开/收起 */
  const [pinnedExpanded, setPinnedExpanded] = React.useState(true)
  /** Agent 上区子 Tab：'working' | 'pinned'，默认 working 在前 */
  const [agentSubTab, setAgentSubTab] = React.useState<'working' | 'pinned'>('working')
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)
  const mode = useAtomValue(appModeAtom)
  const isMac = React.useMemo(() => detectIsMac(), [])
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)

  // Agent 模式状态
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useAtom(currentAgentSessionIdAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const unviewedCompletedSessionIds = useAtomValue(unviewedCompletedSessionIdsAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const setMode = useSetAtom(appModeAtom)

  // 工作区能力（MCP + Skill 计数）
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  // Tab 状态
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const openSession = useOpenSession()
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  // 归档 & 搜索状态
  const [viewMode, setViewMode] = useAtom(sidebarViewModeAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)

  // Agent 模式上区（Working/置顶）可拖拽高度
  /** -1 表示未初始化，首次渲染时按容器 40% 计算 */
  const [agentTopHeight, setAgentTopHeight] = useAtom(agentSidebarTopHeightAtom)
  const agentSplitContainerRef = React.useRef<HTMLDivElement>(null)
  const agentTopResizing = React.useRef(false)
  const agentTopResizeCleanup = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    return () => { agentTopResizeCleanup.current?.() }
  }, [])

  React.useEffect(() => {
    if (agentTopHeight > 0) return
    const el = agentSplitContainerRef.current
    if (!el) return
    const h = el.getBoundingClientRect().height
    if (h > 0) {
      setAgentTopHeight(Math.round(h * 0.4))
    }
  }, [agentTopHeight, setAgentTopHeight, mode, viewMode])

  // 容器尺寸变化时（窗口缩放、Sidebar 宽度变化等），把上区高度 clamp 到允许范围内，
  // 避免持久化的高度值在小屏幕下溢出导致分割线与"最近会话"等下方区域重合。
  React.useEffect(() => {
    const el = agentSplitContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      if (agentTopResizing.current) return
      const entry = entries[0]
      if (!entry) return
      const containerHeight = entry.contentRect.height
      if (containerHeight <= 0) return
      const maxH = computeAgentTopMaxHeight(containerHeight)
      setAgentTopHeight((prev) => {
        if (prev <= 0) return prev
        if (prev <= maxH) return prev
        return maxH
      })
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [setAgentTopHeight, mode, viewMode])

  const handleAgentTopResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = agentSplitContainerRef.current
      if (!container) return
      agentTopResizing.current = true
      const startY = e.clientY
      const startH = Math.max(0, agentTopHeight)
      const containerHeight = container.getBoundingClientRect().height
      const minH = AGENT_TOP_MIN_HEIGHT
      const maxH = computeAgentTopMaxHeight(containerHeight)

      const onMove = (ev: MouseEvent): void => {
        if (!agentTopResizing.current) return
        const delta = ev.clientY - startY
        const next = Math.min(maxH, Math.max(minH, startH + delta))
        setAgentTopHeight(next)
      }
      const onUp = (): void => {
        agentTopResizing.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        agentTopResizeCleanup.current = null
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      agentTopResizeCleanup.current = onUp
    },
    [agentTopHeight, setAgentTopHeight],
  )

  // 当 activeTabId 变化时，自动滚动侧边栏使选中项可见
  React.useEffect(() => {
    if (!activeTabId) return
    requestAnimationFrame(() => {
      const el = document.querySelector('.session-item-selected')
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [activeTabId])

  // per-conversation/session Map atoms（删除时清理）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setPreviewPanelOpen = useSetAtom(previewPanelOpenMapAtom)
  const setPreviewFile = useSetAtom(previewFileMapAtom)
  const setDiffPanelTab = useSetAtom(agentDiffPanelTabAtom)
  const setDiffRefreshVersion = useSetAtom(agentDiffRefreshVersionAtom)
  const setDiffUnseen = useSetAtom(agentDiffUnseenChangesAtom)
  const setDiffUnseenFiles = useSetAtom(agentDiffUnseenFilesAtom)
  const setDiffData = useSetAtom(agentDiffDataAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)

  /** 清理 per-conversation/session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((id: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(id)) return prev
      const map = new Map(prev)
      map.delete(id)
      return map
    }
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    setPreviewPanelOpen(deleteKey)
    setPreviewFile(deleteKey)
    setDiffPanelTab(deleteKey)
    setDiffRefreshVersion(deleteKey)
    setDiffUnseen(deleteKey)
    setDiffUnseenFiles(deleteKey)
    setDiffData(deleteKey)
    setSessionChannelMap(deleteKey)
    setSessionModelMap(deleteKey)
    clearPreviewCacheForSession(id)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setPreviewPanelOpen, setPreviewFile, setDiffPanelTab, setDiffRefreshVersion, setDiffUnseen, setDiffUnseenFiles, setDiffData, setSessionChannelMap, setSessionModelMap])

  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workspaces) map.set(w.id, w.name)
    return map
  }, [workspaces])

  React.useEffect(() => {
    if (!currentWorkspaceSlug || mode !== 'agent') {
      setCapabilities(null)
      return
    }
    window.electronAPI
      .getWorkspaceCapabilities(currentWorkspaceSlug)
      .then(setCapabilities)
      .catch(console.error)
  }, [currentWorkspaceSlug, mode, activeView, capabilitiesVersion])

  /** 置顶对话列表（仅活跃模式显示，排除 draft） */
  const pinnedConversations = React.useMemo(
    () => viewMode === 'active' ? conversations.filter((c) => c.pinned && !draftSessionIds.has(c.id)) : [],
    [conversations, viewMode, draftSessionIds]
  )

  /** Working 区域状态 */
  const workingGroups = useAtomValue(workingSessionGroupsAtom)
  const workingSessionIds = useAtomValue(workingSessionIdsSetAtom)
  const hasWorkingSessions = workingGroups.todo.length > 0 || workingGroups.running.length > 0 || workingGroups.done.length > 0

  /** 置顶 Agent 会话列表（仅活跃模式显示，按当前工作区过滤，排除 draft 和 Working） */
  const pinnedAgentSessions = React.useMemo(
    () => viewMode === 'active' ? agentSessions.filter((s) => s.pinned && !draftSessionIds.has(s.id) && !workingSessionIds.has(s.id) && (!currentWorkspaceId || s.workspaceId === currentWorkspaceId)) : [],
    [agentSessions, viewMode, draftSessionIds, currentWorkspaceId, workingSessionIds]
  )

  /** 顶部 TabBar 切换 tab 时，自动同步上区子 Tab 到对应分类 */
  const prevActiveTabIdForSubTab = React.useRef<string | null>(activeTabId)
  React.useEffect(() => {
    if (activeTabId === prevActiveTabIdForSubTab.current) return
    prevActiveTabIdForSubTab.current = activeTabId
    if (mode !== 'agent' || viewMode !== 'active' || !activeTabId) return
    if (pinnedAgentSessions.some((s) => s.id === activeTabId)) {
      setAgentSubTab('pinned')
    } else if (workingSessionIds.has(activeTabId)) {
      setAgentSubTab('working')
    }
  }, [activeTabId, mode, viewMode, pinnedAgentSessions, workingSessionIds])

  /** 对话按日期分组（根据 viewMode 过滤归档状态，排除 draft） */
  const conversationGroups = React.useMemo(
    () => {
      const filtered = viewMode === 'archived'
        ? conversations.filter((c) => c.archived && !draftSessionIds.has(c.id))
        : conversations.filter((c) => !c.archived && !c.pinned && !draftSessionIds.has(c.id))
      return groupByDate(filtered)
    },
    [conversations, viewMode, draftSessionIds]
  )

  /** 已归档对话数量 */
  const archivedConversationCount = React.useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  )

  /** 已归档 Agent 会话数量（当前工作区） */
  const archivedAgentSessionCount = React.useMemo(
    () => agentSessions.filter((s) => s.archived && (!currentWorkspaceId || s.workspaceId === currentWorkspaceId)).length,
    [agentSessions, currentWorkspaceId]
  )

  // 初始加载对话列表 + 用户档案 + Agent 会话
  React.useEffect(() => {
    window.electronAPI
      .listConversations()
      .then((list) => {
        setConversations(list)
      })
      .catch(console.error)
    window.electronAPI
      .getUserProfile()
      .then(setUserProfile)
      .catch(console.error)
    window.electronAPI
      .listAgentSessions()
      .then(setAgentSessions)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setConversations, setUserProfile, setAgentSessions])

  // 窗口聚焦时重新同步列表，修复长时间后前后端不一致
  React.useEffect(() => {
    const handleFocus = (): void => {
      window.electronAPI.listConversations().then(setConversations).catch(console.error)
      window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [setConversations, setAgentSessions])

  /** 处理导航项点击 */
  const handleItemClick = (item: SidebarItemId): void => {
    if (item === 'pinned') {
      // 置顶按钮仅切换展开/收起，不改变 activeView
      setPinnedExpanded((prev) => !prev)
      return
    }
    setActiveItem(item)
    setActiveView(ITEM_TO_VIEW[item])
  }

  // 切换模式时重置归档视图
  React.useEffect(() => {
    setViewMode('active')
  }, [mode, setViewMode])

  /** 创建新对话（继承当前选中的模型/渠道） */
  const handleNewConversation = async (): Promise<void> => {
    try {
      const meta = await window.electronAPI.createConversation(
        undefined,
        selectedModel?.modelId,
        selectedModel?.channelId,
      )
      setConversations((prev) => [meta, ...prev])
      // 打开新标签页
      openSession('chat', meta.id, meta.title)
      // 确保在对话视图
      setActiveView('conversations')
      setActiveItem('all-chats')
      // 根据默认提示词重置选中
      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
    } catch (error) {
      console.error('[侧边栏] 创建对话失败:', error)
    }
  }

  /** 选择对话（打开或聚焦标签页） */
  const handleSelectConversation = React.useCallback((id: string, title: string): void => {
    openSession('chat', id, title)
    setActiveView('conversations')
    setActiveItem('all-chats')
  }, [openSession, setActiveView])

  /** 请求删除对话（弹出确认框） */
  const handleRequestDelete = React.useCallback((id: string): void => {
    setPendingDeleteId(id)
  }, [])

  /** 重命名对话标题 */
  const handleRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateConversationTitle(id, newTitle)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名对话失败:', error)
    }
  }

  /** 切换对话置顶状态 */
  const handleTogglePin = async (id: string): Promise<void> => {
    try {
      const original = conversations.find((c) => c.id === id)
      const updated = await window.electronAPI.togglePinConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 归档会话被置顶时会自动取消归档
      if (original?.archived && updated.pinned && !updated.archived) {
        toast.success('已取消归档并置顶')
      }
    } catch (error) {
      console.error('[侧边栏] 切换置顶失败:', error)
    }
  }

  /** 切换对话归档状态 */
  const handleToggleArchive = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 归档时自动关闭该对话的标签页，并同步新激活标签的副作用
      // （appMode、currentXxxId 等），避免文件面板/工具栏等 per-tab
      // 状态被遗留为旧值或被错误地置 null。
      if (updated.archived) {
        const wasActive = activeTabId === id
        const tabResult = closeTab(tabs, activeTabId, id)
        setTabs(tabResult.tabs)
        setActiveTabId(tabResult.activeTabId)
        cleanupMapAtoms(id)
        if (wasActive) {
          const newActiveTab = tabResult.activeTabId
            ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
            : null
          syncActiveTabSideEffects(newActiveTab)
        }
      }
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[侧边栏] 切换归档失败:', error)
    }
  }

  /** 确认删除对话 */
  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return

    // 关闭对应的标签页：setTabs 与 setActiveTabId 成组更新，便于阅读，
    // 也避免将来在两者之间意外插入 await 导致跨渲染状态不一致。
    // （React 18 在同一事件回调中会自动批处理多次 setState，所以单次渲染
    // 的一致性由 React 保证，这里只是保持代码组织清晰。）
    const wasActive = activeTabId === pendingDeleteId
    const tabResult = closeTab(tabs, activeTabId, pendingDeleteId)
    setTabs(tabResult.tabs)
    setActiveTabId(tabResult.activeTabId)

    // 若关闭的是当前活跃标签，同步新激活标签的副作用（appMode、
    // currentXxxId、以及右侧文件面板等 per-tab 状态），保持与 TabBar
    // 关闭逻辑一致，避免删除/归档当前会话后新标签状态缺失。
    if (wasActive) {
      const newActiveTab = tabResult.activeTabId
        ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }

    // 清理 draft 标记（如有）
    setDraftSessionIds((prev: Set<string>) => {
      if (!prev.has(pendingDeleteId)) return prev
      const next = new Set(prev)
      next.delete(pendingDeleteId)
      return next
    })

    // 清理 per-conversation/session Map atoms 条目
    cleanupMapAtoms(pendingDeleteId)

    // 从 Working Done 集合移除
    setWorkingDone((prev) => {
      if (!prev.has(pendingDeleteId)) return prev
      const next = new Set(prev)
      next.delete(pendingDeleteId)
      return next
    })

    if (mode === 'agent') {
      // Agent 模式：删除 Agent 会话
      // 注意：当前会话指针（currentAgentSessionId）已由上面的
      // syncActiveTabSideEffects 在 wasActive 分支同步到新激活标签，
      // 这里不要再按旧闭包值强制置 null，否则会覆盖新 sessionId，
      // 导致 RightSidePanel 消失（依赖 currentAgentSessionIdAtom）。
      try {
        await window.electronAPI.deleteAgentSession(pendingDeleteId)
        // 全量刷新确保与后端同步
        const sessions = await window.electronAPI.listAgentSessions()
        setAgentSessions(sessions)
      } catch (error) {
        console.error('[侧边栏] 删除 Agent 会话失败:', error)
        // 即使后端报错，也从本地列表移除（可能是会话已不存在）
        setAgentSessions((prev) => prev.filter((s) => s.id !== pendingDeleteId))
      } finally {
        setPendingDeleteId(null)
      }
      return
    }

    try {
      await window.electronAPI.deleteConversation(pendingDeleteId)
      // 全量刷新确保与后端同步
      const conversations = await window.electronAPI.listConversations()
      setConversations(conversations)
    } catch (error) {
      console.error('[侧边栏] 删除对话失败:', error)
      // 即使后端报错，也从本地列表移除（可能是对话已不存在）
      setConversations((prev) => prev.filter((c) => c.id !== pendingDeleteId))
    } finally {
      setPendingDeleteId(null)
    }
  }

  /** 创建新 Agent 会话 */
  const handleNewAgentSession = async (): Promise<void> => {
    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])
      // 从全局默认值初始化 per-session 渠道/模型配置
      if (agentChannelId) {
        setSessionChannelMap((prev) => {
          const map = new Map(prev)
          map.set(meta.id, agentChannelId)
          return map
        })
      }
      if (agentModelId) {
        setSessionModelMap((prev) => {
          const map = new Map(prev)
          map.set(meta.id, agentModelId)
          return map
        })
      }
      // 打开新标签页
      openSession('agent', meta.id, meta.title)
      setActiveView('conversations')
      setActiveItem('all-chats')
    } catch (error) {
      console.error('[侧边栏] 创建 Agent 会话失败:', error)
    }
  }

  /** 选择 Agent 会话（打开或聚焦标签页） */
  const handleSelectAgentSession = React.useCallback((id: string, title: string): void => {
    openSession('agent', id, title)
    setActiveView('conversations')
    setActiveItem('all-chats')
    // 清除该会话的"已完成未查看"标记
    setUnviewedCompleted((prev: Set<string>) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [openSession, setActiveView, setUnviewedCompleted])

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }

  /** 切换 Agent 会话置顶状态 */
  const handleTogglePinAgent = async (id: string): Promise<void> => {
    try {
      const original = agentSessions.find((s) => s.id === id)
      const updated = await window.electronAPI.togglePinAgentSession(id)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
      // 归档会话被置顶时会自动取消归档
      if (original?.archived && updated.pinned && !updated.archived) {
        toast.success('已取消归档并置顶')
      }
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话置顶失败:', error)
    }
  }

  /** 切换 Agent 会话手动工作中状态 */
  const handleToggleManualWorkingAgent = async (id: string): Promise<void> => {
    try {
      const isCurrentlyInWorking = workingSessionIds.has(id)
      if (isCurrentlyInWorking) {
        // 从工作中移出：清除 manualWorking + 清除 workingDone
        const session = agentSessions.find((s) => s.id === id)
        if (session?.manualWorking) {
          const updated = await window.electronAPI.toggleManualWorkingAgentSession(id)
          setAgentSessions((prev) =>
            prev.map((s) => (s.id === updated.id ? updated : s))
          )
        }
        setWorkingDone((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } else {
        // 加入工作中
        const original = agentSessions.find((s) => s.id === id)
        const updated = await window.electronAPI.toggleManualWorkingAgentSession(id)
        setAgentSessions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        )
        if (original?.archived && updated.manualWorking && !updated.archived) {
          toast.success('已取消归档并标记为工作中')
        }
      }
    } catch (error) {
      console.error('[Sidebar] Failed to toggle manual working:', error)
      toast.error('操作失败')
    }
  }

  /** 切换 Agent 会话归档状态 */
  const handleToggleArchiveAgent = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      )
      // 归档时自动关闭该会话的标签页，并同步新激活标签的副作用，
      // 否则 RightSidePanel（依赖 currentAgentSessionIdAtom）会因为
      // 指针被错误置 null 而消失。
      if (updated.archived) {
        const wasActive = activeTabId === id
        const tabResult = closeTab(tabs, activeTabId, id)
        setTabs(tabResult.tabs)
        setActiveTabId(tabResult.activeTabId)
        cleanupMapAtoms(id)
        // 从 Working Done 集合移除
        setWorkingDone((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        if (wasActive) {
          const newActiveTab = tabResult.activeTabId
            ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
            : null
          syncActiveTabSideEffects(newActiveTab)
        }
      }
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话归档失败:', error)
    }
  }

  /** 请求迁移会话到其他工作区（弹出迁移对话框） */
  const handleRequestMove = React.useCallback((id: string): void => {
    setMoveTargetId(id)
  }, [])

  /** 迁移会话到另一个工作区后的回调 */
  const handleSessionMoved = (updatedSession: AgentSessionMeta, targetWorkspaceName: string): void => {
    setAgentSessions((prev) =>
      prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
    )
    // 如果迁移的是当前选中的会话，取消选中并关闭标签页
    if (currentAgentSessionId === updatedSession.id) {
      const tabResult = closeTab(tabs, activeTabId, updatedSession.id)
      setTabs(tabResult.tabs)
      setActiveTabId(tabResult.activeTabId)
      setCurrentAgentSessionId(null)
      // 从 Working Done 集合移除
      setWorkingDone((prev) => {
        if (!prev.has(updatedSession.id)) return prev
        const next = new Set(prev)
        next.delete(updatedSession.id)
        return next
      })
    }
    setMoveTargetId(null)
    toast.success('会话已迁移', {
      description: `已迁移到「${targetWorkspaceName}」，请切换工作区查看`,
    })
  }

  /** Agent 会话按工作区过滤 + 归档过滤 + 排除 draft + 排除 Working */
  const filteredAgentSessions = React.useMemo(
    () => {
      const byWorkspace = agentSessions.filter((s) => s.workspaceId === currentWorkspaceId && !draftSessionIds.has(s.id))
      return viewMode === 'archived'
        ? byWorkspace.filter((s) => s.archived)
        : byWorkspace.filter((s) => !s.archived && !s.pinned && !workingSessionIds.has(s.id))
    },
    [agentSessions, currentWorkspaceId, viewMode, draftSessionIds, workingSessionIds]
  )

  /** Agent 会话按日期分组 */
  const agentSessionGroups = React.useMemo(
    () => groupByDate(filteredAgentSessions),
    [filteredAgentSessions]
  )

  const handleRailModeSwitch = React.useCallback((targetMode: AppMode) => {
    setViewMode('active')
    if (targetMode === mode) return

    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : agentSessions
    const lastId = isChatMode ? currentConversationId : currentAgentSessionId

    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode, match.id, match.title)
        return
      }
    }

    const tab = tabs.find((t) => t.type === targetMode)
    if (tab) {
      openSession(targetMode, tab.sessionId, tab.title)
      return
    }

    const recent = sessions.find((s) => !s.archived && !draftSessionIds.has(s.id))
    if (recent) {
      openSession(targetMode, recent.id, recent.title)
      return
    }

    setMode(targetMode)
  }, [
    mode,
    conversations,
    agentSessions,
    currentConversationId,
    currentAgentSessionId,
    tabs,
    draftSessionIds,
    openSession,
    setMode,
    setViewMode,
  ])

  const railRecentItems = React.useMemo(() => {
    if (mode === 'chat') {
      return conversations
        .filter((c) => !c.archived && !draftSessionIds.has(c.id))
        .sort((a, b) => {
          const activeDelta = Number(b.id === activeTabId) - Number(a.id === activeTabId)
          if (activeDelta !== 0) return activeDelta
          const streamingDelta = Number(streamingIds.has(b.id)) - Number(streamingIds.has(a.id))
          if (streamingDelta !== 0) return streamingDelta
          const pinnedDelta = Number(!!b.pinned) - Number(!!a.pinned)
          if (pinnedDelta !== 0) return pinnedDelta
          return b.updatedAt - a.updatedAt
        })
        .slice(0, 5)
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          type: 'chat' as const,
          initial: getRailInitial(conversation.title),
          active: conversation.id === activeTabId,
          status: streamingIds.has(conversation.id) ? 'running' as const : 'idle' as const,
          pinned: !!conversation.pinned,
        }))
    }

    return agentSessions
      .filter((session) =>
        !session.archived
        && !draftSessionIds.has(session.id)
        && (!currentWorkspaceId || session.workspaceId === currentWorkspaceId)
      )
      .sort((a, b) => {
        const statusA = agentIndicatorMap.get(a.id) ?? (unviewedCompletedSessionIds.has(a.id) ? 'completed' : 'idle')
        const statusB = agentIndicatorMap.get(b.id) ?? (unviewedCompletedSessionIds.has(b.id) ? 'completed' : 'idle')
        const priority = (session: AgentSessionMeta, status: SessionIndicatorStatus): number => {
          if (session.id === activeTabId) return 0
          if (status === 'blocked') return 1
          if (status === 'running') return 2
          if (workingSessionIds.has(session.id)) return 3
          if (session.pinned) return 4
          if (status === 'completed') return 5
          return 6
        }
        const priorityDelta = priority(a, statusA) - priority(b, statusB)
        if (priorityDelta !== 0) return priorityDelta
        return b.updatedAt - a.updatedAt
      })
      .slice(0, 5)
      .map((session) => ({
        id: session.id,
        title: session.title,
        type: 'agent' as const,
        initial: getRailInitial(session.title),
        active: session.id === activeTabId,
        status: agentIndicatorMap.get(session.id) ?? (unviewedCompletedSessionIds.has(session.id) ? 'completed' as const : 'idle' as const),
        pinned: !!session.pinned,
      }))
  }, [
    mode,
    conversations,
    agentSessions,
    draftSessionIds,
    currentWorkspaceId,
    activeTabId,
    streamingIds,
    agentIndicatorMap,
    unviewedCompletedSessionIds,
    workingSessionIds,
  ])

  // 删除确认弹窗（collapsed/expanded 共享）
  const deleteDialog = (
    <AlertDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
    >
      <AlertDialogContent
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleConfirmDelete()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除对话</AlertDialogTitle>
          <AlertDialogDescription>
            删除后将无法恢复，确定要删除这个对话吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // 迁移会话对话框（collapsed/expanded 共享）
  const moveDialog = (
    <MoveSessionDialog
      open={moveTargetId !== null}
      onOpenChange={(open) => { if (!open) setMoveTargetId(null) }}
      sessionId={moveTargetId ?? ''}
      currentWorkspaceId={currentWorkspaceId ?? undefined}
      workspaces={workspaces}
      onMoved={handleSessionMoved}
    />
  )

  // ===== 折叠状态：精简图标视图 =====
  if (sidebarCollapsed) {
    return (
      <div
        className="relative h-full flex flex-col items-center bg-background rounded-2xl shadow-xl transition-[width] duration-300 px-2"
        style={{ width: 60, flexShrink: 0 }}
      >
        <SidebarWindowDragStrip
          height={isMac ? SIDEBAR_DRAG_STRIP_HEIGHT.collapsedMac : SIDEBAR_DRAG_STRIP_HEIGHT.collapsed}
        />

        {/* macOS 需要避开左上角红绿灯；边栏覆盖全局标题栏拖拽层，因此留白自身也要可拖拽。 */}
        <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[50px]' : 'h-2')} />

        {/* 展开按钮：mini rail 的唯一布局控制入口 */}
        <div className="pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="展开侧边栏"
                onClick={() => setSidebarCollapsed(false)}
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/60 bg-muted hover:bg-foreground/[0.08] hover:text-foreground transition-colors titlebar-no-drag"
              >
                <PanelLeftOpen size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">展开侧边栏 ({navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})</TooltipContent>
          </Tooltip>
        </div>

        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 模式切换 */}
        <div className="flex flex-col items-center gap-1.5">
          <CollapsedWorkspacePopover>
            <button
              type="button"
              aria-label="切换到 Agent 模式（悬停查看工作区）"
              onClick={() => handleRailModeSwitch('agent')}
              className={cn(
                'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
                mode === 'agent'
                  ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                  : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75'
              )}
            >
              <Bot size={18} />
            </button>
          </CollapsedWorkspacePopover>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="切换到 Chat 模式"
                onClick={() => handleRailModeSwitch('chat')}
                className={cn(
                  'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
                  mode === 'chat'
                    ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                    : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75'
                )}
              >
                <MessageSquare size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Chat 模式</TooltipContent>
          </Tooltip>
        </div>

        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 高频操作 */}
        <div className="flex flex-col items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={mode === 'agent' ? '新建 Agent 会话' : '新建 Chat 对话'}
                onClick={mode === 'agent' ? handleNewAgentSession : handleNewConversation}
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/70 bg-primary/5 hover:bg-primary/10 transition-colors titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
              >
                <Plus size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {mode === 'agent' ? '新会话' : '新对话'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="搜索"
                onClick={() => setSearchDialogOpen(true)}
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/45 bg-primary/5 hover:bg-primary/10 hover:text-foreground/70 transition-colors titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
              >
                <Search size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">搜索</TooltipContent>
          </Tooltip>
        </div>

        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 最近/关键会话入口 */}
        <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-none">
          <div className="flex flex-col items-center gap-1.5 pb-2">
            {railRecentItems.map((item) => (
              <Tooltip key={`${item.type}-${item.id}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`打开${item.type === 'agent' ? 'Agent 会话' : 'Chat 对话'}：${item.title}`}
                    onClick={() => {
                      if (item.type === 'agent') {
                        handleSelectAgentSession(item.id, item.title)
                      } else {
                        handleSelectConversation(item.id, item.title)
                      }
                    }}
                    className={cn(
                      'relative size-10 flex items-center justify-center overflow-hidden rounded-[12px] transition-colors titlebar-no-drag',
                      item.active
                        ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                        : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full pointer-events-none',
                        RAIL_STATUS_CLASS[item.status]
                      )}
                    />
                    <span className="text-[13px] font-semibold leading-none">{item.initial}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.type === 'agent' ? 'Agent' : 'Chat'} · {item.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* 用户头像（点击打开设置） */}
        <div className="pt-3 pb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="打开设置"
                onClick={() => setSettingsOpen(true)}
                className="relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag hover:bg-foreground/5"
              >
                <UserAvatar avatar={userProfile.avatar} size={28} />
                {(hasUpdate || hasEnvironmentIssues) && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">设置</TooltipContent>
          </Tooltip>
        </div>

        {deleteDialog}
        {moveDialog}
        <SearchDialog />
      </div>
    )
  }

  // ===== 展开状态：完整侧边栏 =====
  return (
    <div
      className="relative h-full flex flex-col bg-background rounded-2xl shadow-xl transition-[width] duration-300"
      style={{ width: width ?? 240, minWidth: 170, flexShrink: 1 }}
    >
      <SidebarWindowDragStrip
        height={isMac ? SIDEBAR_DRAG_STRIP_HEIGHT.expandedMac : SIDEBAR_DRAG_STRIP_HEIGHT.expanded}
      />

      {/* macOS 需要避开左上角红绿灯；边栏覆盖全局标题栏拖拽层，因此留白自身也要可拖拽。 */}
      <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[30px]' : 'h-1')} />

      {/* 模式切换器 + 折叠按钮 */}
      <div className="titlebar-drag-region flex items-start gap-1.5 px-3">
        <div className="flex-1 min-w-0">
          <ModeSwitcher />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="mt-2 size-10 flex-shrink-0 flex items-center justify-center rounded-[10px] bg-muted text-foreground/40 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors titlebar-no-drag"
            >
              <PanelLeftClose size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">收起侧边栏 ({navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})</TooltipContent>
        </Tooltip>
      </div>

      {/* Agent 模式：工作区选择器 */}
      {mode === 'agent' && (
        <div className="px-3 pt-2">
          <WorkspaceSelector />
        </div>
      )}

      {/* 新对话/新会话按钮 + 搜索按钮 */}
      <div className="px-3 pt-2 flex items-center gap-1.5">
        <button
          onClick={mode === 'agent' ? handleNewAgentSession : handleNewConversation}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-medium text-foreground/70 bg-primary/5 hover:bg-primary/10 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
        >
          <Plus size={14} />
          <span>{mode === 'agent' ? '新会话' : '新对话'}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSearchDialogOpen(true)}
              className="flex-shrink-0 size-[36px] flex items-center justify-center rounded-[10px] text-foreground/40 bg-primary/5 hover:bg-primary/10 hover:text-foreground/60 transition-colors duration-100 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
            >
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">搜索 (⌘F)</TooltipContent>
        </Tooltip>
      </div>

      {/* Chat 模式：导航菜单（置顶区域） */}
      {mode === 'chat' && (
        <div className="flex flex-col gap-1 pt-3 px-3">
          <SidebarItem
            icon={<Pin size={16} />}
            label="置顶对话"
            suffix={
              pinnedConversations.length > 0 ? (
                pinnedExpanded
                  ? <ChevronDown size={14} className="text-foreground/40" />
                  : <ChevronRight size={14} className="text-foreground/40" />
              ) : undefined
            }
            onClick={() => handleItemClick('pinned')}
          />
        </div>
      )}

      {/* Chat 模式：置顶对话区域 */}
      {mode === 'chat' && pinnedExpanded && pinnedConversations.length > 0 && (
        <div className="px-3 pt-1 pb-1">
          <div className="flex flex-col gap-0.5 pl-1 border-l-2 border-primary/20 ml-2">
            {pinnedConversations.map((conv) => (
              <ConversationItem
                key={`pinned-${conv.id}`}
                conversation={conv}
                active={conv.id === activeTabId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={false}
                onSelect={handleSelectConversation}
                onRequestDelete={handleRequestDelete}
                onRename={handleRename}
                onTogglePin={handleTogglePin}
                onToggleArchive={handleToggleArchive}
              />
            ))}
          </div>
        </div>
      )}

      {/* Agent 模式 active 视图：可拖拽双区（上 置顶+Working + 下 最近会话） */}
      {mode === 'agent' && viewMode === 'active' ? (
        <div ref={agentSplitContainerRef} className="flex-1 flex flex-col min-h-0">
          {(pinnedAgentSessions.length > 0 || hasWorkingSessions) && (
            <>
              {/* 上区：工作中 / 置顶 Tab 切换（高度可拖拽） */}
              <div
                style={{ height: agentTopHeight > 0 ? agentTopHeight : undefined }}
                className="flex flex-col min-h-0 flex-shrink-0 overflow-hidden"
              >
                {/* Tab 切换按钮 */}
                <div className="pt-2 px-3 flex-shrink-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <button
                      onClick={() => setAgentSubTab('working')}
                      className={cn(
                        'flex-1 justify-center px-2.5 py-0.5 rounded-md text-[12px] font-medium transition-colors titlebar-no-drag inline-flex items-center',
                        agentSubTab === 'working'
                          ? 'tab-item-selected bg-foreground/[0.08] text-foreground/80'
                          : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04]'
                      )}
                    >
                      工作中
                      {hasWorkingSessions && (
                        <span className={cn(
                          'ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px]',
                          agentSubTab === 'working'
                            ? 'bg-foreground/10 text-foreground/60'
                            : 'bg-foreground/10 text-foreground/50'
                        )}>
                          {workingGroups.todo.length + workingGroups.running.length + workingGroups.done.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setAgentSubTab('pinned')}
                      className={cn(
                        'flex-1 justify-center px-2.5 py-0.5 rounded-md text-[12px] font-medium transition-colors titlebar-no-drag inline-flex items-center',
                        agentSubTab === 'pinned'
                          ? 'tab-item-selected bg-foreground/[0.08] text-foreground/80'
                          : 'text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04]'
                      )}
                    >
                      置顶
                      {pinnedAgentSessions.length > 0 && (
                        <span className={cn(
                          'ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px]',
                          agentSubTab === 'pinned'
                            ? 'bg-foreground/10 text-foreground/60'
                            : 'bg-foreground/10 text-foreground/50'
                        )}>
                          {pinnedAgentSessions.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Tab 内容（自己滚动） */}
                <div className="flex-1 overflow-y-auto scrollbar-none px-3 pb-1 min-h-0">
                  {agentSubTab === 'working' && (
                    <div className="pt-0.5 pb-0.5">
                      {hasWorkingSessions ? (() => {
                        const workingItems: Array<{ session: AgentSessionMeta; accent?: SessionLeftAccent; keyPrefix: string }> = [
                          ...workingGroups.todo.map((s) => ({ session: s, accent: 'orange' as const, keyPrefix: 'working-todo' })),
                          ...workingGroups.running.map((s) => ({ session: s, accent: 'blue' as const, keyPrefix: 'working-running' })),
                          ...workingGroups.done.map((s) => ({ session: s, accent: unviewedCompletedSessionIds.has(s.id) ? 'green' as const : undefined, keyPrefix: 'working-done' })),
                        ]
                        return (
                          <div className="flex flex-col gap-0.5">
                            {workingItems.map(({ session, accent, keyPrefix }) => (
                              <AgentSessionItem
                                key={`${keyPrefix}-${session.id}`}
                                session={session}
                                active={session.id === activeTabId}
                                indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                                isInWorkingSection={workingSessionIds.has(session.id)}
                                showPinIcon={false}
                                leftAccent={accent}
                                workspaceName={session.workspaceId ? workspaceNameMap.get(session.workspaceId) : undefined}
                                onSelect={handleSelectAgentSession}
                                onRequestDelete={handleRequestDelete}
                                onRequestMove={handleRequestMove}
                                onRename={handleAgentRename}
                                onTogglePin={handleTogglePinAgent}
                                onToggleManualWorking={handleToggleManualWorkingAgent}
                                onToggleArchive={handleToggleArchiveAgent}
                              />
                            ))}
                          </div>
                        )
                      })() : (
                        <div className="px-2 py-3 text-[11px] text-foreground/30 text-center select-none">
                          暂无进行中的会话
                        </div>
                      )}
                    </div>
                  )}

                  {agentSubTab === 'pinned' && (
                    <div className="pt-0.5 pb-0.5">
                      {pinnedAgentSessions.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {pinnedAgentSessions.map((session) => (
                            <AgentSessionItem
                              key={`pinned-${session.id}`}
                              session={session}
                              active={session.id === activeTabId}
                              indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                              isInWorkingSection={workingSessionIds.has(session.id)}
                              showPinIcon={false}
                              onSelect={handleSelectAgentSession}
                              onRequestDelete={handleRequestDelete}
                              onRequestMove={handleRequestMove}
                              onRename={handleAgentRename}
                              onTogglePin={handleTogglePinAgent}
                              onToggleManualWorking={handleToggleManualWorkingAgent}
                              onToggleArchive={handleToggleArchiveAgent}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="px-2 py-3 text-[11px] text-foreground/30 text-center select-none">
                          暂无置顶会话
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 拖拽分割条 */}
              <div
                onMouseDown={handleAgentTopResizeStart}
                className="h-[8px] cursor-row-resize active:bg-primary/50 transition-colors titlebar-no-drag flex-shrink-0 flex items-center"
              >
                <div className="mx-3 w-full border-t border-muted-foreground/20" />
              </div>
            </>
          )}

          {/* 下区标题：最近会话 */}
          <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none flex-shrink-0">
            最近会话
          </div>

          {/* 下区：历史会话列表 */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-none min-h-0">
            {agentSessionGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((session) => (
                    <AgentSessionItem
                      key={session.id}
                      session={session}
                      active={session.id === activeTabId}
                      indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                      isInWorkingSection={workingSessionIds.has(session.id)}
                      showPinIcon={!!session.pinned}
                      onSelect={handleSelectAgentSession}
                      onRequestDelete={handleRequestDelete}
                      onRequestMove={handleRequestMove}
                      onRename={handleAgentRename}
                      onTogglePin={handleTogglePinAgent}
                      onToggleManualWorking={handleToggleManualWorkingAgent}
                      onToggleArchive={handleToggleArchiveAgent}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* 归档视图标题栏 */}
          {viewMode === 'archived' && (
            <div className="px-6 pt-3 pb-1">
              <div className="text-[12px] font-medium text-foreground/40">
                已归档{mode === 'agent' ? '会话' : '对话'}
              </div>
            </div>
          )}

          {/* Chat 模式 / 归档视图：单列表布局 */}
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-none">
            {mode === 'chat' ? (
              /* Chat 模式：对话按日期分组 */
              conversationGroups.map((group) => (
                <div key={group.label} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((conv) => (
                      <ConversationItem
                        key={conv.id}
                        conversation={conv}
                        active={conv.id === activeTabId}
                        streaming={streamingIds.has(conv.id)}
                        showPinIcon={!!conv.pinned}
                        onSelect={handleSelectConversation}
                        onRequestDelete={handleRequestDelete}
                        onRename={handleRename}
                        onTogglePin={handleTogglePin}
                        onToggleArchive={handleToggleArchive}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              /* Agent 模式归档：Agent 会话按日期分组 */
              agentSessionGroups.map((group) => (
                <div key={group.label} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((session) => (
                      <AgentSessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeTabId}
                        indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                        isInWorkingSection={workingSessionIds.has(session.id)}
                        showPinIcon={!!session.pinned}
                        onSelect={handleSelectAgentSession}
                        onRequestDelete={handleRequestDelete}
                        onRequestMove={handleRequestMove}
                        onRename={handleAgentRename}
                        onTogglePin={handleTogglePinAgent}
                        onToggleManualWorking={handleToggleManualWorkingAgent}
                        onToggleArchive={handleToggleArchiveAgent}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Cloud 模式：从云端下载全部对话按钮 */}
      <CloudSidebarDownloadButton />

      {/* 已归档入口 / 返回活跃对话 */}
      <div className="px-3 pb-1">
        {viewMode === 'active' ? (
          <>
            {mode === 'chat' && archivedConversationCount > 0 && (
              <button
                onClick={() => setViewMode('archived')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
              >
                <Archive size={13} className="text-foreground/30" />
                <span>已归档 ({archivedConversationCount})</span>
              </button>
            )}
            {mode === 'agent' && archivedAgentSessionCount > 0 && (
              <button
                onClick={() => setViewMode('archived')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
              >
                <Archive size={13} className="text-foreground/30" />
                <span>已归档 ({archivedAgentSessionCount})</span>
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => setViewMode('active')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.07] hover:text-foreground/80 transition-colors titlebar-no-drag"
          >
            <ArrowLeft size={13} className="text-foreground/50" />
            <span>返回活跃{mode === 'agent' ? '会话' : '对话'}</span>
          </button>
        )}
      </div>

      {/* Agent 模式：工作区能力指示器 */}
      {mode === 'agent' && capabilities && (
        <div className="px-3 pb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setSettingsTab('agent'); setSettingsOpen(true) }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-[12px] text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70 transition-colors titlebar-no-drag"
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <span className="flex items-center gap-1">
                    <Plug size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{capabilities.mcpServers.filter((s) => s.enabled).length}</span>
                    <span className="text-foreground/30">MCP</span>
                  </span>
                  <span className="text-foreground/20">·</span>
                  <span className="flex items-center gap-1">
                    <Zap size={13} className="text-foreground/40" />
                    <span className="tabular-nums">{capabilities.skills.length}</span>
                    <span className="text-foreground/30">Skills</span>
                  </span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">点击配置 MCP 与 Skills</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Cloud 模式：侧边栏余额指示器 */}
      <CloudSidebarCreditIndicator />

      {/* 底部：用户资料 + 设置入口 */}
      <div className="px-3 pb-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] transition-colors titlebar-no-drag text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <UserAvatar avatar={userProfile.avatar} size={28} />
          <span className="flex-1 text-sm truncate text-left">{userProfile.userName}</span>
          <div className="relative flex-shrink-0 text-foreground/40">
            <Settings size={16} />
            {(hasUpdate || hasEnvironmentIssues) && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </div>
        </button>
      </div>

      {deleteDialog}
      {moveDialog}
      <SearchDialog />
    </div>
  )
}

// ===== 对话列表项 =====

interface ConversationItemProps {
  conversation: ConversationMeta
  active: boolean
  streaming: boolean
  /** 是否在标题旁显示 Pin 图标 */
  showPinIcon: boolean
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const ConversationItem = React.memo(function ConversationItem({
  conversation,
  active,
  streaming,
  showPinIcon,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(conversation.title)
    setEditing(true)
    justStartedEditing.current = true
    // 延迟聚焦，等待 ContextMenu 完全关闭后再 focus
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    // ContextMenu 关闭导致的 blur，忽略
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }
    await onRename(conversation.id, trimmed)
    setEditing(false)
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const isPinned = !!conversation.pinned

  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(conversation.id)}>
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? '取消置顶' : '置顶对话'}
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />
        重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(conversation.id)}>
        {conversation.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {conversation.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(conversation.id)}>
        <Trash2 size={14} />
        删除对话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(conversation.id, conversation.title)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className={cn(
            'group relative w-full flex items-center gap-2 px-3 py-[7px] rounded-md transition-colors duration-100 titlebar-no-drag text-left',
            active
              ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
              : 'hover:bg-primary/5'
          )}
        >
          {/* 流式状态左侧竖线条（与 Agent 保持一致） */}
          {streaming && (
            <span
              className="absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full bg-emerald-500 animate-pulse pointer-events-none"
              aria-hidden="true"
            />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn(
                'truncate text-[13px] leading-5 flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {/* 置顶标记 */}
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                <span className="truncate">{conversation.title}</span>
              </div>
            )}
          </div>

          {/* 三点菜单按钮（hover 时可见，始终占位避免跳动） */}
          {!editing && (
            <div
              className="flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                      'opacity-0 pointer-events-none',
                      'group-hover:opacity-100 group-hover:pointer-events-auto',
                      'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60 data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                    )}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                  {menuItems(DropdownMenuItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  )
})

// ===== Agent 会话列表项 =====

/** 会话行左侧状态色块的颜色 — 与 SessionIndicatorStatus 呼应 */
type SessionLeftAccent = 'orange' | 'blue' | 'green'
const SESSION_LEFT_ACCENT_CLASS: Record<SessionLeftAccent, string> = {
  orange: 'bg-orange-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
}

interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  indicatorStatus: SessionIndicatorStatus
  showPinIcon?: boolean
  /** 是否在工作中分区（auto 或 manual） */
  isInWorkingSection?: boolean
  /** 行左侧状态色块；未传则不显示 */
  leftAccent?: SessionLeftAccent
  /** 工作区名称 Badge（跨工作区列表时显示） */
  workspaceName?: string
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleManualWorking: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const AgentSessionItem = React.memo(function AgentSessionItem({
  session,
  active,
  indicatorStatus,
  showPinIcon,
  isInWorkingSection,
  leftAccent,
  workspaceName,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleManualWorking,
  onToggleArchive,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const isWorking = isInWorkingSection || session.manualWorking
  const canMove = indicatorStatus === 'idle' || indicatorStatus === 'completed'

  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(session.id)}>
        {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        {session.pinned ? '取消置顶' : '置顶会话'}
      </MenuItem>
      <MenuItem
        className="text-xs py-1 [&>svg]:size-3.5"
        disabled={indicatorStatus === 'running'}
        onSelect={() => { if (indicatorStatus !== 'running') onToggleManualWorking(session.id) }}
      >
        <Hammer size={14} className={isWorking ? 'fill-current' : ''} />
        {indicatorStatus === 'running' ? '运行中无法移出' : isWorking ? '取消工作中' : '标记为工作中'}
      </MenuItem>
      {canMove && (
        <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onRequestMove(session.id)}>
          <ArrowRightLeft size={14} />
          迁移到其他工作区
        </MenuItem>
      )}
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />
        重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(session.id)}>
        {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {session.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(session.id)}>
        <Trash2 size={14} />
        删除会话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(session.id, session.title)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className={cn(
            'group relative w-full flex items-center gap-2 px-3 py-[7px] rounded-md transition-colors duration-100 titlebar-no-drag text-left',
            active
              ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
              : 'hover:bg-primary/5'
          )}
        >
          {leftAccent && (
            <span
              className={cn(
                'absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full pointer-events-none',
                SESSION_LEFT_ACCENT_CLASS[leftAccent]
              )}
            />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn(
                'truncate text-[13px] leading-5 flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                <span className="truncate">{session.title}</span>
                {workspaceName && (
                  <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[80px]">
                    {workspaceName}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 三点菜单按钮（hover 时可见，始终占位避免跳动） */}
          {!editing && (
            <div
              className="flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'p-1 rounded-md text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                      'opacity-0 pointer-events-none',
                      'group-hover:opacity-100 group-hover:pointer-events-auto',
                      'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60 data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto',
                    )}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                  {menuItems(DropdownMenuItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  )
})
