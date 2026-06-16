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
import { useAtom, useSetAtom, useAtomValue, useStore } from 'jotai'
import { toast } from 'sonner'
import { Pin, PinOff, Settings, Plus, Trash2, Pencil, PanelLeftClose, PanelLeftOpen, ArrowRightLeft, Search, Archive, ArchiveRestore, ArrowLeft, Bot, MessageSquare, MoreHorizontal, FolderOpen, GripVertical, Clock, AlarmClock, ChevronRight, Blocks } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ModeSwitcher } from './ModeSwitcher'
import { SearchDialog } from './SearchDialog'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom, automationsAtom } from '@/atoms/automation-atoms'
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
  agentSDKMessagesCacheAtom,
  currentAgentSessionIdAtom,
  agentSessionIndicatorMapAtom,
  unviewedCompletedSessionIdsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentSessionPathMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
  agentDiffPanelTabAtom,
  agentDiffRefreshVersionAtom,
  agentDiffUnseenChangesAtom,
  agentDiffUnseenFilesAtom,
  agentDiffDataAtom,
  agentStreamingStatesAtom,
  liveMessagesMapAtom,
  agentSessionPendingFilesAtom,
  agentSessionStreamingStateAtomFamily,
  agentSessionDraftAtomFamily,
  agentSessionDraftHtmlAtomFamily,
  agentPendingFilesAtomFamily,
  backgroundTasksAtomFamily,
  sessionPersistedPermissionModeAtom,
  sessionExistsAtom,
} from '@/atoms/agent-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { previewPanelOpenMapAtom, previewFileMapAtom } from '@/atoms/preview-atoms'
import { clearPreviewCacheForSession } from '@/components/diff/DiffTabContent'
import {
  tabsAtom,
  activeTabIdAtom,
  activeSessionIdAtom,
  sidebarCollapsedAtom,
  closeTab,
  updateTabTitle,
  sessionViewStateMapAtom,
} from '@/atoms/tab-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { sidebarViewModeAtom } from '@/atoms/sidebar-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { hasUpdateAtom } from '@/atoms/updater'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { promptConfigAtom, selectedPromptIdAtom, conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { CollapsedWorkspacePopover } from '@/components/agent/CollapsedWorkspacePopover'
import { MoveSessionDialog } from '@/components/agent/MoveSessionDialog'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
  type SessionMiniMapType,
} from '@/components/session-preview/SessionMiniMapPopover'
import { detectIsMac } from '@/lib/platform'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import {
  replaceAgentSessionInFreshnessOrder,
  sortAgentSessionsByUpdatedAtDesc,
} from '@/lib/agent-session-list'
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
import type { ConversationMeta, AgentSessionMeta, AgentWorkspace, WorkspaceCapabilities } from '@proma/shared'

function formatAutomationCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

interface AutomationSidebarEntryProps {
  count: number
  active: boolean
  onClick: () => void
}

