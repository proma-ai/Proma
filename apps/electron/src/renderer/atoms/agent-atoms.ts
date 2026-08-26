/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import type { Getter } from 'jotai'
import { atomFamily, atomWithStorage, selectAtom } from 'jotai/utils'
import type { AgentSessionMeta, AgentEvent, AgentWorkspace, AgentPendingFile, RetryAttempt, PromaPermissionMode, PermissionRequest, AskUserRequest, ExitPlanModeRequest, ThinkingConfig, AgentEffort, SDKMessage, UnstagedChangesResult } from '@proma/shared'
import { PROMA_DEFAULT_PERMISSION_MODE } from '@proma/shared'
import { calculateDockBadgeCount, countPendingRequests } from '@/lib/dock-badge-count'
import type { AgentQueuedMessage } from '@/lib/agent-message-queue'
import type { SessionFileChange } from '@/lib/session-file-changes'

/** 活动状态 */
export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'

/** 工具活动状态 */
export interface ToolActivity {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  intent?: string
  displayName?: string
  result?: string
  isError?: boolean
  done: boolean
  parentToolUseId?: string
  elapsedSeconds?: number
  taskId?: string
  shellId?: string
  isBackground?: boolean
  /** MCP 工具返回的图片附件 */
  imageAttachments?: Array<{ localPath: string; filename: string; mediaType: string }>
}

/** 活动分组（Task 子代理） */
export interface ActivityGroup {
  parent: ToolActivity
  children: ToolActivity[]
}

export interface ContextCompactionState {
  status: 'running' | 'success' | 'noop' | 'failed'
  /** 主任务已收到成功的 agent_end，当前仅在收尾整理上下文。 */
  afterCompletedTurn?: boolean
  summary?: string
  message?: string
}

/** 用户可见的 retry 生命周期。 */
export type RetryPhase = 'scheduled' | 'running' | 'succeeded' | 'exhausted' | 'cancelled'

/** 单个流式 run 的 retry 状态。 */
export interface AgentRetryState {
  /** 用渲染进程创建的 startedAt 隔离迟到事件。 */
  runStartedAt?: number
  /** 当前 retry 所处阶段。 */
  phase: RetryPhase
  /** 当前第几次 retry（不含初始请求）。 */
  currentAttempt: number
  /** 当前连续失败段的 retry 上限。 */
  maxAttempts: number
  /** 当前顶层 run 已调度的 retry 数。 */
  totalAttempt?: number
  /** 当前顶层 run 的 retry 总预算。 */
  maxTotalAttempts?: number
  /** 已实际开始的 retry 历史，按 attempt upsert，不记录“仅安排”的次数。 */
  history: RetryAttempt[]
  /** retry 被安排的时间，用于 backoff 倒计时。 */
  scheduledAt?: number
  /** 当前安排的 backoff 时长。 */
  delaySeconds?: number
  /** 当前或最后一次失败原因。 */
  reason?: string
}

/** Agent 会话的流式状态 */
export interface AgentStreamState {
  running: boolean
  /**
   * 后台任务等待态（软空闲）：本轮主体已结束、UI 可输入，但 SDK 通道仍开着等后台任务唤醒。
   * 此状态下 running 为 false，但服务端 activeSessions 仍保留，新消息必须走注入通道而非新建 run。
   */
  backgroundWaiting?: boolean
  model?: string
  /** 当前输入 token 数（上下文使用量） */
  inputTokens?: number
  /** 输出 token 数 */
  outputTokens?: number
  /** 缓存读取 token 数 */
  cacheReadTokens?: number
  /** 缓存写入 token 数 */
  cacheCreationTokens?: number
  /** 费用（美元） */
  costUsd?: number
  /** 模型上下文窗口大小 */
  contextWindow?: number
  /** 当前上下文 token 是 Pi 手动压缩后的预估值 */
  contextUsageIsEstimated?: boolean
  /** 当前 thinking block 的 token 估算值（SDK 实时估算，非计费值） */
  thinkingEstimatedTokens?: number
  /** 是否正在压缩上下文 */
  isCompacting?: boolean
  /** 当前或最近一次压缩状态，保留到实时消息清理或同一流恢复正常工作后供底部进度区展示。 */
  contextCompaction?: ContextCompactionState
  /**
   * 压缩流程是否进行中（含收尾窗口）。
   * 从用户点击压缩 / SDK compacting 事件开始；若同一流在压缩后恢复正常工作则立即清除，
   * 否则保留到整个 stream 结束（state 被删除）。用于抑制压缩分隔符切换期间 AgentRunningIndicator 的短暂闪烁。
   */
  compactInFlight?: boolean
  /** 流式开始时间戳（用于思考计时持久化） */
  startedAt?: number
  /** 重试状态 */
  retrying?: AgentRetryState
}

/**
 * 成功或无需压缩后，Pi 可能在同一个 stream 内自动续跑原任务。
 * 一旦收到新的正常 Agent 活动，终态压缩提示不应继续抢占底部进度区。
 */
function clearFinishedCompactionForResumedWork(prev: AgentStreamState): AgentStreamState {
  const status = prev.contextCompaction?.status
  if (status !== 'success' && status !== 'noop') return prev
  return {
    ...prev,
    compactInFlight: false,
    contextCompaction: undefined,
  }
}

export function resumeAgentStreamState(prev: AgentStreamState): AgentStreamState {
  const resumed = clearFinishedCompactionForResumedWork(prev)
  return resumed.retrying === undefined ? resumed : { ...resumed, retrying: undefined }
}

/** 从 ToolActivity 派生状态 */
export function getActivityStatus(activity: ToolActivity): ActivityStatus {
  if (activity.isBackground) return 'backgrounded'
  if (!activity.done) return 'running'
  if (activity.isError) return 'error'
  return 'completed'
}

interface RetryEventRunScope {
  runStartedAt?: number
}

/**
 * 仅接受属于当前流式 run 的 retry 事件；旧版无 run 标识的事件保留兼容。
 * 带 run 标识的事件必须精确匹配，避免旧 IPC 事件在 state 缺失时复活已结束的流。
 */
export function isRetryEventForCurrentStream(
  state: Pick<AgentStreamState, 'startedAt'>,
  event: RetryEventRunScope,
): boolean {
  return event.runStartedAt == null || event.runStartedAt === state.startedAt
}

function upsertRetryAttempt(history: RetryAttempt[], attempt: RetryAttempt): RetryAttempt[] {
  const index = history.findIndex((item) => item.attempt === attempt.attempt)
  if (index === -1) return [...history, attempt]
  return history.map((item, itemIndex) => (
    itemIndex === index
      // 终态会带着最终错误更新同一 retry；保留真正开始请求时的时间和 backoff。
      ? { ...item, ...attempt, timestamp: item.timestamp, delaySeconds: item.delaySeconds }
      : item
  ))
}

/**
 * 合并同层 TodoWrite 活动：多次调用只保留最新 input，置底显示
 *
 * TodoWrite 每次调用都包含完整的 todo 列表，只需展示最新状态。
 */
function mergeTodoWrites(activities: ToolActivity[]): ToolActivity[] {
  const todoWrites: ToolActivity[] = []
  const others: ToolActivity[] = []

  for (const a of activities) {
    if (a.toolName === 'TodoWrite') {
      todoWrites.push(a)
    } else {
      others.push(a)
    }
  }

  if (todoWrites.length === 0) return activities

  const latest = todoWrites[todoWrites.length - 1]!
  const allDone = todoWrites.every((t) => t.done)

  const merged: ToolActivity = {
    ...latest,
    done: allDone,
    isError: allDone && todoWrites.some((t) => t.isError),
  }

  return [...others, merged]
}

/**
 * 将扁平活动列表按 parentToolUseId 分组
 *
 * 返回顶层项（ActivityGroup | ToolActivity），
 * Task 类型的工具作为 group.parent，其子活动嵌套在 children 中。
 * 每层内 TodoWrite 合并去重并置底。
 */
