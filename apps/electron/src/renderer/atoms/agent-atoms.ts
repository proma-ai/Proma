/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import { atomFamily, atomWithStorage, selectAtom } from 'jotai/utils'
import type { AgentSessionMeta, AgentWorkspace, AgentPendingFile, RetryAttempt, PromaPermissionMode, PermissionRequest, AskUserRequest, ExitPlanModeRequest, ThinkingConfig, AgentEffort, SDKMessage, UnstagedChangesResult } from '@proma/shared'
import type { AgentLiveUpdate } from '@/lib/agent-canonical-stream'
import { PROMA_DEFAULT_PERMISSION_MODE } from '@proma/shared'
import { calculateDockBadgeCount, countPendingRequests } from '@/lib/dock-badge-count'
import type { AgentQueuedMessage } from '@/lib/agent-message-queue'
import type { SessionFileChange } from '@/lib/session-file-changes'

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

/**
 * 将流式状态中未完成的 toolActivities 标记为终态。
 * 用于 complete、handleStop、STREAM_COMPLETE 等多个终态入口的兜底清理。
 * 当所有项已处于终态时返回原引用，避免不必要的 React 重渲染。
 */
export function finalizeStreamingActivities(
  toolActivities: ToolActivity[],
): { toolActivities: ToolActivity[] } {
  const hasUnfinishedTools = toolActivities.some((ta) => !ta.done)

  return {
    toolActivities: hasUnfinishedTools
      ? toolActivities.map((ta) => (ta.done ? ta : { ...ta, done: true }))
      : toolActivities,
  }
}