function AutomationSidebarEntry({ count, active, onClick }: AutomationSidebarEntryProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={`自动任务，${count} 个任务已创建`}
      onClick={onClick}
      className={cn(
        'group w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] transition-colors duration-100 titlebar-no-drag automation-entry',
        active
          ? 'automation-entry-selected bg-accent-foreground/[0.10] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className={cn('flex-shrink-0 w-[18px] h-[18px] automation-entry-icon', active ? 'text-accent-foreground' : 'text-foreground/45')}>
          <AlarmClock size={16} className="block" />
        </span>
        <span className="truncate">自动任务</span>
      </span>
      <span
        className={cn(
          'ml-2 flex h-5 min-w-[22px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums automation-entry-badge',
          active
            ? 'bg-accent-foreground/[0.26] text-primary-foreground'
            : 'bg-foreground/[0.045] text-foreground/[0.42] group-hover:text-foreground/65',
        )}
      >
        {formatAutomationCount(count)}
      </span>
    </button>
  )
}

interface SkillsSidebarEntryProps {
  count: number
  updateCount: number
  active: boolean
  onClick: () => void
}

function SkillsSidebarEntry({ count, updateCount, active, onClick }: SkillsSidebarEntryProps): React.ReactElement {
  const hasUpdate = updateCount > 0
  return (
    <button
      type="button"
      aria-label={`Agent 技能，${count} 个能力${hasUpdate ? `，${updateCount} 个可更新` : ''}`}
      onClick={onClick}
      className={cn(
        'group w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] transition-colors duration-100 titlebar-no-drag',
        active
          ? 'bg-accent-foreground/[0.10] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground',
      )}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className={cn('flex-shrink-0 w-[18px] h-[18px]', active ? 'text-accent-foreground' : 'text-foreground/45')}>
          <Blocks size={16} className="block" />
        </span>
        <span className="truncate">Agent 技能</span>
      </span>
      <span
        className={cn(
          'ml-2 flex h-5 min-w-[22px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums',
          hasUpdate
            ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
            : active
              ? 'bg-accent-foreground/[0.26] text-primary-foreground'
              : 'bg-foreground/[0.045] text-foreground/[0.42] group-hover:text-foreground/65',
        )}
      >
        {formatAutomationCount(count)}
      </span>
    </button>
  )
}

export interface LeftSidebarProps {
  /** 可选固定宽度，默认使用 CSS 响应式宽度 */
  width?: number
}

/** 日期分组标签 */
type DateGroup = '今天' | '昨天' | '更早'

interface AgentProjectGroup {
  workspace: AgentWorkspace
  sessions: AgentSessionMeta[]
}

const PROJECT_SESSION_PREVIEW_LIMIT = 5
const PROJECT_SESSION_RECENT_WINDOW_MS = 3 * 86_400_000
/** 点击"显示更多"时每次额外展开的会话数量 */
const PROJECT_SESSION_EXPAND_STEP = 10
/** 置顶区最多占用约 6 条会话的高度，超过后在置顶区内部滚动 */
const PINNED_SESSION_VISIBLE_LIMIT = 6
const PINNED_SESSION_ROW_HEIGHT_PX = 32
const PINNED_SESSION_MAX_HEIGHT = PINNED_SESSION_VISIBLE_LIMIT * PINNED_SESSION_ROW_HEIGHT_PX

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionIndicatorStatus> = new Set([
  'blocked',
  'running',
  'completed',
])

const ACTIVE_SESSION_STATUS_PRIORITY: Record<SessionIndicatorStatus, number> = {
  blocked: 0,
  running: 1,
  completed: 2,
  idle: 3,
}

function formatRelativeUpdatedAt(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟`
  if (diff < day) return `${Math.floor(diff / hour)} 小时`
  if (diff < month) return `${Math.floor(diff / day)} 天`
  if (diff < year) return `${Math.floor(diff / month)} 月`
  return `${Math.floor(diff / year)} 年`
}

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
  running: 'border-blue-500 animate-pulse',
  blocked: 'border-orange-500',
  completed: 'border-emerald-500',
}

const SIDEBAR_DRAG_STRIP_HEIGHT = {
  collapsedMac: 50,
  expandedMac: 30,
  collapsed: 8,
  expanded: 4,
} as const

function getRailInitial(title: string): string {
  return title.trim().slice(0, 1).toUpperCase() || '·'
}

interface RailRecentItem {
  id: string
  title: string
  type: SessionMiniMapType
  initial: string
  active: boolean
  status: SessionIndicatorStatus
  pinned: boolean
  workspaceName?: string
  isAutomation?: boolean
}

function RailRecentButton({
  item,
  onSelect,
}: {
  item: RailRecentItem
  onSelect: (item: RailRecentItem) => void
}): React.ReactElement {
  const preview = useSessionMiniMapHover()

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={preview.setAnchorRef}
            type="button"
            aria-label={`打开${item.type === 'agent' ? 'Agent 会话' : 'Chat 对话'}：${item.title}`}
            onClick={() => onSelect(item)}
            onMouseEnter={preview.handleMouseEnter}
            onMouseLeave={preview.handleMouseLeave}
            className={cn(
              'relative size-10 flex items-center justify-center overflow-hidden rounded-[12px] transition-colors titlebar-no-drag',
              item.active
                ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80'
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-0 border-l-[3px] rounded-l-[12px] pointer-events-none',
                RAIL_STATUS_CLASS[item.status]
              )}
            />
            {item.isAutomation
              ? <Clock size={14} className="text-foreground/40" />
              : <span className="text-[13px] font-semibold leading-none">{item.initial}</span>
            }
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {item.type === 'agent' ? 'Agent' : 'Chat'} · {item.title}
        </TooltipContent>
      </Tooltip>
      <SessionMiniMapPopover
        target={{
          type: item.type,
          sessionId: item.id,
          title: item.title,
          workspaceName: item.workspaceName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
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

/** 不可变地切换 Set 中某个成员的存在状态（存在则删除，不存在则添加），返回新 Set */
function toggleSetEntry<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

/** 不可变地从 Set 中移除某个成员，若不存在则原样返回 */
function deleteSetEntry<T>(prev: Set<T>, value: T): Set<T> {
  if (!prev.has(value)) return prev
  const next = new Set(prev)
  next.delete(value)
  return next
}

export function LeftSidebar({ width }: LeftSidebarProps): React.ReactElement {
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const automations = useAtomValue(automationsAtom)
  const setAutomations = useSetAtom(automationsAtom)
  const automationCount = automations.length
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [currentConversationId, setCurrentConversationId] = useAtom(currentConversationIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const setAgentMessagesCache = useSetAtom(agentSDKMessagesCacheAtom)

  /** 待删除对话 ID，非空时显示确认弹窗 */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  /** 待删除项目 ID，非空时显示项目删除确认弹窗 */
  const [pendingDeleteWorkspaceId, setPendingDeleteWorkspaceId] = React.useState<string | null>(null)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = React.useState<string | null>(null)
  /** 待迁移会话 ID，非空时显示迁移对话框 */
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)
  /** 每个项目额外展开显示的会话数量（每次点击"显示更多" +10），未点击则为 0 或无值 */
  const [expandedExtraCountMap, setExpandedExtraCountMap] = React.useState<Map<string, number>>(new Map())
  /** 记录被用户手动折叠的工作区 ID（点击当前工作区标题时折叠/展开）。刻意不持久化：折叠被视为临时查看行为，刷新/重启后恢复默认展开 */
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = React.useState<Set<string>>(new Set())
  /** 项目拖拽排序状态 */
  const [dragProjectId, setDragProjectId] = React.useState<string | null>(null)
  const [projectDropIndicator, setProjectDropIndicator] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null)
  /** 新建项目输入状态 */
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [newProjectName, setNewProjectName] = React.useState('')
  const newProjectInputRef = React.useRef<HTMLInputElement>(null)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
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
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const setMode = useSetAtom(appModeAtom)

  // 当前项目能力（MCP + Skill 计数）
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  // Tab 状态
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  // 会话高亮按"激活 Tab 所属会话"判定：预览 Tab 激活时其 owner 会话仍保持高亮
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const openSession = useOpenSession()
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()
  const store = useStore()

  // 归档 & 搜索状态
  const [viewMode, setViewMode] = useAtom(sidebarViewModeAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)

  React.useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // 当 activeTabId 变化时，自动滚动侧边栏使选中项可见
  React.useEffect(() => {
    if (!activeTabId) return
    requestAnimationFrame(() => {
      const el = document.querySelector('.agent-session-item-active, .session-item-selected')
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
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  const setSessionPendingFiles = useSetAtom(agentSessionPendingFilesAtom)
  const setSessionViewStateMap = useSetAtom(sessionViewStateMapAtom)

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
    // 会话工作目录路径：不清理会导致右侧文件面板继续用已删除目录请求 list-directory
    setSessionPathMap(deleteKey)
    // 视图状态（预览开关 + 上次视图）：删除/归档是终态，统一清理避免孤立条目
    setSessionViewStateMap(deleteKey)

    // 重型流式数据：streamingStates（累积 content + toolActivities）与 liveMessages（SDK 消息数组）
    setStreamingStates(deleteKey)
    setLiveMessagesMap(deleteKey)

    // 待发送附件：先释放 blob URL 和 window 缓存中的 base64，再删 base map entry。
    // 与文字草稿不同，附件涉及 ObjectURL 和大体积二进制数据，删除/归档时不保留。
    const sessionPending = store.get(agentSessionPendingFilesAtom).get(id)
    if (sessionPending && sessionPending.length > 0) {
      for (const f of sessionPending) {
        if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl)
        window.__pendingAgentFileData?.delete(f.id)
      }
      setSessionPendingFiles(deleteKey)
    }

    // atomFamily 内部缓存（Jotai 对 string key 强引用 Map，不显式 remove 永不释放）。
    // 删除/归档是会话的终态，连同草稿一起清理，无需像关闭 Tab 那样保留可恢复输入。
    agentSessionStreamingStateAtomFamily.remove(id)
    agentSessionDraftAtomFamily.remove(id)
    agentSessionDraftHtmlAtomFamily.remove(id)
    agentPendingFilesAtomFamily.remove(id)
    backgroundTasksAtomFamily.remove(id)
    sessionPersistedPermissionModeAtom.remove(id)
    sessionExistsAtom.remove(id)

    clearPreviewCacheForSession(id)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setPreviewPanelOpen, setPreviewFile, setDiffPanelTab, setDiffRefreshVersion, setDiffUnseen, setDiffUnseenFiles, setDiffData, setSessionChannelMap, setSessionModelMap, setSessionPathMap, setSessionViewStateMap, setStreamingStates, setLiveMessagesMap, setSessionPendingFiles, store])

  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workspaces) map.set(w.id, w.name)
    return map
  }, [workspaces])

  const pendingDeleteWorkspace = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === pendingDeleteWorkspaceId) ?? null,
    [pendingDeleteWorkspaceId, workspaces],
  )

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

  /** 置顶 Agent 会话列表（仅活跃模式显示，跨项目展示，排除 draft） */
  const pinnedAgentSessions = React.useMemo(
    () => {
      if (viewMode !== 'active') return []
      const filtered = agentSessions.filter((s) =>
        s.pinned
        && !draftSessionIds.has(s.id)
      )
      return sortAgentSessionsByUpdatedAtDesc(filtered)
    },
    [agentSessions, viewMode, draftSessionIds]
  )

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

  /** 已归档 Agent 会话数量（跨项目） */
  const archivedAgentSessionCount = React.useMemo(
    () => agentSessions.filter((s) => s.archived && !draftSessionIds.has(s.id)).length,
    [agentSessions, draftSessionIds]
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

  /** 打开自动任务列表 */
  const handleOpenAutomations = React.useCallback((): void => {
    setAutomationForm({ open: false, draft: null })
    setActiveView('automations')
  }, [setAutomationForm, setActiveView])

  /** 打开 Agent 技能视图 */
  const handleOpenSkills = React.useCallback((): void => {
    setActiveView('agent-skills')
  }, [setActiveView])

  // 切换模式时重置归档视图
  React.useEffect(() => {
    setViewMode('active')
  }, [mode, setViewMode])

  /** 创建新对话（继承当前选中的模型/渠道） */
  const handleNewConversation = async (): Promise<void> => {
    setActiveView('conversations')
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
  }, [openSession, setActiveView])

  /** 请求删除对话（弹出确认框） */
  const handleRequestDelete = React.useCallback((id: string): void => {
    setPendingDeleteId(id)
  }, [])

  /** 重命名对话标题 */
  const handleRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
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
  }, [setConversations, setTabs])

  /** 切换对话置顶状态 */
  const handleTogglePin = React.useCallback(async (id: string): Promise<void> => {
    try {
      const original = store.get(conversationsAtom).find((c) => c.id === id)
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
  }, [store, setConversations])

  /** 切换对话归档状态 */
  const handleToggleArchive = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 归档时自动关闭该对话的标签页，并同步新激活标签的副作用
      // （appMode、currentXxxId 等），避免文件面板/工具栏等 per-tab
      // 状态被遗留为旧值或被错误地置 null。
      if (updated.archived) {
        const currentTabs = store.get(tabsAtom)
        const currentActiveTabId = store.get(activeTabIdAtom)
        const wasActive = currentActiveTabId === id
        const tabResult = closeTab(currentTabs, currentActiveTabId, id)
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
  }, [store, setConversations, setTabs, setActiveTabId, cleanupMapAtoms, syncActiveTabSideEffects])

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
        // 清理该会话的消息缓存，避免已删除会话的消息数组滞留内存
        setAgentMessagesCache((prev) => {
          if (!prev.has(pendingDeleteId)) return prev
          const next = new Map(prev)
          next.delete(pendingDeleteId)
          return next
        })
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

  /** 在指定项目中创建 Agent 会话；未指定时使用当前项目 */
  const createAgentSessionInWorkspace = React.useCallback(async (workspaceId?: string): Promise<void> => {
    try {
      const targetWorkspaceId = workspaceId ?? currentWorkspaceId ?? undefined
      if (targetWorkspaceId && targetWorkspaceId !== currentWorkspaceId) {
        setCurrentWorkspaceId(targetWorkspaceId)
        window.electronAPI.updateSettings({ agentWorkspaceId: targetWorkspaceId }).catch(console.error)
      }

      const meta = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        targetWorkspaceId,
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
    } catch (error) {
      console.error('[侧边栏] 创建 Agent 会话失败:', error)
    }
  }, [agentChannelId, agentModelId, currentWorkspaceId, openSession, setActiveView, setAgentSessions, setCurrentWorkspaceId, setSessionChannelMap, setSessionModelMap])

  /** 创建新 Agent 会话 */
  const handleNewAgentSession = React.useCallback(async (): Promise<void> => {
    setActiveView('conversations')
    await createAgentSessionInWorkspace()
  }, [createAgentSessionInWorkspace, setActiveView])

  /** 切换当前项目；点击当前已选中工作区标题时则折叠/展开其会话列表 */
  const handleSelectProject = React.useCallback((workspaceId: string): void => {
    if (workspaceId === currentWorkspaceId) {
      // 点击当前工作区 → 折叠/展开会话列表
      setCollapsedWorkspaceIds((prev) => toggleSetEntry(prev, workspaceId))
      return
    }
    setCurrentWorkspaceId(workspaceId)
    setActiveView('conversations')
    // 切换到新工作区时，自动展开该工作区
    setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, workspaceId))
    window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
  }, [currentWorkspaceId, setCurrentWorkspaceId, setActiveView])

  const canDeleteWorkspace = React.useCallback(
    (workspace: AgentWorkspace): boolean => workspace.slug !== 'default' && workspaces.length > 1,
    [workspaces.length],
  )

  /** 请求删除项目（弹出二次确认框） */
  const handleRequestDeleteWorkspace = React.useCallback((workspaceId: string): void => {
    setPendingDeleteWorkspaceId(workspaceId)
  }, [])

  /** 确认删除项目及其绑定资源 */
  const handleConfirmDeleteWorkspace = React.useCallback(async (): Promise<void> => {
    const workspaceId = pendingDeleteWorkspaceId
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspaceId || !workspace) return

    if (!canDeleteWorkspace(workspace)) {
      toast.error(workspace.slug === 'default' ? '默认项目不能删除' : '至少需要保留一个项目')
      setPendingDeleteWorkspaceId(null)
      return
    }

    const deletedSessionIds = new Set(
      agentSessions
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id),
    )

    try {
      setDeletingWorkspaceId(workspaceId)

      await window.electronAPI.deleteAgentWorkspace(workspaceId)

      for (const sessionId of deletedSessionIds) {
        cleanupMapAtoms(sessionId)
      }

      setDraftSessionIds((prev: Set<string>) => {
        let changed = false
        const next = new Set(prev)
        for (const sessionId of deletedSessionIds) {
          if (next.delete(sessionId)) changed = true
        }
        return changed ? next : prev
      })

      setAgentMessagesCache((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const sessionId of deletedSessionIds) {
          if (next.delete(sessionId)) changed = true
        }
        return changed ? next : prev
      })
      setAutomations((prev) => prev.filter((automation) => automation.workspaceId !== workspaceId))

      const currentTabs = store.get(tabsAtom)
      const currentActiveTabId = store.get(activeTabIdAtom)
      const nextTabs = currentTabs.filter((tab) => (
        (tab.type !== 'agent' && tab.type !== 'preview') || !deletedSessionIds.has(tab.sessionId)
      ))
      const nextActiveTabId = currentActiveTabId && nextTabs.some((tab) => tab.id === currentActiveTabId)
        ? currentActiveTabId
        : nextTabs[0]?.id ?? null

      setTabs(nextTabs)
      setActiveTabId(nextActiveTabId)
      syncActiveTabSideEffects(nextActiveTabId ? nextTabs.find((tab) => tab.id === nextActiveTabId) ?? null : null)

      const [remainingWorkspaces, sessions] = await Promise.all([
        window.electronAPI.listAgentWorkspaces(),
        window.electronAPI.listAgentSessions(),
      ])

      setWorkspaces(remainingWorkspaces)
      setAgentSessions(sessions)

      setExpandedExtraCountMap((prev) => {
        if (!prev.has(workspaceId)) return prev
        const next = new Map(prev)
        next.delete(workspaceId)
        return next
      })

      setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, workspaceId))

      if (workspaceId === currentWorkspaceId) {
        const fallback = remainingWorkspaces.find((item) => item.slug === 'default') ?? remainingWorkspaces[0] ?? null
        setCurrentWorkspaceId(fallback?.id ?? null)
        if (fallback) {
          window.electronAPI.updateSettings({ agentWorkspaceId: fallback.id }).catch(console.error)
        }
      }

      toast.success('项目已删除', {
        description: `已删除「${workspace.name}」及其绑定资源`,
      })
    } catch (error) {
      console.error('[侧边栏] 删除项目失败:', error)
      const msg = error instanceof Error ? error.message : '删除项目失败'
      toast.error(msg)
    } finally {
      setDeletingWorkspaceId(null)
      setPendingDeleteWorkspaceId(null)
    }
  }, [
    pendingDeleteWorkspaceId,
    workspaces,
    canDeleteWorkspace,
    agentSessions,
    cleanupMapAtoms,
    setDraftSessionIds,
    setAgentMessagesCache,
    setAutomations,
    store,
    setTabs,
    setActiveTabId,
    syncActiveTabSideEffects,
    setWorkspaces,
    setAgentSessions,
    currentWorkspaceId,
    setCurrentWorkspaceId,
  ])

  /** 展开某个项目时每次额外显示的会话数量 */
  const handleShowMoreSessions = React.useCallback((workspaceId: string): void => {
    setExpandedExtraCountMap((prev) => {
      const next = new Map(prev)
      next.set(workspaceId, (prev.get(workspaceId) ?? 0) + PROJECT_SESSION_EXPAND_STEP)
      return next
    })
  }, [])

  /** 收起某个项目额外展开的会话 */
  const handleCollapseExtraSessions = React.useCallback((workspaceId: string): void => {
    setExpandedExtraCountMap((prev) => {
      if (!prev.has(workspaceId)) return prev
      const next = new Map(prev)
      next.delete(workspaceId)
      return next
    })
  }, [])

  /** 开始拖拽项目排序 */
  const handleProjectDragStart = React.useCallback((e: React.DragEvent, workspaceId: string): void => {
    setDragProjectId(workspaceId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', workspaceId)
  }, [])

  /** 根据鼠标位置计算项目插入点 */
  const handleProjectDragOver = React.useCallback((e: React.DragEvent, workspaceId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragProjectId || dragProjectId === workspaceId) {
      setProjectDropIndicator(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const position: 'before' | 'after' = ratio < 0.5 ? 'before' : 'after'
    setProjectDropIndicator((prev) => (
      prev?.id === workspaceId && prev.position === position
        ? prev
        : { id: workspaceId, position }
    ))
  }, [dragProjectId])

  const handleProjectDragLeave = React.useCallback((e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setProjectDropIndicator(null)
    }
  }, [])

  /** 完成项目排序并持久化 */
  const handleProjectDrop = React.useCallback((e: React.DragEvent, targetWorkspaceId: string): void => {
    e.preventDefault()
    if (!dragProjectId || dragProjectId === targetWorkspaceId || !projectDropIndicator || projectDropIndicator.id !== targetWorkspaceId) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }

    const fromIndex = workspaces.findIndex((workspace) => workspace.id === dragProjectId)
    const toIndex = workspaces.findIndex((workspace) => workspace.id === targetWorkspaceId)
    if (fromIndex === -1 || toIndex === -1) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }

    const reordered = [...workspaces]
    const [moved] = reordered.splice(fromIndex, 1)
    if (!moved) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    const insertIndex = projectDropIndicator.position === 'after' ? adjustedToIndex + 1 : adjustedToIndex
    reordered.splice(insertIndex, 0, moved)

    setWorkspaces(reordered)
    setDragProjectId(null)
    setProjectDropIndicator(null)
    window.electronAPI
      .reorderAgentWorkspaces(reordered.map((workspace) => workspace.id))
      .then(setWorkspaces)
      .catch((error) => {
        console.error('[侧边栏] 项目排序失败:', error)
        setWorkspaces(workspaces)
        toast.error('项目排序失败')
      })
  }, [dragProjectId, projectDropIndicator, setWorkspaces, workspaces])

  const handleProjectDragEnd = React.useCallback((): void => {
    setDragProjectId(null)
    setProjectDropIndicator(null)
  }, [])

  /** 开始创建新项目 */
  const handleStartCreateProject = React.useCallback((): void => {
    setCreatingProject(true)
    setNewProjectName('')
    requestAnimationFrame(() => {
      newProjectInputRef.current?.focus()
    })
  }, [])

  /** 创建新项目，并设为当前项目 */
  const handleCreateProject = React.useCallback(async (): Promise<void> => {
    const trimmed = newProjectName.trim()
    if (!trimmed) {
      setCreatingProject(false)
      return
    }

    try {
      const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
      setWorkspaces((prev) => [workspace, ...prev])
      setCurrentWorkspaceId(workspace.id)
      window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
      setCreatingProject(false)
      setNewProjectName('')
    } catch (error) {
      const msg = error instanceof Error ? error.message : '创建项目失败'
      toast.error(msg)
    }
  }, [newProjectName, setCurrentWorkspaceId, setWorkspaces])

  const handleCreateProjectKeyDown = React.useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      void handleCreateProject()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCreatingProject(false)
      setNewProjectName('')
    }
  }, [handleCreateProject])

  /** 选择 Agent 会话（打开或聚焦标签页） */
  const handleSelectAgentSession = React.useCallback((id: string, title: string): void => {
    openSession('agent', id, title)
    setActiveView('conversations')
    // 清除该会话的"已完成未查看"标记
    setUnviewedCompleted((prev: Set<string>) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [openSession, setActiveView, setUnviewedCompleted])

  /** 重命名工作区（项目）名称 */
  const handleWorkspaceRename = React.useCallback(async (workspaceId: string, newName: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentWorkspace(workspaceId, { name: newName })
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    } catch (error) {
      console.error('[侧边栏] 重命名工作区失败:', error)
      const msg = error instanceof Error ? error.message : '重命名失败'
      toast.error(msg)
    }
  }, [setWorkspaces])

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }, [setAgentSessions, setTabs])

  /** 切换 Agent 会话置顶状态 */
  const handleTogglePinAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      const original = store.get(agentSessionsAtom).find((s) => s.id === id)
      const updated = await window.electronAPI.togglePinAgentSession(id)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      if (updated.pinned) {
        if (original?.archived && !updated.archived) {
          toast.success('已置顶', { description: '已自动取消归档' })
        } else {
          toast.success('已置顶')
        }
      } else {
        toast.success('已取消置顶')
      }
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话置顶失败:', error)
    }
  }, [store, setAgentSessions])

  /** 切换 Agent 会话归档状态 */
  const handleToggleArchiveAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      // 归档时自动关闭该会话的标签页，并同步新激活标签的副作用，
      // 否则 RightSidePanel（依赖 currentAgentSessionIdAtom）会因为
      // 指针被错误置 null 而消失。
      if (updated.archived) {
        const currentTabs = store.get(tabsAtom)
        const currentActiveTabId = store.get(activeTabIdAtom)
        const wasActive = currentActiveTabId === id
        const tabResult = closeTab(currentTabs, currentActiveTabId, id)
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
      console.error('[侧边栏] 切换 Agent 会话归档失败:', error)
    }
  }, [store, setAgentSessions, setTabs, setActiveTabId, cleanupMapAtoms, syncActiveTabSideEffects])

  /** 请求迁移会话到其他项目（弹出迁移对话框） */
  const handleRequestMove = React.useCallback((id: string): void => {
    setMoveTargetId(id)
  }, [])

  /** 迁移会话到另一个项目后的回调 */
  const handleSessionMoved = (updatedSession: AgentSessionMeta, targetWorkspaceName: string): void => {
    setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updatedSession))
    // 如果迁移的是当前选中的会话，取消选中并关闭标签页
    if (currentAgentSessionId === updatedSession.id) {
      const tabResult = closeTab(tabs, activeTabId, updatedSession.id)
      setTabs(tabResult.tabs)
      setActiveTabId(tabResult.activeTabId)
      setCurrentAgentSessionId(null)
    }
    setMoveTargetId(null)
    toast.success('会话已迁移', {
      description: `已迁移到「${targetWorkspaceName}」，请切换项目查看`,
    })
  }

  /** Agent 普通历史按项目分组（排除置顶 / 归档 / draft） */
  const agentProjectGroups = React.useMemo<AgentProjectGroup[]>(
    () => {
      const sessionsByWorkspaceId = new Map<string, AgentSessionMeta[]>()
      for (const workspace of workspaces) {
        sessionsByWorkspaceId.set(workspace.id, [])
      }

      const visibleHistory = sortAgentSessionsByUpdatedAtDesc(
        agentSessions.filter((session) =>
          !session.archived
          && !session.pinned
          && !draftSessionIds.has(session.id)
        )
      )

      const defaultWsId = workspaces.find((ws) => ws.slug === 'default')?.id ?? workspaces[0]?.id
      for (const session of visibleHistory) {
        const targetId = session.workspaceId && sessionsByWorkspaceId.has(session.workspaceId)
          ? session.workspaceId
          : defaultWsId
        if (!targetId) continue
        sessionsByWorkspaceId.get(targetId)!.push(session)
      }

      return workspaces.map((workspace) => ({
        workspace,
        sessions: sessionsByWorkspaceId.get(workspace.id) ?? [],
      }))
    },
    [agentSessions, draftSessionIds, workspaces],
  )

  /** Agent 归档会话按日期分组（跨项目） */
  const agentSessionGroups = React.useMemo(
    () => groupByDate(sortAgentSessionsByUpdatedAtDesc(
      agentSessions.filter((session) => session.archived && !draftSessionIds.has(session.id))
    )),
    [agentSessions, draftSessionIds]
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
          const activeDelta = Number(b.id === activeSessionId) - Number(a.id === activeSessionId)
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
          active: conversation.id === activeSessionId,
          status: streamingIds.has(conversation.id) ? 'running' as const : 'idle' as const,
          pinned: !!conversation.pinned,
          workspaceName: undefined,
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
          if (session.id === activeSessionId) return 0
          if (status === 'blocked') return 1
          if (status === 'running') return 2
          if (session.pinned) return 3
          if (status === 'completed') return 4
          return 5
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
        active: session.id === activeSessionId,
        status: agentIndicatorMap.get(session.id) ?? (unviewedCompletedSessionIds.has(session.id) ? 'completed' as const : 'idle' as const),
        pinned: !!session.pinned,
        workspaceName: session.workspaceId ? workspaceNameMap.get(session.workspaceId) : undefined,
        isAutomation: !!session.sourceAutomationId,
      }))
  }, [
    mode,
    conversations,
    agentSessions,
    draftSessionIds,
    currentWorkspaceId,
    activeSessionId,
    streamingIds,
    agentIndicatorMap,
    unviewedCompletedSessionIds,
    workspaceNameMap,
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

  // 项目删除确认弹窗（会同时删除项目下的会话与工作区资源）
  const projectDeleteDialog = (
    <AlertDialog
      open={pendingDeleteWorkspaceId !== null}
      onOpenChange={(open) => {
        if (!open && !deletingWorkspaceId) setPendingDeleteWorkspaceId(null)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !deletingWorkspaceId) {
            e.preventDefault()
            void handleConfirmDeleteWorkspace()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除项目</AlertDialogTitle>
          <AlertDialogDescription>
            将删除「{pendingDeleteWorkspace?.name ?? '该项目'}」及其绑定的所有会话、自动任务、MCP、Skills、工作区文件和本地项目目录。附加目录和附加文件只会移除引用，不会删除原始文件。删除后无法恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={!!deletingWorkspaceId}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={!!deletingWorkspaceId}
            onClick={handleConfirmDeleteWorkspace}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deletingWorkspaceId ? '删除中...' : '删除项目'}
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
              aria-label="切换到 Agent 模式（悬停查看项目）"
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
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/70 bg-primary/5 hover:bg-primary/10 hover:text-foreground transition-[background-color,border-color,color] duration-150 titlebar-no-drag border border-border/60 hover:border-border"
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
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/45 bg-primary/5 hover:bg-primary/10 hover:text-foreground/70 transition-[background-color,border-color,color] duration-150 titlebar-no-drag border border-border/60 hover:border-border"
              >
                <Search size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">搜索</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`自动任务，${automationCount} 个任务已创建`}
                onClick={handleOpenAutomations}
                className={cn(
                  'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                  activeView === 'automations'
                    ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                )}
              >
                <AlarmClock size={16} />
                {automationCount > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                      activeView === 'automations'
                        ? 'bg-primary-foreground text-primary'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {formatAutomationCount(automationCount)}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              自动任务（{automationCount} 个任务已创建）
            </TooltipContent>
          </Tooltip>

          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Agent 技能"
                  onClick={handleOpenSkills}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    activeView === 'agent-skills'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <Blocks size={16} />
                  {(capabilities?.skills.filter((s) => s.hasUpdate).length ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-blue-500" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Agent 技能</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 最近/关键会话入口 */}
        <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin">
          <div className="flex flex-col items-center gap-1.5 pb-2">
            {railRecentItems.map((item) => (
              <RailRecentButton
                key={`${item.type}-${item.id}`}
                item={item}
                onSelect={(selected) => {
                  if (selected.type === 'agent') {
                    handleSelectAgentSession(selected.id, selected.title)
                  } else {
                    handleSelectConversation(selected.id, selected.title)
                  }
                }}
              />
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
        {projectDeleteDialog}
        {moveDialog}
        <SearchDialog />
      </div>
    )
  }

  // ===== 展开状态：完整侧边栏 =====
  return (
    <div
      className="relative h-full flex flex-col bg-background rounded-2xl shadow-xl transition-[width] duration-300"
      style={{ width: width ?? 300, minWidth: 200, flexShrink: 1 }}
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

      {/* 新对话/新会话按钮 + 搜索按钮 */}
      <div className="px-3 pt-2 flex items-center gap-1.5">
        <button
          onClick={mode === 'agent' ? handleNewAgentSession : handleNewConversation}
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-medium text-foreground/70 bg-primary/5 hover:bg-primary/10 hover:text-foreground transition-[background-color,border-color,color] duration-150 titlebar-no-drag border border-border/60 hover:border-border"
        >
          <Plus size={14} />
          <span>{mode === 'agent' ? '新会话' : '新对话'}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSearchDialogOpen(true)}
              className="flex-shrink-0 size-[36px] flex items-center justify-center rounded-[10px] text-foreground/40 bg-primary/5 hover:bg-primary/10 hover:text-foreground/60 transition-[background-color,border-color,color] duration-150 titlebar-no-drag border border-border/60 hover:border-border"
            >
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">搜索 ({getAcceleratorDisplay(getActiveAccelerator('global-search'))})</TooltipContent>
        </Tooltip>
      </div>

      {/* 自动任务入口：作为任务中心入口放在置顶区上方，不参与置顶列表层级。 */}
      <div className="px-3 pt-2 pb-0.5">
        <AutomationSidebarEntry
          count={automationCount}
          active={activeView === 'automations'}
          onClick={handleOpenAutomations}
        />
      </div>

      {/* Agent 技能入口：Skills / MCP 能力中心，仅 Agent 模式可见 */}
      {mode === 'agent' && (
        <div className="px-3 pb-0.5">
          <SkillsSidebarEntry
            count={capabilities?.skills.length ?? 0}
            updateCount={capabilities?.skills.filter((s) => s.hasUpdate).length ?? 0}
            active={activeView === 'agent-skills'}
            onClick={handleOpenSkills}
          />
        </div>
      )}

      {/* Chat 模式 active 视图：置顶 + 对话历史，结构与 Agent active 视图保持一致 */}
      {mode === 'chat' && viewMode === 'active' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {pinnedConversations.length > 0 && (
            <div className="pt-2 pb-1 flex-shrink-0 titlebar-no-drag">
              <div className="px-3.5 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                置顶
              </div>
              <div
                className="overflow-y-auto scrollbar-thin"
                style={{ maxHeight: PINNED_SESSION_MAX_HEIGHT }}
              >
                <div className="px-2">
                  <div className="ml-4 flex flex-col gap-0.5">
                    {pinnedConversations.map((conv) => (
                      <ConversationItem
                        key={`pinned-${conv.id}`}
                        conversation={conv}
                        active={conv.id === activeSessionId}
                        streaming={streamingIds.has(conv.id)}
                        showPinIcon={false}
                        relativeTimeNow={relativeTimeNow}
                        onSelect={handleSelectConversation}
                        onRequestDelete={handleRequestDelete}
                        onRename={handleRename}
                        onTogglePin={handleTogglePin}
                        onToggleArchive={handleToggleArchive}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="px-2 pt-2 pb-1 flex-shrink-0">
            <span className="px-1.5 text-[11px] font-medium text-foreground/40 select-none">对话</span>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin min-h-0 titlebar-no-drag">
            {conversationGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-1.5 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      active={conv.id === activeSessionId}
                      streaming={streamingIds.has(conv.id)}
                      showPinIcon={!!conv.pinned}
                      relativeTimeNow={relativeTimeNow}
                      onSelect={handleSelectConversation}
                      onRequestDelete={handleRequestDelete}
                      onRename={handleRename}
                      onTogglePin={handleTogglePin}
                      onToggleArchive={handleToggleArchive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : mode === 'agent' && viewMode === 'active' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {pinnedAgentSessions.length > 0 && (
            <div className="pt-2 pb-1 flex-shrink-0 titlebar-no-drag">
              <div className="px-3.5 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                置顶
              </div>
              <div
                className="overflow-y-auto scrollbar-thin"
                style={{ maxHeight: PINNED_SESSION_MAX_HEIGHT }}
              >
                <div className="px-2">
                  <div className="ml-4 flex flex-col gap-0.5">
                    {pinnedAgentSessions.map((session) => (
                      <AgentSessionItem
                        key={`pinned-${session.id}`}
                        session={session}
                        active={session.id === activeSessionId}
                        indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                        showPinIcon={false}
                        leftAccent={getSessionLeftAccent(agentIndicatorMap.get(session.id) ?? 'idle')}
                        workspaceName={session.workspaceId ? workspaceNameMap.get(session.workspaceId) : undefined}
                        relativeTimeNow={relativeTimeNow}
                        onSelect={handleSelectAgentSession}
                        onRequestDelete={handleRequestDelete}
                        onRequestMove={handleRequestMove}
                        onRename={handleAgentRename}
                        onTogglePin={handleTogglePinAgent}
                        onToggleArchive={handleToggleArchiveAgent}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 下区标题：项目历史 */}
          <div className="px-2 pt-2 pb-1 flex items-center justify-between flex-shrink-0">
            <span className="px-1.5 text-[11px] font-medium text-foreground/40 select-none">项目</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleStartCreateProject}
                  className="size-6 flex items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/60 transition-colors titlebar-no-drag"
                  aria-label="新建项目"
                >
                  <Plus size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">新建项目</TooltipContent>
            </Tooltip>
          </div>

          {/* 下区：项目分组历史 */}
          <div className="flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin min-h-0 titlebar-no-drag">
            {creatingProject && (
              <div className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-md bg-foreground/[0.04]">
                <FolderOpen size={14} className="flex-shrink-0 text-foreground/40" />
                <input
                  ref={newProjectInputRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={handleCreateProjectKeyDown}
                  onBlur={() => {
                    setCreatingProject(false)
                    setNewProjectName('')
                  }}
                  placeholder="项目名称..."
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
                  maxLength={50}
                />
              </div>
            )}

            <div className="flex flex-col gap-0.5">
              {agentProjectGroups.map((group) => (
                <AgentProjectGroupItem
                  key={group.workspace.id}
                  group={group}
                  currentWorkspaceId={currentWorkspaceId}
                  expanded={(expandedExtraCountMap.get(group.workspace.id) ?? 0) > 0}
                  extraCount={expandedExtraCountMap.get(group.workspace.id) ?? 0}
                  collapsed={collapsedWorkspaceIds.has(group.workspace.id)}
                  activeSessionId={activeSessionId}
                  agentIndicatorMap={agentIndicatorMap}
                  relativeTimeNow={relativeTimeNow}
                  dragging={dragProjectId === group.workspace.id}
                  dropPosition={projectDropIndicator?.id === group.workspace.id ? projectDropIndicator.position : null}
                  onShowMore={handleShowMoreSessions}
                  onCollapseExtra={handleCollapseExtraSessions}
                  onSelectProject={handleSelectProject}
                  onNewSession={createAgentSessionInWorkspace}
                  onDragStart={handleProjectDragStart}
                  onDragOver={handleProjectDragOver}
                  onDragLeave={handleProjectDragLeave}
                  onDrop={handleProjectDrop}
                  onDragEnd={handleProjectDragEnd}
                  onConfigureProject={(workspaceId) => {
                    handleSelectProject(workspaceId)
                    setSettingsTab('agent')
                    setSettingsOpen(true)
                  }}
                  onRenameWorkspace={handleWorkspaceRename}
                  onRequestDeleteWorkspace={handleRequestDeleteWorkspace}
                  canDeleteWorkspace={canDeleteWorkspace(group.workspace)}
                  onSelectSession={handleSelectAgentSession}
                  onRequestDelete={handleRequestDelete}
                  onRequestMove={handleRequestMove}
                  onRename={handleAgentRename}
                  onTogglePin={handleTogglePinAgent}
                  onToggleArchive={handleToggleArchiveAgent}
                />
              ))}
            </div>
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

          {/* 归档视图：单列表布局 */}
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-thin titlebar-no-drag">
            {mode === 'chat' ? (
              /* Chat 归档：对话按日期分组 */
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
                        active={conv.id === activeSessionId}
                        streaming={streamingIds.has(conv.id)}
                        showPinIcon={!!conv.pinned}
                        relativeTimeNow={relativeTimeNow}
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
                        active={session.id === activeSessionId}
                        indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                        showPinIcon={!!session.pinned}
                        leftAccent={getSessionLeftAccent(agentIndicatorMap.get(session.id) ?? 'idle')}
                        workspaceName={session.workspaceId ? workspaceNameMap.get(session.workspaceId) : undefined}
                        relativeTimeNow={relativeTimeNow}
                        onSelect={handleSelectAgentSession}
                        onRequestDelete={handleRequestDelete}
                        onRequestMove={handleRequestMove}
                        onRename={handleAgentRename}
                        onTogglePin={handleTogglePinAgent}
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
      {projectDeleteDialog}
      {moveDialog}
      <SearchDialog />
    </div>
  )
}

// ===== 列表项操作按钮（时间/置顶/归档/三点菜单） =====

interface SessionItemActionsProps {
  updatedAt: number
  relativeTimeNow: number
  pinned: boolean
  archived: boolean
  onTogglePin: () => void
  onToggleArchive: () => void
  menuItems: (
    MenuItem: typeof DropdownMenuItem,
    MenuSeparator: typeof DropdownMenuSeparator,
  ) => React.ReactNode
  onMenuOpenChange?: (open: boolean) => void
}

/**
 * 安全 Tooltip：延迟渲染 Content，避开 Popper 初始定位 (0,0) 的闪现。
 *
 * 左侧列表项的操作按钮默认 hidden，hover 时才显示。Radix Popper 在 Content 首次挂载
 * 时若 trigger 尚未完成布局，会先把浮层放到视口左上角 (0,0)，再跳到正确位置。这里
 * 在 Radix 进入打开状态后，先让 Popper 有一小段时间完成定位，再真正渲染 Content；
 * 同时 trigger rect 为 0 时直接不打开。
 */
interface SafeTooltipProps {
  children: React.ReactElement
  content: React.ReactNode
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
}

function SafeTooltip({ children, content, side = 'top' }: SafeTooltipProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [showContent, setShowContent] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!nextOpen) {
      setOpen(false)
      setShowContent(false)
      return
    }

    // trigger 还没完成布局时不打开
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) {
      return
    }

    setOpen(true)
    // 先让 Radix 完成 Popper 定位，再渲染 Content，避免看到 (0,0) 初始位置。
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setShowContent(true)
    }, 60)
  }, [])

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild ref={triggerRef}>
        {children}
      </TooltipTrigger>
      {showContent && <TooltipContent side={side}>{content}</TooltipContent>}
    </Tooltip>
  )
}

/**
 * 列表项右侧操作区：默认显示相对更新时间，hover 时切换为「置顶 / 归档 / 三点菜单」按钮组。
 * 归档需要二次确认；进入确认态后强制保持按钮可见，避免鼠标移开后用户失去反馈。
 */
function SessionItemActions({
  updatedAt,
  relativeTimeNow,
  pinned,
  archived,
  onTogglePin,
  onToggleArchive,
  menuItems,
  onMenuOpenChange,
}: SessionItemActionsProps): React.ReactElement {
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  // 菜单打开时强制保持按钮组挂载且可见：否则鼠标移开后父级 group:hover 失效，
  // 外层包装变 display:none，Radix Popper 拿不到 trigger 的位置矩形（getBoundingClientRect 全是 0），
  // 浮层就漂到视口左上角 (0,0)。
  const [menuOpen, setMenuOpen] = React.useState(false)

  React.useEffect(() => {
    if (!archiveConfirming) return
    const timer = setTimeout(() => setArchiveConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [archiveConfirming])

  const handleArchiveClick = (): void => {
    if (archived) {
      onToggleArchive()
      return
    }
    if (archiveConfirming) {
      setArchiveConfirming(false)
      onToggleArchive()
      return
    }
    setArchiveConfirming(true)
  }

  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMenuOpenChange = (open: boolean): void => {
    if (open) {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setMenuOpen(true)
    } else {
      // Delay hiding the trigger so Radix Popper can still read its rect during the close animation (~150ms).
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        setMenuOpen(false)
      }, 200)
    }
    onMenuOpenChange?.(open)
  }

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const forceVisible = archiveConfirming || menuOpen

  return (
    <div
      className="flex-shrink-0 flex items-center h-[18px]"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        title={`最后更新：${new Date(updatedAt).toLocaleString('zh-CN')}`}
        className={cn(
          'min-w-[42px] text-right text-[11px] leading-[18px] tabular-nums text-foreground/35',
          forceVisible ? 'hidden' : 'group-hover:hidden',
        )}
      >
        {formatRelativeUpdatedAt(updatedAt, relativeTimeNow)}
      </span>
      <div
        className={cn(
          'items-center gap-0.5',
          forceVisible ? 'flex' : 'hidden group-hover:flex',
        )}
      >
        <SafeTooltip content={pinned ? '取消置顶' : '置顶'} side="top">
          <button
            className={cn(
              'p-0.5 rounded transition-colors',
              pinned
                ? 'text-primary/60 hover:bg-foreground/[0.08] hover:text-primary'
                : 'text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60',
            )}
            onClick={onTogglePin}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        </SafeTooltip>
        <SafeTooltip
          content={archiveConfirming ? '再次点击确认归档' : archived ? '取消归档' : '归档'}
          side="top"
        >
          <button
            className={cn(
              'p-0.5 rounded transition-colors',
              archiveConfirming
                ? 'text-destructive bg-destructive/10'
                : archived
                  ? 'text-foreground/60 hover:bg-foreground/[0.08]'
                  : 'text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60',
            )}
            onClick={handleArchiveClick}
          >
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        </SafeTooltip>
        <DropdownMenu onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'p-0.5 rounded text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60',
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
  relativeTimeNow: number
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
  relativeTimeNow,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)
  // 菜单打开时关闭迷你地图预览，避免预览面板盖住菜单项导致点不动
  const preview = useSessionMiniMapHover(600, menuOpen)

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
          ref={preview.setAnchorRef}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(conversation.id, conversation.title)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className={cn(
            'group relative w-full flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1.5 transition-colors duration-100 titlebar-no-drag text-left',
            active && 'session-item-selected',
            streaming
              ? 'text-foreground font-medium hover:bg-foreground/[0.03]'
              : 'hover:bg-foreground/[0.03]',
            active && 'bg-foreground/[0.08]',
          )}
        >
          {(streaming || active) && (
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-[3px] rounded-l-md pointer-events-none',
                streaming ? 'bg-blue-500 animate-pulse' : 'bg-primary',
              )}
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
                'truncate text-[13px] leading-[18px] flex items-center gap-1.5',
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

          {/* 默认显示时间，hover 时显示操作按钮 */}
          {!editing && (
            <SessionItemActions
              updatedAt={conversation.updatedAt}
              relativeTimeNow={relativeTimeNow}
              pinned={isPinned}
              archived={!!conversation.archived}
              onTogglePin={() => onTogglePin(conversation.id)}
              onToggleArchive={() => onToggleArchive(conversation.id)}
              onMenuOpenChange={setMenuOpen}
              menuItems={menuItems}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
      <SessionMiniMapPopover
        target={{
          type: 'chat',
          sessionId: conversation.id,
          title: conversation.title,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </ContextMenu>
  )
})

// ===== Agent 会话列表项 =====

/** 会话行左侧状态条的颜色 — 与 SessionIndicatorStatus 呼应 */
type SessionLeftAccent = 'orange' | 'blue' | 'green'
const SESSION_ACCENT_ROW_CLASS: Record<SessionLeftAccent, string> = {
  orange: 'bg-orange-500/[0.08] text-foreground font-medium',
  blue: 'text-foreground font-medium hover:bg-foreground/[0.03]',
  green: 'text-foreground font-medium hover:bg-foreground/[0.03]',
}

const SESSION_ACCENT_INDICATOR_CLASS: Record<SessionLeftAccent, string> = {
  orange: 'bg-orange-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
}

function getSessionLeftAccent(status: SessionIndicatorStatus): SessionLeftAccent | undefined {
  if (status === 'blocked') return 'orange'
  if (status === 'running') return 'blue'
  if (status === 'completed') return 'green'
  return undefined
}

interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  indicatorStatus: SessionIndicatorStatus
  showPinIcon?: boolean
  /** 行左侧状态色块；未传则不显示 */
  leftAccent?: SessionLeftAccent
  /** 是否禁用悬浮 Mini 地图 */
  disableMiniMap?: boolean
  /** 项目名称 Badge（跨项目列表时显示） */
  workspaceName?: string
  /** 用同一个时间戳刷新相对时间，避免每行独立计时 */
  relativeTimeNow: number
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const AgentSessionItem = React.memo(function AgentSessionItem({
  session,
  active,
  indicatorStatus,
  showPinIcon,
  leftAccent,
  disableMiniMap,
  workspaceName,
  relativeTimeNow,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleArchive,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)
  // 菜单打开时关闭迷你地图预览，避免预览面板盖住菜单项导致点不动
  const preview = useSessionMiniMapHover(600, disableMiniMap || menuOpen)

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
      {canMove && (
        <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onRequestMove(session.id)}>
          <ArrowRightLeft size={14} />
          迁移到其他项目
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
          ref={preview.setAnchorRef}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(session.id, session.title)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className={cn(
            'group relative w-full flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1.5 transition-colors duration-100 titlebar-no-drag text-left',
            active && 'agent-session-item-active',
            leftAccent
              ? SESSION_ACCENT_ROW_CLASS[leftAccent]
              : 'hover:bg-foreground/[0.03]',
            // 选中态背景：浅色叠加深色变深、深色叠加浅色变浅，自动适配主题。
            // orange accent 自带橙色底色，不再叠加，避免视觉过重。
            active && leftAccent !== 'orange' && 'bg-foreground/[0.08]',
          )}
        >
          {(leftAccent || active) && (
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-[3px] rounded-l-md pointer-events-none',
                leftAccent ? SESSION_ACCENT_INDICATOR_CLASS[leftAccent] : 'bg-primary',
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
                'truncate text-[13px] leading-[18px] flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                {session.sourceAutomationId && (
                  <Clock size={11} className="flex-shrink-0 text-foreground/40" />
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

          {!editing && (
            <SessionItemActions
              updatedAt={session.updatedAt}
              relativeTimeNow={relativeTimeNow}
              pinned={!!session.pinned}
              archived={!!session.archived}
              onTogglePin={() => onTogglePin(session.id)}
              onToggleArchive={() => onToggleArchive(session.id)}
              onMenuOpenChange={setMenuOpen}
              menuItems={menuItems}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
      {!disableMiniMap && (
        <SessionMiniMapPopover
          target={{
            type: 'agent',
            sessionId: session.id,
            title: session.title,
            workspaceName,
          }}
          anchorRef={preview.anchorRef}
          open={preview.isOpen}
          isLeaving={preview.isLeaving}
          onMouseEnter={preview.handlePanelMouseEnter}
          onMouseLeave={preview.handlePanelMouseLeave}
        />
      )}
    </ContextMenu>
  )
})

// ===== 项目分组历史 =====

interface AgentProjectGroupItemProps {
  group: AgentProjectGroup
  currentWorkspaceId: string | null
  expanded: boolean
  collapsed: boolean
  /** 用户已点击"显示更多"额外展开的会话数量（基于 collapsedSessions 之上累加） */
  extraCount: number
  activeSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  relativeTimeNow: number
  dragging: boolean
  dropPosition: 'before' | 'after' | null
  onShowMore: (workspaceId: string) => void
  onCollapseExtra: (workspaceId: string) => void
  onSelectProject: (workspaceId: string) => void
  onNewSession: (workspaceId: string) => Promise<void>
  onDragStart: (e: React.DragEvent, workspaceId: string) => void
  onDragOver: (e: React.DragEvent, workspaceId: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, workspaceId: string) => void
  onDragEnd: () => void
  onConfigureProject: (workspaceId: string) => void
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>
  onRequestDeleteWorkspace: (workspaceId: string) => void
  canDeleteWorkspace: boolean
  onSelectSession: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const AgentProjectGroupItem = React.memo(function AgentProjectGroupItem({
  group,
  currentWorkspaceId,
  expanded,
  collapsed,
  extraCount,
  activeSessionId,
  agentIndicatorMap,
  relativeTimeNow,
  dragging,
  dropPosition,
  onShowMore,
  onCollapseExtra,
  onSelectProject,
  onNewSession,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onConfigureProject,
  onRenameWorkspace,
  onRequestDeleteWorkspace,
  canDeleteWorkspace,
  onSelectSession,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleArchive,
}: AgentProjectGroupItemProps): React.ReactElement {
  const isCurrent = group.workspace.id === currentWorkspaceId

  const [renamingWorkspace, setRenamingWorkspace] = React.useState(false)
  const [workspaceEditName, setWorkspaceEditName] = React.useState('')
  const workspaceEditRef = React.useRef<HTMLInputElement>(null)
  const justStartedRenamingRef = React.useRef(false)

  const handleStartWorkspaceRename = (): void => {
    setWorkspaceEditName(group.workspace.name)
    setRenamingWorkspace(true)
    justStartedRenamingRef.current = true
    setTimeout(() => {
      justStartedRenamingRef.current = false
      workspaceEditRef.current?.focus()
      workspaceEditRef.current?.select()
    }, 300)
  }

  const handleWorkspaceRenameCommit = async (): Promise<void> => {
    if (justStartedRenamingRef.current) return
    const trimmed = workspaceEditName.trim()
    if (!trimmed || trimmed === group.workspace.name) {
      setRenamingWorkspace(false)
      return
    }
    await onRenameWorkspace(group.workspace.id, trimmed)
    setRenamingWorkspace(false)
  }

  const handleWorkspaceRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      void handleWorkspaceRenameCommit()
    } else if (e.key === 'Escape') {
      setRenamingWorkspace(false)
    }
  }
  const recentCutoff = relativeTimeNow - PROJECT_SESSION_RECENT_WINDOW_MS
  // 折叠时：所有"活跃"会话（运行中 / 阻塞 / 未查看的已完成）必须展示，
  // 不受 PROJECT_SESSION_PREVIEW_LIMIT 与 3 天窗口限制；活跃部分内部按
  // blocked > running > completed 优先级排序（与 railRecentItems 对齐），
  // 同优先级保留 group.sessions 的 updatedAt 倒序。
  // 非活跃部分仍保留原"最近 3 天 + 至多 5 条"预览策略，作为额外补充展示。
  // 用户点击"显示更多"会在折叠基线之上每次再额外展开 PROJECT_SESSION_EXPAND_STEP 条。
  const getStatus = (sessionId: string): SessionIndicatorStatus =>
    agentIndicatorMap.get(sessionId) ?? 'idle'
  const activeSessions = group.sessions
    .filter((session) => ACTIVE_SESSION_STATUSES.has(getStatus(session.id)))
    .slice()
    .sort((a, b) => {
      const delta = ACTIVE_SESSION_STATUS_PRIORITY[getStatus(a.id)]
        - ACTIVE_SESSION_STATUS_PRIORITY[getStatus(b.id)]
      if (delta !== 0) return delta
      return b.updatedAt - a.updatedAt
    })
  const activeIds = new Set(activeSessions.map((s) => s.id))
  const fillSessions = group.sessions
    .filter((session) => !activeIds.has(session.id) && session.updatedAt >= recentCutoff)
    .slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
  const collapsedSessions = [...activeSessions, ...fillSessions]
  const collapsedIds = new Set(collapsedSessions.map((s) => s.id))
  const remainingSessions = group.sessions.filter((s) => !collapsedIds.has(s.id))
  const extraSessions = remainingSessions.slice(0, extraCount)
  const sessions = [...collapsedSessions, ...extraSessions]
  const hiddenCount = Math.max(0, group.sessions.length - sessions.length)

  return (
    <section
      onDragOver={(e) => onDragOver(e, group.workspace.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, group.workspace.id)}
      onDragEnd={onDragEnd}
      className={cn('relative py-0.5 rounded-md transition-opacity', dragging && 'opacity-45')}
    >
      {dropPosition === 'before' && (
        <div className="absolute -top-0.5 left-3 right-3 h-0.5 rounded-full bg-primary z-10" />
      )}

      <div className="group/project relative flex items-center">
        <span
          draggable
          onDragStart={(e) => onDragStart(e, group.workspace.id)}
          title="拖拽排序"
          className="absolute -left-0.5 top-1/2 z-10 flex size-[18px] -translate-y-1/2 cursor-grab items-center justify-center text-foreground/20 opacity-0 transition-opacity group-hover/project:opacity-100 active:cursor-grabbing"
          aria-hidden="true"
        >
          <GripVertical size={12} />
        </span>

        {renamingWorkspace ? (
          <div
            className={cn(
              'relative flex-1 min-w-0 flex items-center gap-1 px-1 py-1 rounded-md text-left titlebar-no-drag group-hover/project:pl-4 group-hover/project:pr-11',
              isCurrent
                ? 'agent-project-item-current text-foreground'
                : 'text-foreground/65',
            )}
          >
            <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
            <input
              ref={workspaceEditRef}
              value={workspaceEditName}
              onChange={(e) => setWorkspaceEditName(e.target.value)}
              onKeyDown={handleWorkspaceRenameKeyDown}
              onBlur={() => void handleWorkspaceRenameCommit()}
              className="flex-1 min-w-0 bg-transparent text-[13px] font-medium text-foreground border-b border-primary/50 outline-none px-0.5 leading-[18px]"
              maxLength={50}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={`project-sessions-${group.workspace.id}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelectProject(group.workspace.id)
            }}
            className={cn(
              'relative flex-1 min-w-0 flex items-center gap-1 px-1 py-1 rounded-md text-left transition-[padding,color,background-color] titlebar-no-drag group-hover/project:pl-4 group-hover/project:pr-11 hover:bg-foreground/[0.025]',
              isCurrent
                ? 'agent-project-item-current text-foreground'
                : 'text-foreground/65 hover:text-foreground/88',
            )}
          >
            <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
            <span className="flex-1 min-w-0 truncate text-[13px] font-medium leading-[18px]">
              {group.workspace.name}
            </span>
            <ChevronRight
              size={12}
              className={cn(
                'flex-shrink-0 text-foreground/30 transition-transform duration-150',
                collapsed ? '-rotate-90' : 'rotate-90',
              )}
            />
          </button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`在「${group.workspace.name}」中新建会话`}
              onClick={(e) => {
                e.stopPropagation()
                void onNewSession(group.workspace.id)
              }}
              className="absolute right-5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/65 group-hover/project:opacity-100 titlebar-no-drag"
            >
              <Plus size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">在此项目中新建会话</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="项目菜单"
              className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/60 group-hover/project:opacity-100 data-[state=open]:opacity-100 titlebar-no-drag"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 z-[9999] min-w-0 p-0.5">
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={() => onSelectProject(group.workspace.id)}
            >
              <FolderOpen size={14} />
              设为当前项目
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={handleStartWorkspaceRename}
            >
              <Pencil size={14} />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={() => onConfigureProject(group.workspace.id)}
            >
              <Settings size={14} />
              配置 MCP 与 Skills
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-0.5" />
            <DropdownMenuItem
              disabled={!canDeleteWorkspace}
              className={cn(
                'text-xs py-1 [&>svg]:size-3.5',
                canDeleteWorkspace && 'text-destructive focus:text-destructive',
              )}
              onSelect={() => onRequestDeleteWorkspace(group.workspace.id)}
            >
              <Trash2 size={14} />
              删除项目
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div id={`project-sessions-${group.workspace.id}`} className="ml-4 mt-px">
        {!collapsed ? (
          group.sessions.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <AgentSessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeSessionId}
                  indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
                  showPinIcon={!!session.pinned}
                  leftAccent={getSessionLeftAccent(agentIndicatorMap.get(session.id) ?? 'idle')}
                  relativeTimeNow={relativeTimeNow}
                  onSelect={onSelectSession}
                  onRequestDelete={onRequestDelete}
                  onRequestMove={onRequestMove}
                  onRename={onRename}
                  onTogglePin={onTogglePin}
                  onToggleArchive={onToggleArchive}
                />
              ))}

              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => onShowMore(group.workspace.id)}
                  className="w-full text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                >
                  显示更多
                </button>
              )}

              {expanded && (
                <button
                  type="button"
                  onClick={() => onCollapseExtra(group.workspace.id)}
                  className="w-full text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                >
                  收起
                </button>
              )}
            </div>
          ) : (
            <div className="px-1.5 py-0.5 text-[12px] text-foreground/22 select-none">
              暂无会话
            </div>
          )
        ) : null}
      </div>
      {dropPosition === 'after' && (
        <div className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-primary z-10" />
      )}
    </section>
  )
})