export function groupActivities(activities: ToolActivity[]): Array<ActivityGroup | ToolActivity> {
  // 过滤幽灵条目：tool_progress 创建的空 input 条目，完成后仍无内容
  const filtered = activities.filter((a) => {
    if (a.done && Object.keys(a.input).length === 0 && !a.result) return false
    return true
  })
  const processed = mergeTodoWrites(filtered)

  const parentIds = new Set<string>()
  for (const a of processed) {
    if (a.toolName === 'Task' || a.toolName === 'Agent') parentIds.add(a.toolUseId)
  }

  const childrenMap = new Map<string, ToolActivity[]>()
  const topLevel: Array<ActivityGroup | ToolActivity> = []

  for (const a of processed) {
    if (a.parentToolUseId && parentIds.has(a.parentToolUseId)) {
      const children = childrenMap.get(a.parentToolUseId) ?? []
      children.push(a)
      childrenMap.set(a.parentToolUseId, children)
    } else {
      topLevel.push(a)
    }
  }

  return topLevel.map((item) => {
    if ('toolUseId' in item && parentIds.has(item.toolUseId)) {
      const children = childrenMap.get(item.toolUseId) ?? []
      return { parent: item, children: mergeTodoWrites(children) } as ActivityGroup
    }
    return item
  })
}

/** 判断是否为 ActivityGroup */
export function isActivityGroup(item: ActivityGroup | ToolActivity): item is ActivityGroup {
  return 'parent' in item && 'children' in item
}


/** 待自动发送的 Agent 提示（从设置页"对话完成配置"触发） */
export interface AgentPendingPrompt {
  sessionId: string
  message: string
  additionalDirectories?: string[]
  /** 自动发送时注入的 Todo 引用，确保 Agent 读取最新记录而非仅依赖提示文本。 */
  mentionedTodoIds?: string[]
}

// ===== Atoms =====

export const agentSessionsAtom = atom<AgentSessionMeta[]>([])
export const agentWorkspacesAtom = atom<AgentWorkspace[]>([])
export const currentAgentWorkspaceIdAtom = atom<string | null>(null)
/** 侧栏「自动任务」合成项目组在项目列表中的位置索引（默认 0 = 最靠前；从 settings.json 加载） */
export const automationGroupOrderAtom = atom<number>(0)
/** 全局默认渠道 ID（新会话继承用，从 settings.json 加载） */
export const agentChannelIdAtom = atom<string | null>(null)
/** 全局默认模型 ID（新会话继承用，从 settings.json 加载） */
export const agentModelIdAtom = atom<string | null>(null)
/** Per-session 渠道 ID Map — sessionId → channelId */
export const agentSessionChannelMapAtom = atom<Map<string, string>>(new Map())
/** Per-session 模型 ID Map — sessionId → modelId */
export const agentSessionModelMapAtom = atom<Map<string, string>>(new Map())
export const currentAgentSessionIdAtom = atom<string | null>(null)

/**
 * Agent 流式状态的 session 索引与实际存储。
 *
 * 高频事件直接写入 family，避免每次 token/tool 状态更新都复制完整的 session Map。
 * 聚合 atom 仅作为低频汇总和旧调用方兼容入口保留。
 */
const agentStreamingStateIdsAtom = atom<Set<string>>(new Set<string>())
const agentStreamingStateStorageAtomFamily = atomFamily((sessionId: string) =>
  atom<AgentStreamState | undefined>(undefined),
)

export const agentSessionStreamingStateAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(agentStreamingStateStorageAtomFamily(sessionId)),
    (
      get,
      set,
      update: AgentStreamState | undefined | ((prev: AgentStreamState | undefined) => AgentStreamState | undefined),
    ) => {
      const previous = get(agentStreamingStateStorageAtomFamily(sessionId))
      const next = typeof update === 'function' ? update(previous) : update
      if (Object.is(previous, next)) return

      set(agentStreamingStateStorageAtomFamily(sessionId), next)
      set(agentStreamingStateIdsAtom, (prev: Set<string>) => {
        if (next !== undefined) {
          if (prev.has(sessionId)) return prev
          const ids = new Set(prev)
          ids.add(sessionId)
          return ids
        }
        if (!prev.has(sessionId)) return prev
        const ids = new Set(prev)
        ids.delete(sessionId)
        return ids
      })
    },
  ),
)

function readAgentStreamingStates(get: Getter): Map<string, AgentStreamState> {
  const states = new Map<string, AgentStreamState>()
  for (const sessionId of get(agentStreamingStateIdsAtom)) {
    const state = get(agentSessionStreamingStateAtomFamily(sessionId))
    if (state) states.set(sessionId, state)
  }
  return states
}

/**
 * 兼容旧调用方的聚合视图。高频路径不要写入此 atom，请使用
 * agentSessionStreamingStateAtomFamily(sessionId)。
 */
export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>, [Map<string, AgentStreamState> | ((prev: Map<string, AgentStreamState>) => Map<string, AgentStreamState>)], void>(
  (get) => readAgentStreamingStates(get),
  (get, set, update) => {
    const previous = readAgentStreamingStates(get)
    const next = typeof update === 'function' ? update(previous) : update
    const sessionIds = new Set([...previous.keys(), ...next.keys()])
    for (const sessionId of sessionIds) {
      const previousState = previous.get(sessionId)
      const nextState = next.get(sessionId)
      if (Object.is(previousState, nextState)) continue
      set(agentSessionStreamingStateAtomFamily(sessionId), nextState)
    }
  },
)

/** AgentView 输入区/工具栏需要的低频流状态。 */
export type AgentViewStreamState = Pick<
  AgentStreamState,
  | 'running'
  | 'backgroundWaiting'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheCreationTokens'
  | 'contextWindow'
  | 'contextUsageIsEstimated'
  | 'isCompacting'
>

const EMPTY_AGENT_VIEW_STREAM_STATE: AgentViewStreamState = { running: false }

export function areAgentViewStreamStatesEqual(
  previous: AgentViewStreamState,
  next: AgentViewStreamState,
): boolean {
  return previous.running === next.running
    && previous.backgroundWaiting === next.backgroundWaiting
    && previous.inputTokens === next.inputTokens
    && previous.outputTokens === next.outputTokens
    && previous.cacheReadTokens === next.cacheReadTokens
    && previous.cacheCreationTokens === next.cacheCreationTokens
    && previous.contextWindow === next.contextWindow
    && previous.contextUsageIsEstimated === next.contextUsageIsEstimated
    && previous.isCompacting === next.isCompacting
}

export const agentSessionViewStreamStateAtomFamily = atomFamily((sessionId: string) =>
  selectAtom(
    agentSessionStreamingStateAtomFamily(sessionId),
    (state): AgentViewStreamState => state ?? EMPTY_AGENT_VIEW_STREAM_STATE,
    areAgentViewStreamStatesEqual,
  ),
)

/**
 * AgentView 输入区/工具栏只订阅运行生命周期，usage 数据由 ContextUsageBadge 独立消费。
 */
export type AgentInputStreamState = Pick<AgentStreamState, 'running' | 'backgroundWaiting'>

const EMPTY_AGENT_INPUT_STREAM_STATE: AgentInputStreamState = { running: false }

export function areAgentInputStreamStatesEqual(
  previous: AgentInputStreamState,
  next: AgentInputStreamState,
): boolean {
  return previous.running === next.running
    && previous.backgroundWaiting === next.backgroundWaiting
}

/** 输入区只订阅发送/排队需要的生命周期状态，避免 usage_update 触发整页重渲染。 */
export const agentSessionInputStreamStateAtomFamily = atomFamily((sessionId: string) =>
  selectAtom(
    agentSessionStreamingStateAtomFamily(sessionId),
    (state): AgentInputStreamState => state ?? EMPTY_AGENT_INPUT_STREAM_STATE,
    areAgentInputStreamStatesEqual,
  ),
)