export interface ContextCompactionState {
  status: 'running' | 'success' | 'noop' | 'failed'
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
  toolActivities: ToolActivity[]
  model?: string
  /** 本次运行启动时的渠道 ID；运行中切换模型只影响下一轮，不能覆盖它。 */
  channelId?: string
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
  /** 主进程分配的 opaque run identity，用于精确拒绝迟到终态。 */
  runId?: string
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
export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>>(new Map())

/**
 * 单个 session 的 streaming state 派生 atomFamily — 按 sessionId 切片订阅。
 *
 * 直接订阅 agentStreamingStatesAtom 会让任意 session 的流式更新都触发 AgentView
 * 整树重渲染（10–30fps）。本 family 让订阅者只在本 session 的 state 引用变化时
 * 重渲染——其他 session 的更新虽然让 base atom 变化，但派生 atom 输出引用未变，
 * jotai 自动跳过通知。
 */
export const agentSessionStreamingStateAtomFamily = atomFamily((sessionId: string) =>
  atom((get) => get(agentStreamingStatesAtom).get(sessionId)),
)

/** AgentView 输入区/工具栏需要的低频流状态；排除逐 token 变化的 content/toolActivities。 */
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

export type AgentInputStreamState = Pick<AgentStreamState, 'running' | 'backgroundWaiting'>

const EMPTY_AGENT_INPUT_STREAM_STATE: AgentInputStreamState = { running: false }

function areAgentInputStreamStatesEqual(
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
 * AgentView 不订阅逐 token content；完整状态只由 AgentMessages 消费。
 * selectAtom 的 equalityFn 保证纯文本流式更新不会重渲染输入框和工具栏。
 */
export const agentSessionViewStreamStateAtomFamily = atomFamily((sessionId: string) =>
  selectAtom(
    agentSessionStreamingStateAtomFamily(sessionId),
    (state): AgentViewStreamState => state ?? EMPTY_AGENT_VIEW_STREAM_STATE,
    areAgentViewStreamStatesEqual,
  ),
)

/** AgentMessages 只需要的流生命周期字段；排除 usage 与 toolActivities 高频更新。 */
export type AgentMessagesStreamState = Pick<
  AgentStreamState,
  | 'running'
  | 'model'
  | 'channelId'
  | 'retrying'
  | 'runId'
  | 'startedAt'
  | 'isCompacting'
  | 'contextCompaction'
  | 'compactInFlight'
>

const EMPTY_AGENT_MESSAGES_STREAM_STATE: AgentMessagesStreamState = {
  running: false,
}

function areAgentMessagesStreamStatesEqual(
  previous: AgentMessagesStreamState,
  next: AgentMessagesStreamState,
): boolean {
  return previous.running === next.running
    && previous.model === next.model
    && previous.channelId === next.channelId
    && previous.retrying === next.retrying
    && previous.runId === next.runId
    && previous.startedAt === next.startedAt
    && previous.isCompacting === next.isCompacting
    && previous.contextCompaction === next.contextCompaction
    && previous.compactInFlight === next.compactInFlight
}

/** usage_update 不得让历史 transcript 跟随 token 频率重新执行。 */
export const agentSessionMessagesStreamStateAtomFamily = atomFamily((sessionId: string) =>
  selectAtom(
    agentSessionStreamingStateAtomFamily(sessionId),
    (state): AgentMessagesStreamState => state ?? EMPTY_AGENT_MESSAGES_STREAM_STATE,
    areAgentMessagesStreamStatesEqual,
  ),
)

/**
 * 当前 run 的 final/control SDKMessage 累积 Map。
 *
 * assistant partial 正文由 AgentLiveTranscriptStore 维护，不进入此 Jotai Map。
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

/** 侧面板是否打开（全局共享，所有会话共用一个状态） */
export const agentSidePanelOpenAtom = atomWithStorage<boolean>('proma-agent-sidepanel-open', true)

/** 侧面板宽度（全局共享，用户拖拽后持久化） */
export const agentSidePanelWidthAtom = atomWithStorage<number>('proma-agent-sidepanel-width', 280)

/** 文件来源选择：按会话持久化，未存储的会话默认显示会话文件。 */
export type AgentFileSourceFilter = 'session' | 'project'
export const agentFileSourceFilterMapAtom = atomWithStorage<Record<string, AgentFileSourceFilter>>(
  'proma-agent-file-source-filter-map',
  {},
  undefined,
  { getOnInit: true },
)

/** @deprecated 保留以兼容旧代码，但实际所有 session 都读全局 atom */
export const agentSidePanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

export type AgentSidePanelTab = 'files' | 'changes' | 'chat'

/** 侧面板当前 Tab：Files / 文件改动 / Chat（per-session Map） */
export const agentDiffPanelTabAtom = atom<Map<string, AgentSidePanelTab>>(new Map())

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

/** 当前 session 的 Agent run ID；主进程 run_started 后使用 opaque runId。 */
export const agentFileChangesCurrentRunAtom = atom<Map<string, string>>(new Map())

/**
 * Diff 数据缓存 — 按 session 隔离，存放上一次 IPC 拉取到的未暂存改动结果。
 *
 * 让 DiffChangesList 切走再切回时能立即拿到旧数据渲染（SWR 模式），
 * 避免 mount 时空数组误命中"没有代码改动"分支造成 ~1s 闪烁。
 * 数据新鲜度由 [[agentDiffRefreshVersionAtom]] 触发的后台 fetch 维护，无 TTL。
 */
export const agentDiffDataAtom = atom(new Map<string, UnstagedChangesResult>())

/** 当前会话的侧面板是否打开（派生只读：全局共享，但仅在有当前会话且为 Agent 模式时显示） */
export const currentSessionSidePanelOpenAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentSidePanelOpenAtom)
})

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
  return sessions.find((session) => session.id === currentId) ?? null
})

export const agentStreamingAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentStreamingStatesAtom).get(currentId)?.running ?? false
})

export const agentRunningSessionIdsAtom = atom<Set<string>>((get) => {
  const states = get(agentStreamingStatesAtom)
  const ids = new Set<string>()
  for (const [id, state] of states) {
    if (state.running) ids.add(id)
  }
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
    map.set(id, hasBlock ? 'blocked' : 'running')
  }

  for (const id of unviewedCompleted) {
    if (!map.has(id)) {
      map.set(id, 'completed')
    }
  }

  return getStableIndicatorMap(Array.from(map.entries()))
})