/**
 * 实时 SDKMessage 累积 Map — Phase 2 新增
 *
 * 流式期间每条 SDKMessage 直接追加，供新 UI 渲染。
 * 流式完成后清空（持久化消息从 JSONL 加载）。
 */
export const liveMessagesMapAtom = atom<Map<string, SDKMessage[]>>(new Map())

const EMPTY_LIVE_SDK_MESSAGES: SDKMessage[] = []

/** 单个 session 的实时消息切片；其他 session 流式更新不唤醒当前历史区。 */
export const agentLiveMessagesAtomFamily = atomFamily((sessionId: string) =>
  atom((get) => get(liveMessagesMapAtom).get(sessionId) ?? EMPTY_LIVE_SDK_MESSAGES),
)

export const agentPendingPromptAtom = atom<AgentPendingPrompt | null>(null)

/**
 * Agent 待发送文件列表 Map — 以 sessionId 为 key
 * 切换会话时保留各 session 自己的 pending files，与文字草稿语义一致
 */
export const agentSessionPendingFilesAtom = atom<Map<string, AgentPendingFile[]>>(new Map())

/**
 * 单个 session 的 pending files 派生 atom（读写）— 按 sessionId 切片
 * read：返回当前 session 的数组（空数组兜底）
 * write：接受新数组或 updater 函数，写回时空数组转为 delete，避免 Map 长期残留空 entry
 */
export const agentPendingFilesAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(agentSessionPendingFilesAtom).get(sessionId) ?? [],
    (_get, set, update: AgentPendingFile[] | ((prev: AgentPendingFile[]) => AgentPendingFile[])) => {
      set(agentSessionPendingFilesAtom, (prev) => {
        const current = prev.get(sessionId) ?? []
        const next = typeof update === 'function' ? update(current) : update
        const map = new Map(prev)
        if (next.length === 0) {
          map.delete(sessionId)
        } else {
          map.set(sessionId, next)
        }
        return map
      })
    },
  ),
)

/**
 * Agent 运行中待发送消息队列 Map — 以 sessionId 为 key。
 * 队列只保存在渲染进程内存中，避免跨重启恢复时误把过期上下文继续发送。
 */
export const agentSessionMessageQueueAtom = atom<Map<string, AgentQueuedMessage[]>>(new Map())

/**
 * 单个 session 的队列派生 atom（读写）。
 * 空队列写回时删除 Map entry，避免长时间使用后残留空数组。
 */
export const agentMessageQueueAtomFamily = atomFamily((sessionId: string) =>
  atom(
    (get) => get(agentSessionMessageQueueAtom).get(sessionId) ?? [],
    (_get, set, update: AgentQueuedMessage[] | ((prev: AgentQueuedMessage[]) => AgentQueuedMessage[])) => {
      set(agentSessionMessageQueueAtom, (prev) => {
        const current = prev.get(sessionId) ?? []
        const next = typeof update === 'function' ? update(current) : update
        const map = new Map(prev)
        if (next.length === 0) {
          map.delete(sessionId)
        } else {
          map.set(sessionId, next)
        }
        return map
      })
    },
  ),
)

/** 工作区能力版本号 — 每次修改 MCP/Skills 后自增，触发侧边栏重新获取 */
export const workspaceCapabilitiesVersionAtom = atom(0)

/** 工作区文件版本号 — 文件变化时自增，触发文件浏览器重新加载 */
export const workspaceFilesVersionAtom = atom(0)

/** Git watcher 触发的全局 Diff 刷新版本，避免按历史会话批量更新 Map。 */
export const workspaceGitDiffRefreshVersionAtom = atom(0)

// ===== 侧面板 Atoms =====

/** 侧面板是否打开：按 Agent 会话持久化，未存储的会话默认打开。 */
export const agentSidePanelOpenMapAtom = atomWithStorage<Record<string, boolean>>(
  'proma-agent-sidepanel-open-by-session',
  {},
  undefined,
  { getOnInit: true },
)

/** 指定 Agent 会话的侧面板开关。 */
export const agentSidePanelOpenAtomFamily = atomFamily((sessionId: string) => atom(
  (get) => get(agentSidePanelOpenMapAtom)[sessionId] ?? true,
  (_get, set, isOpen: boolean) => {
    set(agentSidePanelOpenMapAtom, (previous) => ({ ...previous, [sessionId]: isOpen }))
  },
))

const DEFAULT_AGENT_SIDE_PANEL_WIDTH = 460

/**
 * 旧版全局宽度只作为尚未保存新布局的 Session 的初始基线，避免升级后尺寸回退。
 * 新布局写入后不再与其他 Session 共享。
 */
const legacyAgentSidePanelWidthAtom = atomWithStorage<number>(
  'proma-agent-workspace-width',
  DEFAULT_AGENT_SIDE_PANEL_WIDTH,
)

export interface AgentSidePanelLayout {
  width: number
  hasOpenedWideWorkspace: boolean
  widePanelWidthOverride: number | null
}

export const MAX_PERSISTED_AGENT_SIDE_PANEL_LAYOUTS = 50

/**
 * 仅保留最近活动的 Session 布局，防止 localStorage 随历史会话无限增长。
 * 会话元数据可用时按 updatedAt 排序；冷启动尚未加载元数据时按存储顺序兜底。
 * 正在写入的 Session 始终保留，即使其元数据尚未更新。
 */
export function pruneAgentSidePanelLayouts(
  layouts: Record<string, AgentSidePanelLayout>,
  sessions: readonly AgentSessionMeta[],
  activeSessionId?: string,
): Record<string, AgentSidePanelLayout> {
  const layoutIds = Object.keys(layouts)
  const recentSessionIds = sessions.length === 0
    ? layoutIds.slice(-MAX_PERSISTED_AGENT_SIDE_PANEL_LAYOUTS)
    : sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_PERSISTED_AGENT_SIDE_PANEL_LAYOUTS)
      .map((session) => session.id)
  const retainedIds = new Set(recentSessionIds)

  if (activeSessionId && !retainedIds.has(activeSessionId)) {
    if (retainedIds.size === MAX_PERSISTED_AGENT_SIDE_PANEL_LAYOUTS) {
      const oldestRetainedId = sessions.length === 0
        ? recentSessionIds[0]
        : recentSessionIds.at(-1)
      retainedIds.delete(oldestRetainedId!)
    }
    retainedIds.add(activeSessionId)
  }

  const entries = Object.entries(layouts).filter(([sessionId]) => retainedIds.has(sessionId))
  if (entries.length === layoutIds.length) return layouts
  return Object.fromEntries(entries)
}

/** 右侧工作区布局：按 Agent Session 持久化，包含普通与宽视图的尺寸。 */
export const agentSidePanelLayoutMapAtom = atomWithStorage<Record<string, AgentSidePanelLayout>>(
  'proma-agent-workspace-layout-by-session',
  {},
  undefined,
  { getOnInit: true },
)

/** 指定 Agent Session 的右侧工作区布局。 */
export const agentSidePanelLayoutAtomFamily = atomFamily((sessionId: string) => atom(
  (get) => get(agentSidePanelLayoutMapAtom)[sessionId] ?? {
    width: get(legacyAgentSidePanelWidthAtom),
    hasOpenedWideWorkspace: false,
    widePanelWidthOverride: null,
  },
  (get, set, update: AgentSidePanelLayout | ((previous: AgentSidePanelLayout) => AgentSidePanelLayout)) => {
    set(agentSidePanelLayoutMapAtom, (previous) => {
      const current = previous[sessionId] ?? {
        width: get(legacyAgentSidePanelWidthAtom),
        hasOpenedWideWorkspace: false,
        widePanelWidthOverride: null,
      }
      const next = typeof update === 'function' ? update(current) : update
      const nextLayouts = { ...previous, [sessionId]: next }
      return Object.keys(nextLayouts).length > MAX_PERSISTED_AGENT_SIDE_PANEL_LAYOUTS
        ? pruneAgentSidePanelLayouts(nextLayouts, get(agentSessionsAtom), sessionId)
        : nextLayouts
    })
  },
))

/** 文件来源选择：按会话持久化，未存储的会话默认显示会话文件。 */
export type AgentFileSourceFilter = 'session' | 'project'
export const agentFileSourceFilterMapAtom = atomWithStorage<Record<string, AgentFileSourceFilter>>(
  'proma-agent-file-source-filter-map',
  {},
  undefined,
  { getOnInit: true },
)

/**
 * 工作区级组件：内容归属项目而非单个会话，但在当前会话的右侧工作区中呈现。
 * 同一项目下的打开状态跨会话保留；关闭一个组件不会影响其他项目。
 */
export type WorkspaceComponentTab = 'todos' | 'calendar' | 'automations' | 'skills' | 'mcp' | 'memory'
export const WORKSPACE_COMPONENT_TABS: readonly WorkspaceComponentTab[] = ['todos', 'calendar', 'automations', 'skills', 'mcp', 'memory']

export function isWorkspaceComponentTab(tab: AgentSidePanelTab | string): tab is WorkspaceComponentTab {
  return (WORKSPACE_COMPONENT_TABS as readonly string[]).includes(tab)
}

/** 过滤旧版本或异常持久化数据，避免未知组件渲染成空的右侧 Tab。 */
export function sanitizeWorkspaceComponentTabs(tabs: readonly string[]): WorkspaceComponentTab[] {
  return tabs.every(isWorkspaceComponentTab)
    ? tabs as WorkspaceComponentTab[]
    : tabs.filter(isWorkspaceComponentTab)
}

/** 协作子 Agent 尚未提供标题时仍需有可见的 Tab 标签。 */
export function getDelegationTabLabel(title: string | null | undefined): string {
  return title?.trim() || '委派任务'
}

export type AgentSidePanelBaseTab = 'files' | 'changes' | 'chat' | 'temporary-agent' | WorkspaceComponentTab
/** 工作区组件、每个 Pi 探索分支、协作子 Agent、浏览器网页和文件预览都处于右侧工作区顶栏。 */
export type AgentSidePanelTab = AgentSidePanelBaseTab | `exploration:${string}` | `delegation:${string}` | `browser:${string}` | `preview:${string}` | `terminal:${string}`

/** 用户主动进入这些项目级能力时，Agent 后续的改动提示不得抢走当前视图。 */
export function isUserPriorityWorkspaceComponentTab(
  tab: AgentSidePanelTab | 'browser' | 'preview' | undefined,
): tab is Extract<WorkspaceComponentTab, 'skills' | 'memory'> {
  return tab === 'skills' || tab === 'memory'
}

/** Pi `/tree` 探索分支在右侧工作区的展示信息。 */
export interface AgentExplorationBranchTab {
  /** Pi 原生 fork 生成的独立 Proma session。 */
  sessionId: string
  /** 作为分叉锚点的 Proma assistant message UUID。 */
  sourceMessageId: string
  /** 给用户看的分叉来源。 */
  sourceLabel: string
}

/**
 * 右侧探索分支：key 为主线 Agent sessionId，value 为从其 Pi session tree 分叉出的已打开分支。
 * 仅管理右侧展示；branch artifact 本身持久化在普通 Agent session 中，关闭 Tab 不会删除它。
 */
export const agentSideTemporaryAgentMapAtom = atom<Map<string, AgentExplorationBranchTab[]>>(new Map())

export function getExplorationSidePanelTab(branchSessionId: string): AgentSidePanelTab {
  return `exploration:${branchSessionId}`
}

/** 已在右侧打开的协作子 Agent：key 为父会话 ID，value 为子会话 ID 列表。 */
export const agentSideDelegationMapAtom = atom<Map<string, string[]>>(new Map())

export function getDelegationSidePanelTab(childSessionId: string): AgentSidePanelTab {
  return `delegation:${childSessionId}`
}

export function getDelegationSessionIdFromSidePanelTab(tab: AgentSidePanelTab | 'delegation'): string | null {
  return tab.startsWith('delegation:') ? tab.slice('delegation:'.length) : null
}

export function isDelegationSidePanelTab(tab: AgentSidePanelTab | 'delegation'): tab is `delegation:${string}` {
  return tab.startsWith('delegation:')
}

export function getExplorationSessionIdFromSidePanelTab(tab: AgentSidePanelTab | 'exploration'): string | null {
  return tab.startsWith('exploration:') ? tab.slice('exploration:'.length) : null
}

export function isExplorationSidePanelTab(tab: AgentSidePanelTab | 'exploration'): tab is `exploration:${string}` {
  return tab.startsWith('exploration:')
}

export function getBrowserSidePanelTab(tabId: string): AgentSidePanelTab {
  return `browser:${tabId}`
}

export function getBrowserTabIdFromSidePanelTab(tab: AgentSidePanelTab | 'browser'): string | null {
  return tab.startsWith('browser:') ? tab.slice('browser:'.length) : null
}

export function isBrowserSidePanelTab(tab: AgentSidePanelTab | 'browser' | 'preview'): tab is `browser:${string}` {
  return tab.startsWith('browser:')
}

export function getPreviewSidePanelTab(previewId: string): AgentSidePanelTab {
  return `preview:${previewId}`
}

export function getPreviewIdFromSidePanelTab(tab: AgentSidePanelTab | 'preview'): string | null {
  return tab.startsWith('preview:') ? tab.slice('preview:'.length) : null
}

/** 终端仅在本次应用运行期存在，按 Agent 会话归属右侧工作区。 */
export interface AgentTerminalTab {
  terminalId: string
  title: string
  /** 用户从 Worktree 入口打开时，终端固定在对应根目录。 */
  cwd?: string
}

export const agentTerminalTabsAtom = atom<Map<string, AgentTerminalTab[]>>(new Map())

export function getTerminalSidePanelTab(terminalId: string): AgentSidePanelTab {
  return `terminal:${terminalId}`
}

export function getTerminalIdFromSidePanelTab(tab: AgentSidePanelTab | 'terminal'): string | null {
  return tab.startsWith('terminal:') ? tab.slice('terminal:'.length) : null
}

/** 当前会话的侧面板是否打开，并将写入定向到当前会话。 */
export const currentSessionSidePanelOpenAtom = atom(
  (get) => {
    const currentId = get(currentAgentSessionIdAtom)
    return currentId ? get(agentSidePanelOpenAtomFamily(currentId)) : false
  },
  (get, set, isOpen: boolean) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (currentId) set(agentSidePanelOpenAtomFamily(currentId), isOpen)
  },
)

/**
 * 项目级能力的右侧 Tab 打开状态按 Agent session 持久化。能力的数据仍归属于 workspace，
 * 但同一 workspace 的后台会话不得改变彼此的右侧 Tab，避免抢走用户焦点。
 */
export const agentSessionComponentOpenMapAtom = atomWithStorage<Record<string, WorkspaceComponentTab[]>>(
  'proma-agent-session-component-tabs',
  {},
  undefined,
  { getOnInit: true },
)

export const agentSessionComponentTabsAtomFamily = atomFamily((sessionId: string) => atom(
  (get) => get(agentSessionComponentOpenMapAtom)[sessionId] ?? [],
  (_get, set, update: WorkspaceComponentTab[] | ((previous: WorkspaceComponentTab[]) => WorkspaceComponentTab[])) => {
    set(agentSessionComponentOpenMapAtom, (previous) => {
      const current = previous[sessionId] ?? []
      const next = typeof update === 'function' ? update(current) : update
      if (next === current) return previous
      return { ...previous, [sessionId]: next }
    })
  },
))

/** 侧面板当前工作区：基础视图或某个浏览器网页（per-session Map）。 */
export const agentDiffPanelTabAtom = atom<Map<string, AgentSidePanelTab | 'browser' | 'preview'>>(new Map())