/** canonical live projection → 低频业务状态（正文由 AgentLiveTranscriptStore 独立维护）。 */
export function applyAgentLiveUpdate(
  prev: AgentStreamState,
  event: AgentLiveUpdate,
): AgentStreamState {
  switch (event.type) {
    case 'assistant_progress': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      if (resumed === prev && prev.retrying === undefined) return prev
      return { ...resumed, retrying: undefined }
    }

    case 'tool_start': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      const existing = resumed.toolActivities.find((t) => t.toolUseId === event.toolUseId)
      if (existing) {
        return {
          ...resumed,
          toolActivities: resumed.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, input: event.input, intent: event.intent || t.intent, displayName: event.displayName || t.displayName }
              : t
          ),
          // 开始工具调用 - 清除重试状态（重试成功）
          retrying: undefined,
        }
      }
      return {
        ...resumed,
        toolActivities: [...resumed.toolActivities, {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: false,
          parentToolUseId: event.parentToolUseId,
        }],
        // 开始工具调用 - 清除重试状态（重试成功）
        retrying: undefined,
      }
    }

    case 'tool_result': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      return {
        ...resumed,
        toolActivities: resumed.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, result: event.result, isError: event.isError, done: true, imageAttachments: event.imageAttachments }
            : t
        ),
      }
    }

    case 'task_progress': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      // 普通 tool 计时语义（仅当有真实 elapsedSeconds 时更新）
      if (event.elapsedSeconds != null) {
        return {
          ...resumed,
          toolActivities: resumed.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, elapsedSeconds: event.elapsedSeconds! }
              : t
          ),
        }
      }
      return resumed
    }

    case 'task_started': {
      const resumed = clearFinishedCompactionForResumedWork(prev)
      // 查找匹配 toolUseId 的 ToolActivity，更新 intent 和 taskId
      let nextActivities = resumed.toolActivities
      if (event.toolUseId) {
        if (resumed.toolActivities.some((t) => t.toolUseId === event.toolUseId)) {
          nextActivities = resumed.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, intent: event.description, taskId: event.taskId }
              : t
          )
        }
      }
      return { ...resumed, toolActivities: nextActivities }
    }

    case 'task_notification':
      return clearFinishedCompactionForResumedWork(prev)

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
        ...finalizeStreamingActivities(prev.toolActivities),
      }
    }

    case 'run_resumed': {
      // 后台任务完成自动唤醒：从"空闲可输入"恢复到运行态（防御性，监听器已显式处理）。
      const resumed = clearFinishedCompactionForResumedWork(prev)
      return { ...resumed, running: true, backgroundWaiting: false }
    }

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
        contextCompaction: { status: 'running' },
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
  const state = get(agentStreamingStatesAtom).get(currentId)
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

// ===== 后台任务管理 =====

/**
 * 后台任务数据结构
 *
 * 用于 ActiveTasksBar 显示运行中的 Agent 任务和 Shell 任务。
 */
export interface BackgroundTask {
  /** 任务或 Shell ID */
  id: string
  /** 任务类型 */
  type: 'agent' | 'shell'
  /** 关联的工具调用 ID（用于滚动定位到实时工具调用） */
  toolUseId: string
  /** 任务开始时间戳 */
  startTime: number
  /** 已耗时（秒） */
  elapsedSeconds: number
  /** 任务意图/描述 */
  intent?: string
}

/**
 * 后台任务列表原子家族
 *
 * 按 sessionId 隔离，每个会话独立管理后台任务。
 * 任务完成后从列表中移除（只显示运行中任务）。
 */
export const backgroundTasksAtomFamily = atomFamily((sessionId: string) =>
  atom<BackgroundTask[]>([])
)

// ===== 用户打断状态 =====

/** 被用户手动打断的会话集合（仅当前 streaming 周期有效，reload 后清除） */
export const stoppedByUserSessionsAtom = atom<Set<string>>(new Set<string>())

// ===== 初始化就绪状态 =====

/** AgentSettingsInitializer 是否已完成加载（渠道/工作区/设置全部就绪） */
export const agentSettingsReadyAtom = atom(false)