/** 在当前 Agent 会话中打开并聚焦一个项目级组件。 */
export const openWorkspaceComponentAtom = atom(
  null,
  (get, set, component: WorkspaceComponentTab) => {
    const sessionId = get(currentAgentSessionIdAtom)
    if (!sessionId) return
    set(agentSessionComponentTabsAtomFamily(sessionId), (previous) => (
      previous.includes(component) ? previous : [...previous, component]
    ))
    set(agentSidePanelOpenAtomFamily(sessionId), true)
    set(agentDiffPanelTabAtom, (previous) => {
      if (previous.get(sessionId) === component) return previous
      const next = new Map(previous)
      next.set(sessionId, component)
      return next
    })
  },
)

/**
 * Agent 改动项目级数据时，仅在产生改动的 session 展示对应 Tab。
 * 若该 session 正在查看 Skills 或项目记忆，保留用户显式选择的焦点。
 */
export const revealChangedWorkspaceComponentAtom = atom(
  null,
  (get, set, { sessionId, component }: { sessionId: string; component: WorkspaceComponentTab }) => {
    set(agentSessionComponentTabsAtomFamily(sessionId), (previous) => (
      previous.includes(component) ? previous : [...previous, component]
    ))

    const activeTab = get(agentDiffPanelTabAtom).get(sessionId)
    const preservesUserFocus = get(agentSidePanelOpenAtomFamily(sessionId))
      && isUserPriorityWorkspaceComponentTab(activeTab)
    if (preservesUserFocus) return

    set(agentSidePanelOpenAtomFamily(sessionId), true)
    set(agentDiffPanelTabAtom, (previous) => {
      if (previous.get(sessionId) === component) return previous
      const next = new Map(previous)
      next.set(sessionId, component)
      return next
    })
  },
)

/** 关闭当前 session 的一个组件；若它正被当前会话查看，回退到文件。 */
export const closeWorkspaceComponentAtom = atom(
  null,
  (get, set, component: WorkspaceComponentTab) => {
    const sessionId = get(currentAgentSessionIdAtom)
    if (!sessionId) return
    set(agentSessionComponentTabsAtomFamily(sessionId), (previous) => previous.filter((item) => item !== component))
    set(agentDiffPanelTabAtom, (previous) => {
      if (previous.get(sessionId) !== component) return previous
      const next = new Map(previous)
      next.set(sessionId, 'files')
      return next
    })
  },
)

/** Diff 视图模式：'split' | 'unified'，默认使用统一预览 */
export const agentDiffViewModeAtom = atom<'split' | 'unified'>('unified')

/** Diff 刷新版本号 — 按 session 隔离，Agent 写工具完成时递增 */
export const agentDiffRefreshVersionAtom = atom(new Map<string, number>())

/** 当前会话选中的 worktree 路径，null = 默认行为（显示 session 改动） */
export const agentSelectedWorktreeAtom = atom(new Map<string, string | null>())

/** 是否有未查看的代码改动 — 按 session 隔离 */
export const agentDiffUnseenChangesAtom = atom(new Map<string, boolean>())

/** Agent 本轮刚修改但用户尚未查看的文件路径 — 按 session 隔离，Map<sessionId, Set<filePath>> */
export const agentDiffUnseenFilesAtom = atom(new Map<string, Set<string>>())

/**
 * 非 Git 目录中由 Agent 成功写入的文件变更，按会话保存。
 * 这些文件不能生成 Git diff，但应和 Git 改动共享“文件改动”入口。
 */
export const agentNonGitFileChangesAtom = atom<Map<string, SessionFileChange[]>>(new Map())

/** 当前 session 的 Agent run ID（即渲染进程生成并传给主进程的 startedAt）。 */
export const agentFileChangesCurrentRunAtom = atom<Map<string, string>>(new Map())

/**
 * Diff 数据缓存 — 按 session 隔离，存放上一次 IPC 拉取到的未暂存改动结果。
 *
 * 让 DiffChangesList 切走再切回时能立即拿到旧数据渲染（SWR 模式），
 * 避免 mount 时空数组误命中"没有代码改动"分支造成 ~1s 闪烁。
 * 数据新鲜度由 [[agentDiffRefreshVersionAtom]] 触发的后台 fetch 维护，无 TTL。
 */
export const agentDiffDataAtom = atom(new Map<string, UnstagedChangesResult>())

/** 当前会话的工作路径 Map — sessionId → path */
export const agentSessionPathMapAtom = atom<Map<string, string>>(new Map())

/**
 * 文件浏览器自动定位信号：当用户通过文件搜索点击结果时设置该 atom；
 * FileBrowser 实例订阅后，若路径落在自身 rootPath 下则展开祖先 + 滚动定位。
 * `ts` 用于触发同路径的二次定位（atom 比对引用）。
 */
export interface FileBrowserAutoReveal {
  sessionId: string
  path: string
  ts: number
  /** 是否同时将文件设为选中态 */
  select?: boolean
}
export const fileBrowserAutoRevealAtom = atom<FileBrowserAutoReveal | null>(null)

/**
 * 最近被 Agent 修改的文件路径（per-session，path → 修改时间戳 ms）。
 * FileBrowser 据此在文件行左侧渲染竖条标记，60s 后自动消失，
 * 用于让用户在错过 0.8s 脉冲后仍能看到「最近修改」状态。
 */
export const recentlyModifiedPathsAtom = atom<Map<string, Map<string, number>>>(new Map())

/** 最近修改标记的存活时间（毫秒） */
export const RECENTLY_MODIFIED_TTL_MS = 60_000

// ===== 权限系统 Atoms =====

/** 新会话默认权限模式 */
export const agentDefaultPermissionModeAtom = atom<PromaPermissionMode>(PROMA_DEFAULT_PERMISSION_MODE)

/** Per-session 权限模式 Map — sessionId → PromaPermissionMode */
export const agentPermissionModeMapAtom = atom<Map<string, PromaPermissionMode>>(new Map())

/**
 * 按 sessionId 派生该 session 的持久化权限模式。
 * 返回 `undefined`（session 不存在或未设置）或具体的 PromaPermissionMode 字符串，
 * jotai 用 === 比较，只有值真正变化时才通知下游——避免流式中无关字段更新引发 re-render。
 */
export const sessionPersistedPermissionModeAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const sessions = get(agentSessionsAtom)
    return sessions.find((s) => s.id === sessionId)?.permissionMode
  }),
)

/** 按 sessionId 派生该 session 是否存在于列表中（冷启动判断用） */
export const sessionExistsAtom = atomFamily((sessionId: string) =>
  atom((get) => {
    const sessions = get(agentSessionsAtom)
    return sessions.some((s) => s.id === sessionId)
  }),
)

/** Agent 思考模式：未加载持久化设置前也默认开启，避免输入栏按钮短暂显示为关闭。 */
export const agentThinkingAtom = atom<ThinkingConfig | undefined>({ type: 'adaptive' })

/** Agent 推理深度 */
export const agentEffortAtom = atom<AgentEffort | undefined>(undefined)

/** Agent 最大预算（美元/次） */
export const agentMaxBudgetUsdAtom = atom<number | undefined>(undefined)

/** Agent 最大轮次 */
export const agentMaxTurnsAtom = atom<number | undefined>(undefined)

/** 待处理的权限请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingPermissionRequestsAtom = atom<Map<string, readonly PermissionRequest[]>>(new Map())

type PermissionRequestsUpdate = readonly PermissionRequest[] | ((prev: readonly PermissionRequest[]) => readonly PermissionRequest[])

/** 当前会话的权限请求队列（派生读写原子） */
export const pendingPermissionRequestsAtom = atom(
  (get): readonly PermissionRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingPermissionRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: PermissionRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingPermissionRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

/** 待处理的 AskUser 请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingAskUserRequestsAtom = atom<Map<string, readonly AskUserRequest[]>>(new Map())

/** AskUser 单题答案草稿 */
export interface AskUserQuestionDraft {
  selected: string[]
  customText: string
  showCustom: boolean
}

/** AskUser 请求级草稿 — 以 requestId 为 key，组件卸载后仍保留 */
export interface AskUserRequestDraft {
  activeTab: number
  focusedOptIdx: number
  answers: Map<number, AskUserQuestionDraft>
}

/** 待提交 AskUser 草稿 Map — 以 requestId 为 key，切换预览/会话时保留填写进度 */
export const askUserDraftsAtom = atom<Map<string, AskUserRequestDraft>>(new Map())

type AskUserRequestsUpdate = readonly AskUserRequest[] | ((prev: readonly AskUserRequest[]) => readonly AskUserRequest[])

/** 当前会话的 AskUser 请求队列（派生读写原子） */
export const pendingAskUserRequestsAtom = atom(
  (get): readonly AskUserRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingAskUserRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: AskUserRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingAskUserRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

/** 待处理的 ExitPlanMode 请求 Map — 以 sessionId 为 key */
export const allPendingExitPlanRequestsAtom = atom<Map<string, readonly ExitPlanModeRequest[]>>(new Map())

/** 当前处于 Plan 模式的会话 ID 集合 */
export const agentPlanModeSessionsAtom = atom<Set<string>>(new Set<string>())

export const currentAgentSessionAtom = atom<AgentSessionMeta | null>((get) => {
  const sessions = get(agentSessionsAtom)
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return sessions.find((s) => s.id === currentId) ?? null
})

export const agentStreamingAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentSessionStreamingStateAtomFamily(currentId))?.running ?? false
})

export const agentStreamingModelAtom = atom<string | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentSessionStreamingStateAtomFamily(currentId))?.model
})

export const agentRetryingAtom = atom<AgentStreamState['retrying'] | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentSessionStreamingStateAtomFamily(currentId))?.retrying
})

export const agentStartedAtAtom = atom<number | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentSessionStreamingStateAtomFamily(currentId))?.startedAt
})

let lastRunningSessionSignature = ''
let lastRunningSessionIds = new Set<string>()

export const agentRunningSessionIdsAtom = atom<Set<string>>((get) => {
  const ids = new Set<string>()
  for (const sessionId of get(agentStreamingStateIdsAtom)) {
    if (get(agentSessionStreamingStateAtomFamily(sessionId))?.running) ids.add(sessionId)
  }
  const signature = [...ids].sort().join('|')
  if (signature === lastRunningSessionSignature) return lastRunningSessionIds
  lastRunningSessionSignature = signature
  lastRunningSessionIds = ids
  return ids
})

/** 侧边栏会话指示点状态 */
export type SessionIndicatorStatus = 'idle' | 'running' | 'blocked' | 'completed'

/** 已完成但用户尚未查看的会话 ID 集合 */
export const unviewedCompletedSessionIdsAtom = atom<Set<string>>(new Set<string>())

let lastIndicatorSignature = ''
let lastIndicatorMap = new Map<string, SessionIndicatorStatus>()

function getStableIndicatorMap(entries: Array<[string, SessionIndicatorStatus]>): Map<string, SessionIndicatorStatus> {
  entries.sort(([a], [b]) => a.localeCompare(b))
  const signature = entries.map(([id, status]) => `${id}:${status}`).join('|')
  if (signature === lastIndicatorSignature) return lastIndicatorMap
  lastIndicatorSignature = signature
  lastIndicatorMap = new Map(entries)
  return lastIndicatorMap
}

/** Dock/Launcher 角标数量：未查看完成会话 + 待处理阻塞请求 */
export const dockBadgeCountAtom = atom<number>((get) => {
  return calculateDockBadgeCount({
    unviewedCompletedCount: get(unviewedCompletedSessionIdsAtom).size,
    pendingPermissionCount: countPendingRequests(get(allPendingPermissionRequestsAtom)),
    pendingAskUserCount: countPendingRequests(get(allPendingAskUserRequestsAtom)),
    pendingExitPlanCount: countPendingRequests(get(allPendingExitPlanRequestsAtom)),
  })
})

/**
 * 每个会话的指示点状态（只包含非 idle 的会话）
 * 优先级：blocked > running > completed > idle
 */
export const agentSessionIndicatorMapAtom = atom<Map<string, SessionIndicatorStatus>>((get) => {
  const streamStates = get(agentStreamingStatesAtom)
  const pendingPerms = get(allPendingPermissionRequestsAtom)
  const pendingAskUser = get(allPendingAskUserRequestsAtom)
  const pendingExitPlan = get(allPendingExitPlanRequestsAtom)
  const unviewedCompleted = get(unviewedCompletedSessionIdsAtom)

  const map = new Map<string, SessionIndicatorStatus>()

  for (const [id, state] of streamStates) {
    if (!state.running) continue
    const hasBlock = (pendingPerms.get(id)?.length ?? 0) > 0
      || (pendingAskUser.get(id)?.length ?? 0) > 0
      || (pendingExitPlan.get(id)?.length ?? 0) > 0
    if (hasBlock) {
      map.set(id, 'blocked')
    } else if (
      state.contextCompaction?.status === 'running'
      && state.contextCompaction.afterCompletedTurn === true
    ) {
      // 主任务已经交付，后续仅在整理上下文时应呈现为可验收的完成态。
      map.set(id, 'completed')
    } else {
      map.set(id, 'running')
    }
  }

  for (const id of unviewedCompleted) {
    if (!map.has(id)) {
      map.set(id, 'completed')
    }
  }

  return getStableIndicatorMap(Array.from(map.entries()))
})

/**
 * 处理 AgentEvent 并更新流式状态（纯函数）
 */
export function applyAgentEvent(
  prev: AgentStreamState,
  event: AgentEvent,
): AgentStreamState {
  switch (event.type) {
    case 'tool_start':
      // 工具开始只负责收束 retry/compaction 控制状态；工具展示由 live SDK message 驱动。
      return { ...clearFinishedCompactionForResumedWork(prev), retrying: undefined }

    case 'tool_result':
    case 'task_backgrounded':
    case 'task_progress':
    case 'task_started':
    case 'shell_backgrounded':
    case 'shell_killed':
    case 'task_notification':
      return clearFinishedCompactionForResumedWork(prev)

    case 'thinking_tokens': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      return {
        ...resumed,
        thinkingEstimatedTokens: event.estimatedTokens,
      }
    }

    case 'tool_use_summary':
      // 工具使用摘要 — 目前不影响流式状态，仅用于 UI 展示
      return prev

    case 'complete': {
      // 成功完成 — 清除 retrying，但保持 running: true
      // 等待 STREAM_COMPLETE IPC 回调通过删除流式状态来控制 UI 就绪状态
      // 这避免了用户在后端尚未完成清理时就能发送新消息的竞态条件
      // 同时将未完成的工具活动标记为 done（兜底）
      //
      // token 计数（inputTokens / 缓存 / outputTokens）默认只信任流式中每条 assistant
      // 消息的 usage_update：单条模型调用的 input+缓存 ≈ 当轮完整 prompt = 当前真实上下文。
      // SDK 的 result.usage 是整个 query 内所有模型调用的累计求和（cache_read 会被累加 N 次），
      // 直接覆盖会让进度环虚高、冲破 100%（PR #821 修的正是这个问题）。
      //
      // 但 GLM-5.2 等走 Anthropic 兼容端点的渠道，流式 assistant 消息不携带 usage 字段，
      // 真实值只在 result 中返回。若完全不用 result.usage，这些渠道的 ContextUsageBadge
      // 永远停留在 inputTokens=0 不显示。
      //
      // 折中：仅当「整个 query 期间从未收到流式 usage_update」（prev.inputTokens 为空/0）
      // 才从 result.usage 兜底写入 token 字段；已有流式真实值时不动。
      // - contextWindow：取流式与 result 的较大值（result 未必更权威——多 entry 时
      //   子 Agent 的小窗口可能拉低值，Fix 1/2 已从源头取 max，此处作为安全网）。
      // - costUsd：始终覆盖（本就该是整轮累计成本）
      const needResultFallback = !prev.inputTokens || prev.inputTokens <= 0 || prev.contextUsageIsEstimated === true
      const shouldUseResultUsage = needResultFallback
        && event.usage?.inputTokens != null
        && (event.usage.inputTokens > 0 || prev.contextUsageIsEstimated !== true)
      return {
        ...prev,
        ...(event.usage ? {
          ...(event.usage.costUsd != null && { costUsd: event.usage.costUsd }),
          ...(event.usage.contextWindow != null && {
            contextWindow: prev.contextWindow != null
              ? Math.max(prev.contextWindow, event.usage.contextWindow)
              : event.usage.contextWindow,
          }),
          ...(shouldUseResultUsage && {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheReadTokens: event.usage.cacheReadTokens,
            cacheCreationTokens: event.usage.cacheCreationTokens,
            contextUsageIsEstimated: false,
          }),
        } : {}),
        retrying: undefined,
      }
    }

    case 'run_resumed': {
      // 后台任务完成自动唤醒：从"空闲可输入"恢复到运行态（防御性，监听器已显式处理）。
      const resumed = clearFinishedCompactionForResumedWork(prev)
      return { ...resumed, running: true, backgroundWaiting: false }
    }

    case 'typed_error':
      // 终态 IPC 仍可能在后端清理前到达；统一由 STREAM_COMPLETE 释放运行锁，
      // 避免用户在 active session 尚未销毁时抢先启动新 run。
      return { ...prev, retrying: undefined }

    case 'error':
      // 同上：保留运行锁和 retry 状态，等待专用 retry 终态或 STREAM_COMPLETE 收束。
      return prev

    case 'usage_update': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      return {
        ...resumed,
        ...(event.usage.inputTokens != null && {
          inputTokens: event.usage.inputTokens,
          contextUsageIsEstimated: false,
        }),
        ...(event.usage.outputTokens != null && { outputTokens: event.usage.outputTokens }),
        ...(event.usage.cacheReadTokens != null && { cacheReadTokens: event.usage.cacheReadTokens }),
        ...(event.usage.cacheCreationTokens != null && { cacheCreationTokens: event.usage.cacheCreationTokens }),
        ...(event.usage.costUsd != null && { costUsd: event.usage.costUsd }),
        // contextWindow 取 max：本分支同时承载「流式 assistant 消息按模型名推断的窗口」
        // 与「后端从 SDK result 透传的真实窗口（context_window 事件）」两个来源。
        // 模型窗口在同一会话内不会缩小，取更大值可兼顾两类端点——既不会让推断偏小的
        // 端点（如 GLM 剥掉 [1m] 后缀）挡住真实的 1M，也不会让回报偏小的端点覆盖正确的 1M。
        ...(event.usage.contextWindow && {
          contextWindow: Math.max(resumed.contextWindow ?? 0, event.usage.contextWindow),
        }),
      }
    }

    case 'compacting':
      return {
        ...prev,
        isCompacting: true,
        compactInFlight: true,
        contextCompaction: {
          status: 'running',
          afterCompletedTurn: event.afterCompletedTurn === true,
        },
      }

    case 'compact_complete': {
      const contextCompaction = {
        status: event.status,
        summary: event.summary,
        message: event.message,
      }
      if (event.estimatedTokensAfter == null) {
        return { ...prev, isCompacting: false, contextCompaction }
      }
      return {
        ...prev,
        isCompacting: false,
        contextCompaction,
        inputTokens: event.estimatedTokensAfter,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheCreationTokens: undefined,
        contextUsageIsEstimated: true,
      }
    }

    case 'model_resolved':
      // 不用 SDK 返回的实际模型名覆盖，保持用户选择的 modelId
      // 以确保 resolveModelDisplayName 能匹配到渠道配置的显示名
      return prev

    case 'retrying': {
      if (!isRetryEventForCurrentStream(prev, event)) return prev
      const previousRetry = prev.retrying
      // 同一顶层 run 的下一段连续错误从 1 开始时，开始新的历史；同一段的 1 → 2
      // 则保留已实际执行的记录。
      const isNewCycle = event.attempt === 1
        && previousRetry != null
        && previousRetry.phase !== 'scheduled'
        && previousRetry.phase !== 'running'
      return {
        ...prev,
        retrying: {
          runStartedAt: event.runStartedAt ?? previousRetry?.runStartedAt,
          phase: 'scheduled',
          currentAttempt: event.attempt,
          maxAttempts: event.maxAttempts,
          totalAttempt: event.totalAttempt ?? previousRetry?.totalAttempt,
          maxTotalAttempts: event.maxTotalAttempts ?? previousRetry?.maxTotalAttempts,
          history: isNewCycle ? [] : (previousRetry?.history ?? []),
          scheduledAt: event.scheduledAt ?? Date.now(),
          delaySeconds: event.delaySeconds,
          reason: event.reason,
        },
      }
    }

    case 'retry_attempt': {
      if (!isRetryEventForCurrentStream(prev, event)) return prev
      const previousRetry = prev.retrying
      const isNewCycle = event.attemptData.attempt === 1
        && previousRetry != null
        && previousRetry.phase !== 'scheduled'
        && previousRetry.phase !== 'running'
      const history = upsertRetryAttempt(
        isNewCycle ? [] : (previousRetry?.history ?? []),
        event.attemptData,
      )
      return {
        ...prev,
        retrying: {
          runStartedAt: event.runStartedAt ?? previousRetry?.runStartedAt,
          phase: 'running',
          currentAttempt: event.attemptData.attempt,
          maxAttempts: event.maxAttempts ?? previousRetry?.maxAttempts ?? 3,
          totalAttempt: event.totalAttempt ?? event.attemptData.totalAttempt ?? previousRetry?.totalAttempt,
          maxTotalAttempts: event.maxTotalAttempts ?? event.attemptData.maxTotalAttempts ?? previousRetry?.maxTotalAttempts,
          history,
          reason: event.attemptData.reason,
        },
      }
    }

    case 'retry_cleared': {
      if (!isRetryEventForCurrentStream(prev, event) || !prev.retrying) return prev
      return {
        ...prev,
        retrying: {
          ...prev.retrying,
          phase: 'succeeded',
          scheduledAt: undefined,
          delaySeconds: undefined,
          currentAttempt: event.attempt ?? prev.retrying.currentAttempt,
          maxAttempts: event.maxAttempts ?? prev.retrying.maxAttempts,
          totalAttempt: event.totalAttempt ?? prev.retrying.totalAttempt,
          maxTotalAttempts: event.maxTotalAttempts ?? prev.retrying.maxTotalAttempts,
          reason: undefined,
        },
      }
    }

    case 'retry_failed': {
      if (!isRetryEventForCurrentStream(prev, event)) return prev
      const previousRetry = prev.retrying
      return {
        ...prev,
        // session.prompt() 与 adapter 资源清理尚未完成；由 STREAM_COMPLETE 释放运行锁。
        retrying: {
          runStartedAt: event.runStartedAt ?? previousRetry?.runStartedAt,
          phase: 'exhausted',
          currentAttempt: event.finalAttempt.attempt,
          maxAttempts: event.maxAttempts ?? previousRetry?.maxAttempts ?? 3,
          totalAttempt: event.totalAttempt ?? event.finalAttempt.totalAttempt ?? previousRetry?.totalAttempt,
          maxTotalAttempts: event.maxTotalAttempts ?? event.finalAttempt.maxTotalAttempts ?? previousRetry?.maxTotalAttempts,
          history: upsertRetryAttempt(previousRetry?.history ?? [], event.finalAttempt),
          reason: event.finalAttempt.reason,
        },
      }
    }

    case 'retry_cancelled': {
      if (!isRetryEventForCurrentStream(prev, event)) return prev
      const previousRetry = prev.retrying
      return {
        ...prev,
        // 取消 retry 不代表外围 prompt chain 已结束；由 STREAM_COMPLETE 释放运行锁。
        retrying: {
          runStartedAt: event.runStartedAt ?? previousRetry?.runStartedAt,
          phase: 'cancelled',
          currentAttempt: event.attempt,
          maxAttempts: event.maxAttempts,
          totalAttempt: event.totalAttempt ?? previousRetry?.totalAttempt,
          maxTotalAttempts: event.maxTotalAttempts ?? previousRetry?.maxTotalAttempts,
          history: previousRetry?.history ?? [],
          reason: event.reason ?? previousRetry?.reason,
        },
      }
    }

    case 'permission_request':
      // 权限请求事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'permission_resolved':
      // 权限解决事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'ask_user_request':
      // AskUser 请求事件由 AskUserBanner 处理，不影响流式状态
      return prev

    case 'ask_user_resolved':
      // AskUser 解决事件由 AskUserBanner 处理，不影响流式状态
      return prev

    case 'prompt_suggestion':
      // 提示建议由全局监听器处理，不影响流式状态
      return prev

    default:
      return prev
  }
}

/** 上下文使用量状态 */
export interface AgentContextStatus {
  isCompacting: boolean
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
  /** 当前上下文 token 是否为 Pi 手动压缩后的预估值 */
  contextUsageIsEstimated?: boolean
}

/** 当前会话的上下文使用量派生 atom */
export const agentContextStatusAtom = atom<AgentContextStatus>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return { isCompacting: false }
  const state = get(agentSessionStreamingStateAtomFamily(currentId))
  return {
    isCompacting: state?.isCompacting ?? false,
    inputTokens: state?.inputTokens,
    outputTokens: state?.outputTokens,
    cacheReadTokens: state?.cacheReadTokens,
    cacheCreationTokens: state?.cacheCreationTokens,
    costUsd: state?.costUsd,
    contextWindow: state?.contextWindow,
    contextUsageIsEstimated: state?.contextUsageIsEstimated,
  }
})

/**
 * Agent 流式错误消息 Map — 以 sessionId 为 key
 * 错误发生时写入，下次发送或手动关闭时清除
 */
export const agentStreamErrorsAtom = atom<Map<string, string>>(new Map())

/** 在同一会话确认恢复运行后移除过期的流式错误记录。 */
export function clearAgentStreamError(
  errors: Map<string, string>,
  sessionId: string,
): Map<string, string> {
  if (!errors.has(sessionId)) return errors
  const next = new Map(errors)
  next.delete(sessionId)
  return next
}

/**
 * Agent 消息刷新版本 Map — 以 sessionId 为 key
 * 全局监听器在流式完成/错误时递增版本号，
 * AgentView 监听版本号变化来重新加载消息。
 */
export const agentMessageRefreshAtom = atom<Map<string, number>>(new Map())

/**
 * 持久化 SDKMessage 的内存缓存 Map — 以 sessionId 为 key
 * 用于消除「切换会话时先清空 → 等待 IPC 全量读盘」的可见空窗：
 * 命中缓存可立即填充消息区，IPC 返回后再覆盖为最新数据。
 *
 * 内存安全：缓存条目随会话数增长会无限膨胀（长会话的消息数组很大），
 * 因此通过 setSessionMessagesCache 做 LRU 淘汰，仅保留最近访问的
 * AGENT_MSG_CACHE_MAX 个会话；会话删除时也需主动剔除对应条目。
 */
export const AGENT_MSG_CACHE_MAX = 20
export const agentSDKMessagesCacheAtom = atom<Map<string, SDKMessage[]>>(new Map())

/**
 * 写入会话消息缓存并执行 LRU 淘汰。
 * 利用 JS Map 的插入顺序：删除已存在的 key 再重新 set，使其移到「最新」位置；
 * 超出上限时从头部（最旧）删除，直到回到上限内。返回新的 Map（不可变更新）。
 */
export function setSessionMessagesCache(
  prev: Map<string, SDKMessage[]>,
  sessionId: string,
  messages: SDKMessage[],
): Map<string, SDKMessage[]> {
  const next = new Map(prev)
  next.delete(sessionId)
  next.set(sessionId, messages)
  while (next.size > AGENT_MSG_CACHE_MAX) {
    const oldest = next.keys().next().value
    if (oldest === undefined) break
    next.delete(oldest)
  }
  return next
}

/** 当前 Agent 会话的错误消息（派生只读原子） */
export const currentAgentErrorAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentStreamErrorsAtom).get(currentId) ?? null
})

/**
 * Agent 会话输入框草稿 Map — 以 sessionId 为 key
 * 用于在切换会话时保留输入框内容
 */
export const agentSessionDraftsAtom = atom<Map<string, string>>(new Map())

/** 明确外部草稿写入的版本号；RichTextInput 用它区分本地回写与强制覆盖。 */
export const agentSessionDraftSyncVersionsAtom = atom<Map<string, number>>(new Map())

/** 单个 session 的外部草稿同步版本派生 atom。 */
export const agentSessionDraftSyncVersionAtomFamily = atomFamily((sessionId: string) =>
  atom((get) => get(agentSessionDraftSyncVersionsAtom).get(sessionId) ?? 0),
)

/** 单个 session 的 markdown 草稿派生 atom — 按 sessionId 切片订阅 */
export const agentSessionDraftAtomFamily = atomFamily((sessionId: string) =>
  atom((get) => get(agentSessionDraftsAtom).get(sessionId) ?? ''),
)

/**
 * Agent 会话输入框 HTML 草稿 Map — 以 sessionId 为 key
 * 保存 TipTap 编辑器的原始 HTML，用于切换会话时恢复 mention 等富文本节点
 */
export const agentSessionDraftHtmlAtom = atom<Map<string, string>>(new Map())

/** 单个 session 的 HTML 草稿派生 atom — 按 sessionId 切片订阅 */
export const agentSessionDraftHtmlAtomFamily = atomFamily((sessionId: string) =>
  atom((get) => get(agentSessionDraftHtmlAtom).get(sessionId) ?? ''),
)

/**
 * 会话附加目录 Map — 以 sessionId 为 key
 * 存储每个会话通过"附加文件夹"功能关联的外部目录路径列表。
 * 这些路径作为 SDK additionalDirectories 参数传递。
 */
export const agentAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

/**
 * 会话附加文件 Map — 以 sessionId 为 key
 * 存储每个会话通过"附加文件"功能关联的外部文件路径列表。
 */
export const agentAttachedFilesMapAtom = atom<Map<string, string[]>>(new Map())

/**
 * 工作区级附加目录列表（按 workspaceId 存储）
 *
 * 工作区内所有会话共享这些附加目录。
 */
export const workspaceAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

/**
 * 工作区级附加文件列表（按 workspaceId 存储）
 *
 * 工作区内所有会话共享这些附加文件。
 */
export const workspaceAttachedFilesMapAtom = atom<Map<string, string[]>>(new Map())

/** 当前 Agent 会话的草稿内容（派生读写原子） */
export const currentAgentSessionDraftAtom = atom(
  (get) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return ''
    return get(agentSessionDraftsAtom).get(currentId) ?? ''
  },
  (get, set, newDraft: string) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(agentSessionDraftsAtom, (prev) => {
      const map = new Map(prev)
      if (newDraft.trim() === '') {
        map.delete(currentId)
      } else {
        map.set(currentId, newDraft)
      }
      return map
    })
  }
)

// ===== 提示建议 Atoms =====

/** Agent 提示建议 Map — 以 sessionId 为 key，存储最近一条建议 */
export const agentPromptSuggestionsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的提示建议（派生只读原子） */
export const currentAgentSuggestionAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentPromptSuggestionsAtom).get(currentId) ?? null
})

// ===== 用户打断状态 =====

/** 被用户手动打断的会话集合（仅当前 streaming 周期有效，reload 后清除） */
export const stoppedByUserSessionsAtom = atom<Set<string>>(new Set<string>())

// ===== 初始化就绪状态 =====

/** AgentSettingsInitializer 是否已完成加载（渠道/工作区/设置全部就绪） */
export const agentSettingsReadyAtom = atom(false)
