/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 流式输出通过 SDK 渲染路径（MessageGroupRenderer）展示工具活动。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Bot, RotateCw, AlertTriangle, CheckCircle2, Ban, ChevronDown, ChevronRight } from 'lucide-react'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import {
  Message,
  MessageHeader,
  MessageContent,
  BasePathsProvider,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { StickyUserMessage } from '@/components/ai-elements/sticky-user-message'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { getModelLogo, resolveModelDisplayName, resolveModelProvider } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { ScrollPositionManager } from '@/hooks/useScrollPositionMemory'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupIntoTurns, MessageGroupRenderer, getGroupId, getGroupPreview, extractUserText, parseAttachedFiles as sdkParseAttachedFiles, isImageFile as sdkIsImageFile, buildTaskProgressDataForTurn, type AssistantTurn, type MessageGroup } from './SDKMessageRenderer'
import { buildLiveGroupSet } from './live-group-set'
import { AgentBrowserLinkProvider } from '@/components/browser/AgentBrowserLinkProvider'
import { AgentHistorySelectionLayer } from './AgentHistorySelectionLayer'
import { TaskProgressOverlay, type ContextCompactionProgress } from './TaskProgressOverlay'
import { applyOptimisticAssistantTurnMetadata, createMessageGroupRenderCache, groupMessagesForRendering } from './message-group-rendering'
import { useAgentLiveTranscriptMessages } from '@/lib/agent-live-transcript-store'
import type { AgentEventUsage, RetryAttempt, SDKMessage, SDKSystemMessage } from '@proma/shared'
import { getSDKCompactStatus } from '@proma/shared'
import { agentLiveMessagesAtomFamily, agentSessionMessagesStreamStateAtomFamily, type AgentStreamState } from '@/atoms/agent-atoms'
import type { QuotedSelection } from '@/atoms/preview-atoms'

const EMPTY_SDK_MESSAGES: SDKMessage[] = []

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** 消息对象引用 → 稳定 key 缓存，避免内容相同的消息产生重复 key */
const stableKeyCache = new WeakMap<object, string>()
let stableKeyFallbackCounter = 0

function getSDKMessageStableKey(message: SDKMessage): string {
  const record = message as Record<string, unknown>
  if (typeof record.uuid === 'string' && record.uuid.length > 0) {
    return `${message.type}:uuid:${record.uuid}`
  }

  // 已缓存的消息对象直接返回，保证跨渲染稳定
  if (stableKeyCache.has(message)) {
    return stableKeyCache.get(message)!
  }

  const parentToolUseId = typeof record.parent_tool_use_id === 'string'
    ? record.parent_tool_use_id
    : ''
  const sessionId = typeof record.session_id === 'string' ? record.session_id : ''

  let key: string

  if (message.type === 'result') {
    const result = record as { subtype?: unknown; terminal_reason?: unknown; result?: unknown }
    key = `result:${sessionId}:${String(result.subtype ?? '')}:${String(result.terminal_reason ?? '')}:${String(result.result ?? '')}:${++stableKeyFallbackCounter}`
  } else if (message.type === 'system') {
    const sys = record as { subtype?: unknown; task_id?: unknown; tool_use_id?: unknown }
    key = `system:${sessionId}:${String(sys.subtype ?? '')}:${String(sys.task_id ?? '')}:${String(sys.tool_use_id ?? '')}:${stableStringify(record)}:${++stableKeyFallbackCounter}`
  } else if ('message' in record) {
    const inner = record.message as { content?: unknown } | undefined
    key = `${message.type}:${sessionId}:${parentToolUseId}:${stableStringify(inner?.content)}:${++stableKeyFallbackCounter}`
  } else {
    key = `${message.type}:${sessionId}:${parentToolUseId}:${stableStringify(record)}:${++stableKeyFallbackCounter}`
  }

  stableKeyCache.set(message, key)
  return key
}

export function isCompactionControlHistoryGroup(group: MessageGroup): boolean {
  if (group.type === 'system') return getSDKCompactStatus(group.message) != null
  return group.type === 'user' && (extractUserText(group.message) ?? '').trim() === '/compact'
}

export function getContextCompactionProgress(
  messages: SDKMessage[],
  isCompacting: boolean | undefined,
  streamCompaction: AgentStreamState['contextCompaction'] | undefined,
): ContextCompactionProgress | undefined {
  const latestStatusIndex = messages.findLastIndex((message) =>
    message.type === 'system' && getSDKCompactStatus(message as SDKSystemMessage) != null,
  )
  const latestStatus = latestStatusIndex >= 0
    ? messages[latestStatusIndex] as SDKSystemMessage
    : undefined
  const status = latestStatus ? getSDKCompactStatus(latestStatus) : undefined
  // Pi 会在同一个 stream 内续跑压缩前的任务。压缩边界后的 assistant、user 或普通系统消息都属于新工作，
  // 终态状态（无论来自 atom 还是 liveMessages）都不能继续抢占新的正常进度。
  const hasResumedWork = latestStatusIndex >= 0
    && messages.slice(latestStatusIndex + 1).some((message) => {
      if (message.type === 'assistant' || message.type === 'user') return true
      return message.type === 'system' && getSDKCompactStatus(message as SDKSystemMessage) == null
    })

  if (streamCompaction?.status === 'running') {
    return {
      status: 'running',
      label: '正在整理上下文',
      detail: '正在生成会话摘要，完成后可继续当前任务。',
    }
  }
  if (streamCompaction?.status === 'success' && !hasResumedWork) {
    return {
      status: 'success',
      label: '上下文已压缩',
      detail: '会话已整理，可以继续当前任务。',
      summary: streamCompaction.summary,
    }
  }
  if (streamCompaction?.status === 'noop' && !hasResumedWork) {
    return {
      status: 'noop',
      label: '当前上下文无需压缩',
      detail: streamCompaction.message ?? '当前上下文仍可用，可以继续当前任务。',
    }
  }
  if (streamCompaction?.status === 'failed') {
    return {
      status: 'failed',
      label: '上下文压缩失败',
      detail: streamCompaction.message ?? '请检查模型连接后重试。',
    }
  }
  if (hasResumedWork) return undefined

  if (status === 'success' && latestStatus) {
    return {
      status: 'success',
      label: '上下文已压缩',
      detail: '会话已整理，可以继续当前任务。',
      summary: latestStatus.summary,
    }
  }
  if (status === 'noop' && latestStatus) {
    return {
      status: 'noop',
      label: '当前上下文无需压缩',
      detail: latestStatus.message ?? '当前上下文仍可用，可以继续当前任务。',
    }
  }
  if (status === 'failed' && latestStatus) {
    return {
      status: 'failed',
      label: '上下文压缩失败',
      detail: latestStatus.compact_error ?? latestStatus.message ?? '请检查模型连接后重试。',
    }
  }
  if (status === 'compacting' || isCompacting) {
    return {
      status: 'running',
      label: '正在整理上下文',
      detail: '正在生成会话摘要，完成后可继续当前任务。',
    }
  }
  return undefined
}

export interface AgentHistoryQuoteNavigationRequest {
  sessionId: string
  quote: QuotedSelection
  requestId: number
}

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  /** 用户在前端选择的模型 ID（用于显示渠道配置的 Model Name） */
  sessionModelId?: string
  /** 消息是否已完成首次加载 */
  messagesLoaded?: boolean
  /** Phase 4: 持久化的 SDKMessage（新格式） */
  persistedSDKMessages?: SDKMessage[]
  /** 是否还有未加载的更早历史记录。 */
  hasEarlierMessages?: boolean
  /** 正在向前读取更早历史记录。 */
  loadingEarlierMessages?: boolean
  /** 用户主动请求加载更早历史记录。 */
  onLoadEarlierMessages?: () => void
  /** 当前会话工作目录，用于解析相对文件路径 */
  sessionPath?: string | null
  /** 附加目录列表（与 sessionPath 一并用作相对路径解析候选） */
  attachedDirs?: string[]
  /** 最后一轮是否被用户中断 */
  stoppedByUser?: boolean
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onRelinkProjectRoot?: () => void
  onRestoreProjectRoot?: () => void
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onCreateTodo?: (text: string) => void
  onCompact?: () => void
  /** 将单条 Agent 历史选区写为当前 RichTextInput 的内联 mention。 */
  onAddHistoryQuote?: (quote: QuotedSelection) => boolean
  /** 已发送的 Agent 历史引用 chip 点击后请求定位与高亮。 */
  onAgentHistoryQuoteClick?: (quote: QuotedSelection) => void
  /** 输入框 quote chip 请求定位时的精确范围。 */
  historyQuoteNavigation?: AgentHistoryQuoteNavigationRequest | null
}

const AGENT_HISTORY_QUOTE_HIGHLIGHT_NAME = 'proma-agent-history-quote'

interface TextPosition {
  node: Node
  offset: number
}

interface CustomHighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => boolean
}

type HighlightConstructor = new (...ranges: Range[]) => unknown

function getMessageTextPosition(messageElement: HTMLElement, offset: number): TextPosition | null {
  if (!Number.isInteger(offset) || offset < 0) return null

  const walker = document.createTreeWalker(messageElement, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let lastTextNode: Node | null = null
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (offset <= consumed + length) {
      return { node, offset: offset - consumed }
    }
    consumed += length
    lastTextNode = node
    node = walker.nextNode()
  }

  if (offset === consumed && lastTextNode) {
    return { node: lastTextNode, offset: lastTextNode.textContent?.length ?? 0 }
  }
  return null
}

function getAgentHistoryQuoteRange(messageElement: HTMLElement, quote: QuotedSelection): Range | null {
  if (
    quote.sourceType !== 'agent-history'
    || quote.selectionStart == null
    || quote.selectionEnd == null
    || quote.selectionEnd <= quote.selectionStart
  ) {
    return null
  }

  const start = getMessageTextPosition(messageElement, quote.selectionStart)
  const end = getMessageTextPosition(messageElement, quote.selectionEnd)
  if (!start || !end) return null

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

function getCustomHighlightRegistry(): CustomHighlightRegistry | undefined {
  return (globalThis.CSS as unknown as { highlights?: CustomHighlightRegistry }).highlights
}

function applyAgentHistoryQuoteHighlight(range: Range): boolean {
  const registry = getCustomHighlightRegistry()
  const Highlight = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight
  if (registry && Highlight) {
    registry.set(AGENT_HISTORY_QUOTE_HIGHLIGHT_NAME, new Highlight(range))
    return false
  }

  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return true
}

/** 空状态引导 — 使用 WelcomeEmptyState */
function EmptyState(): React.ReactElement {
  return <WelcomeEmptyState />
}

function AssistantLogo({ model, channelId }: { model?: string; channelId?: string }): React.ReactElement {
  const channels = useAtomValue(channelsAtom)
  if (model) {
    return (
      <img
        src={getModelLogo(model, resolveModelProvider(model, channels, channelId))}
        alt={model}
        className="size-[35px] rounded-[25%] object-cover"
      />
    )
  }
  return (
    <div className="size-[35px] rounded-[25%] bg-primary/10 flex items-center justify-center">
      <Bot size={18} className="text-primary" />
    </div>
  )
}

/** 重试提示组件 - 折叠式 */
function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  // 仅 scheduled 阶段显示倒计时：此时 Pi 仍在 backoff，尚未重新发起模型请求。
  React.useEffect(() => {
    if (retrying.phase !== 'scheduled' || retrying.scheduledAt == null || retrying.delaySeconds == null) {
      setCountdown(0)
      return
    }

    const updateCountdown = (): void => {
      const elapsed = (Date.now() - retrying.scheduledAt!) / 1_000
      setCountdown(Math.ceil(Math.max(0, retrying.delaySeconds! - elapsed)))
    }

    updateCountdown()
    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.delaySeconds, retrying.phase, retrying.scheduledAt])

  const statusText = (() => {
    const suffix = `第 ${retrying.currentAttempt}/${retrying.maxAttempts} 次继续当前回答`
    switch (retrying.phase) {
      case 'scheduled':
        return countdown > 0 ? `网络暂时中断，${countdown} 秒后开始${suffix}` : `网络暂时中断，即将开始${suffix}`
      case 'running':
        return `正在${suffix}…`
      case 'succeeded':
        return `已在${suffix}时恢复`
      case 'exhausted':
        return retrying.totalAttempt != null && retrying.maxTotalAttempts != null
          ? `本轮自动恢复已耗尽（${retrying.totalAttempt}/${retrying.maxTotalAttempts}）`
          : `自动恢复已耗尽（${retrying.currentAttempt}/${retrying.maxAttempts}）`
      case 'cancelled':
        return '自动恢复已取消'
    }
  })()

  const isTerminal = retrying.phase === 'exhausted' || retrying.phase === 'cancelled'

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-3 mb-3">
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
        onClick={() => setExpanded(!expanded)}
      >
        {retrying.phase === 'succeeded' ? (
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : isTerminal ? (
          retrying.phase === 'cancelled'
            ? <Ban className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            : <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <RotateCw className="size-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
        )}
        <span className="text-sm text-amber-900 dark:text-amber-100 flex-1 tabular-nums">
          {statusText}
          {retrying.reason && ` · ${retrying.reason}`}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-amber-200 dark:border-amber-800 pt-3">
          {retrying.maxTotalAttempts != null && (
            <div className="text-xs text-amber-700 dark:text-amber-300 tabular-nums">
              本轮已安排 {retrying.totalAttempt ?? 0}/{retrying.maxTotalAttempts} 次自动恢复
            </div>
          )}
          {retrying.history.length > 0 && (
            <>
              <div className="text-xs font-medium text-amber-900 dark:text-amber-100">
                已执行的恢复记录：
              </div>
              {retrying.history.map((attempt, index) => (
                <RetryAttemptItem
                  key={attempt.attempt}
                  attempt={attempt}
                  isLatest={index === retrying.history.length - 1}
                />
              ))}
            </>
          )}
          {retrying.phase === 'scheduled' && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 pl-6 tabular-nums">
              <RotateCw className="size-3 animate-spin" />
              <span>{countdown > 0 ? `等待 ${countdown} 秒后开始第 ${retrying.currentAttempt} 次继续当前回答` : `即将开始第 ${retrying.currentAttempt} 次继续当前回答`}</span>
            </div>
          )}
          {retrying.phase === 'running' && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 pl-6 tabular-nums">
              <RotateCw className="size-3 animate-spin" />
              <span>正在执行第 {retrying.currentAttempt} 次继续当前回答…</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 单条重试尝试记录 */
function RetryAttemptItem({
  attempt,
  isLatest,
}: {
  attempt: RetryAttempt
  isLatest: boolean
}): React.ReactElement {
  const [showStderr, setShowStderr] = React.useState(false)
  const [showStack, setShowStack] = React.useState(false)

  const time = new Date(attempt.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <div className={cn('pl-6 space-y-2', isLatest && 'font-medium')}>
      {/* 尝试头部 */}
      <div className="flex items-start gap-2">
        <span className="text-destructive shrink-0">❌</span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs text-amber-900 dark:text-amber-100 tabular-nums">
            第 {attempt.attempt} 次恢复前的错误（{time}）- {attempt.reason}
          </div>
          <div className="text-xs text-amber-700 dark:text-amber-300 font-mono break-words">
            {attempt.errorMessage}
          </div>

          {/* 环境信息 */}
          {attempt.environment && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
              <div>运行时: {attempt.environment.runtime}</div>
              <div>平台: {attempt.environment.platform}</div>
              <div>模型: {attempt.environment.model}</div>
              {attempt.environment.workspace && <div>项目: {attempt.environment.workspace}</div>}
            </div>
          )}

          {/* 可展开的 stderr */}
          {attempt.stderr && (
            <div className="mt-2">
              <button
                type="button"
                className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1"
                onClick={() => setShowStderr(!showStderr)}
              >
                {showStderr ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示 stderr 输出
              </button>
              {showStderr && (
                <pre className="mt-1 text-[10px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                  {attempt.stderr}
                </pre>
              )}
            </div>
          )}

          {/* 可展开的堆栈跟踪 */}
          {attempt.stack && (
            <div className="mt-2">
              <button
                type="button"
                className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1"
                onClick={() => setShowStack(!showStack)}
              >
                {showStack ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                显示堆栈跟踪
              </button>
              {showStack && (
                <pre className="mt-1 text-[10px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                  {attempt.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 格式化耗时（毫秒 → 可读字符串） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toFixed(0)}s`
}

/** 构建 usage tooltip 多行文本 */
export function buildUsageTooltip(durationMs: number, usage?: AgentEventUsage): string {
  const lines: string[] = []
  lines.push(`耗时: ${formatDuration(durationMs)}`)

  if (usage) {
    const pureInput = (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheCreationTokens ?? 0)
    if (pureInput > 0) lines.push(`输入: ${pureInput.toLocaleString()}`)
    if (usage.outputTokens) lines.push(`输出: ${usage.outputTokens.toLocaleString()}`)
    if (usage.cacheCreationTokens) lines.push(`缓存写入: ${usage.cacheCreationTokens.toLocaleString()}`)
    if (usage.cacheReadTokens) lines.push(`缓存读取: ${usage.cacheReadTokens.toLocaleString()}`)
  }

  return lines.join('\n')
}

/** 耗时徽章 — 悬浮显示 token 用量明细 */
export function DurationBadge({ durationMs, usage }: { durationMs: number; usage?: AgentEventUsage }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[15px] tabular-nums font-light cursor-default">
          {formatDuration(durationMs)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="whitespace-pre-line text-left">{buildUsageTooltip(durationMs, usage)}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Agent 运行指示器 — Shimmer Spinner + 无括号的运行时间 */
function AgentRunningIndicator({ startedAt }: { startedAt?: number }): React.ReactElement {
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    const start = startedAt ?? Date.now()
    const update = (): void => setElapsed((Date.now() - start) / 1000)
    update()
    const timer = setInterval(update, 100)
    return () => clearInterval(timer)
  }, [startedAt])

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s.toFixed(1)}s`
  }

  return (
    <div className="flex items-center gap-2 min-h-[28px]">
      <Spinner size="sm" className="text-primary/75" />
      <span className="text-[13px] font-light text-muted-foreground/75 tabular-nums">Agent Running {formatTime(elapsed)}</span>
    </div>
  )
}

interface AgentTranscriptTailProps {
  sessionId: string
  sessionModelId?: string
  finalGroup?: AssistantTurn
  finalGroupStreaming: boolean
  /** 运行中在当前 partial 之后注入、但尚未等到前一 assistant stable final 的用户边界。 */
  pendingBoundaryGroups: MessageGroup[]
  groupHistoryTurns: Map<MessageGroup, number>
  allMessages: SDKMessage[]
  externalMetadataSignature: string
  basePath?: string
  historyTurn: number
  running: boolean
  retrying?: AgentStreamState['retrying']
  startedAt?: number
  suppressRunning: boolean
  streamingModel?: string
  streamingModelId?: string
  streamingChannelId?: string
  stoppedByUser?: boolean
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onAgentHistoryQuoteClick?: (quote: QuotedSelection) => void
  onCreateTodo?: (text: string) => void
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
  onRelinkProjectRoot?: () => void
  onRestoreProjectRoot?: () => void
}

function mergeAssistantTurns(finalGroup: AssistantTurn, previewGroup: AssistantTurn): AssistantTurn {
  return {
    ...finalGroup,
    assistantMessages: [...finalGroup.assistantMessages, ...previewGroup.assistantMessages],
    turnMessages: [...finalGroup.turnMessages, ...previewGroup.turnMessages],
    model: previewGroup.model ?? finalGroup.model,
    channelId: previewGroup.channelId ?? finalGroup.channelId,
  }
}

/**
 * 当前 turn 的唯一 React 槽位。partial → final 始终在这里替换，避免跨父节点重挂载。
 * 高频 canonical store 也只在这个子树中订阅。
 */
const AgentTranscriptTail = React.memo(function AgentTranscriptTail({
  sessionId,
  sessionModelId,
  finalGroup,
  finalGroupStreaming,
  pendingBoundaryGroups,
  groupHistoryTurns,
  allMessages,
  externalMetadataSignature,
  basePath,
  historyTurn,
  running,
  retrying,
  startedAt,
  suppressRunning,
  streamingModel,
  streamingModelId,
  streamingChannelId,
  stoppedByUser,
  onFork,
  onRewind,
  onAgentHistoryQuoteClick,
  onCreateTodo,
  onRetry,
  onRetryInNewSession,
  onCompact,
  onRelinkProjectRoot,
  onRestoreProjectRoot,
}: AgentTranscriptTailProps): React.ReactElement | null {
  const liveTranscriptMessages = useAgentLiveTranscriptMessages(sessionId)
  const previewGroup = React.useMemo(
    () => groupIntoTurns(liveTranscriptMessages, sessionModelId)
      .findLast((group): group is AssistantTurn => group.type === 'assistant-turn'),
    [liveTranscriptMessages, sessionModelId],
  )
  // 只有 finalGroup 已属于当前 live run 时才能与 preview 原地交接；external/headless
  // run 在 user boundary 到达前不得把新回答并入上一轮历史 assistant。
  const shouldMerge = Boolean(finalGroup && previewGroup && finalGroupStreaming)
  const stablePreviousGroup = finalGroup && previewGroup && !shouldMerge ? finalGroup : undefined
  const rawGroup = shouldMerge
    ? mergeAssistantTurns(finalGroup!, previewGroup!)
    : previewGroup ?? finalGroup
  const group = applyOptimisticAssistantTurnMetadata(rawGroup, streamingModelId, streamingChannelId)
  const isStreaming = previewGroup !== undefined || (finalGroupStreaming && !stablePreviousGroup)
  const isErrorGroup = group?.assistantMessages.some((message) => !!message.error) ?? false
  const disableActions = isStreaming && !isErrorGroup
  const showRunningState = !suppressRunning && (running || retrying !== undefined)

  if (!group && !showRunningState && pendingBoundaryGroups.length === 0) return null

  return (
    <>
      {stablePreviousGroup && (
        <MessageGroupRenderer
          group={stablePreviousGroup}
          allMessages={allMessages}
          externalMetadataSignature={externalMetadataSignature}
          basePath={basePath}
          onFork={onFork}
          onRewind={onRewind}
          onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
          onCreateTodo={onCreateTodo}
          onRetry={onRetry}
          onRetryInNewSession={onRetryInNewSession}
          onCompact={onCompact}
          onRelinkProjectRoot={onRelinkProjectRoot}
          onRestoreProjectRoot={onRestoreProjectRoot}
          historyTurn={historyTurn}
          stoppedByUser={stoppedByUser || undefined}
          sessionModelId={sessionModelId}
        />
      )}
      {group && (
        <MessageGroupRenderer
          group={group}
          allMessages={allMessages}
          externalMetadataSignature={externalMetadataSignature}
          basePath={basePath}
          onFork={disableActions ? undefined : onFork}
          onRewind={disableActions ? undefined : onRewind}
          onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
          onCreateTodo={disableActions ? undefined : onCreateTodo}
          onRetry={disableActions ? undefined : onRetry}
          onRetryInNewSession={disableActions ? undefined : onRetryInNewSession}
          onCompact={disableActions ? undefined : onCompact}
          onRelinkProjectRoot={disableActions ? undefined : onRelinkProjectRoot}
          onRestoreProjectRoot={disableActions ? undefined : onRestoreProjectRoot}
          historyTurn={stablePreviousGroup ? historyTurn + 1 : historyTurn}
          isStreaming={isStreaming || undefined}
          stoppedByUser={!isStreaming && stoppedByUser ? true : undefined}
          sessionModelId={sessionModelId}
        />
      )}
      {pendingBoundaryGroups.map((boundaryGroup, index) => (
        <MessageGroupRenderer
          key={getGroupId(boundaryGroup)}
          group={boundaryGroup}
          allMessages={EMPTY_SDK_MESSAGES}
          externalMetadataSignature=""
          basePath={basePath}
          onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
          historyTurn={groupHistoryTurns.get(boundaryGroup) ?? historyTurn + index + 1}
          sessionModelId={sessionModelId}
        />
      ))}
      {showRunningState && (group || pendingBoundaryGroups.length > 0 ? (
        <div className="pl-[56px] min-h-[28px]">
          {retrying && <RetryingNotice retrying={retrying} />}
          {running && <AgentRunningIndicator startedAt={startedAt} />}
        </div>
      ) : (
        <Message from="assistant">
          <MessageHeader
            model={streamingModel}
            time={formatMessageTime(Date.now())}
            logo={<AssistantLogo model={streamingModelId} channelId={streamingChannelId} />}
          />
          <MessageContent>
            {retrying && <RetryingNotice retrying={retrying} />}
            {running && <AgentRunningIndicator startedAt={startedAt} />}
          </MessageContent>
        </Message>
      ))}
    </>
  )
})

export const AgentMessages = React.memo(function AgentMessages({
  sessionId,
  sessionModelId,
  messagesLoaded,
  persistedSDKMessages,
  hasEarlierMessages,
  loadingEarlierMessages,
  onLoadEarlierMessages,
  sessionPath,
  attachedDirs,
  stoppedByUser,
  onRetry,
  onRetryInNewSession,
  onRelinkProjectRoot,
  onRestoreProjectRoot,
  onFork,
  onRewind,
  onCreateTodo,
  onCompact,
  onAddHistoryQuote,
  onAgentHistoryQuoteClick,
  historyQuoteNavigation,
}: AgentMessagesProps): React.ReactElement {
  // 高频 token/live message 状态在历史区内闭环，避免唤醒 AgentView 输入框和工具栏。
  const streamState = useAtomValue(agentSessionMessagesStreamStateAtomFamily(sessionId))
  const liveMessages = useAtomValue(agentLiveMessagesAtomFamily(sessionId))
  const streaming = streamState.running
  const userProfile = useAtomValue(userProfileAtom)
  const setMinimapCache = useSetAtom(tabMinimapCacheAtom)
  const channels = useAtomValue(channelsAtom)
  const historySelectionRootRef = React.useRef<HTMLDivElement>(null)
  const selectionHighlightUsesBrowserSelectionRef = React.useRef(false)
  const clearHistoryQuoteHighlight = React.useCallback((): void => {
    getCustomHighlightRegistry()?.delete(AGENT_HISTORY_QUOTE_HIGHLIGHT_NAME)
    if (selectionHighlightUsesBrowserSelectionRef.current) {
      window.getSelection()?.removeAllRanges()
      selectionHighlightUsesBrowserSelectionRef.current = false
    }
  }, [])
  // 切换 Tab 时直接展示内存缓存或正在运行的实时消息，不等待异步持久化加载或下一帧淡入。
  const ready = messagesLoaded !== false || (streaming && liveMessages.length > 0)

  React.useEffect(() => {
    const root = historySelectionRootRef.current
    if (!root) return
    const clearOnPointerDown = (): void => {
      // 仅清理已存在的高亮；不读取 Selection 或触发历史渲染。
      clearHistoryQuoteHighlight()
    }
    // 保留根外点击的高亮清理；该监听不参与选区捕获热路径。
    document.addEventListener('pointerdown', clearOnPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', clearOnPointerDown, true)
      clearHistoryQuoteHighlight()
    }
  }, [clearHistoryQuoteHighlight])

  React.useEffect(() => {
    clearHistoryQuoteHighlight()
    if (
      !historyQuoteNavigation
      || historyQuoteNavigation.sessionId !== sessionId
      || historyQuoteNavigation.quote.sourceType !== 'agent-history'
      || !historyQuoteNavigation.quote.messageId
    ) {
      return
    }

    const navigation = historyQuoteNavigation
    const frame = window.requestAnimationFrame(() => {
      const root = historySelectionRootRef.current
      if (!root) return
      const target = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (element) => element.dataset.messageId === navigation.quote.messageId,
      )
      if (!target) return

      const range = getAgentHistoryQuoteRange(target, navigation.quote)
      if (!range) return
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      selectionHighlightUsesBrowserSelectionRef.current = applyAgentHistoryQuoteHighlight(range)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [clearHistoryQuoteHighlight, historyQuoteNavigation, sessionId])

  // 从 streamState 属性中计算派生值
  const streamingModelId = streamState?.model || sessionModelId
  const streamingChannelId = streamState?.channelId
  const agentStreamingModel = streamingModelId
    ? resolveModelDisplayName(streamingModelId, channels, streamingChannelId)
    : undefined
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt

  // 合并持久化 + 实时 SDKMessage；历史 group 后续仅接收本 turn 消息，避免全历史依赖扩散。
  const allSDKMessages = React.useMemo(() => {
    const persisted = persistedSDKMessages ?? []
    const live = liveMessages ?? []
    const stampStableKey = (message: SDKMessage): SDKMessage => {
      const key = getSDKMessageStableKey(message)
      ;(message as Record<string, unknown>)._promaStableKey = key
      return message
    }
    const keyOf = (message: SDKMessage): string =>
      (message as Record<string, unknown>)._promaStableKey as string

    const persistedWithKeys = persisted.map(stampStableKey)
    const liveWithKeys = live.map(stampStableKey)
    if (streaming || liveWithKeys.length === 0 || persistedWithKeys.length === 0) {
      return [...persistedWithKeys, ...liveWithKeys]
    }

    // 流式结束后的刷新中，持久化消息尾部可能已经包含 live 序列。
    // 只替换有序尾部重叠，避免按内容全局去重误删历史中的相同问答。
    let overlap = Math.min(persistedWithKeys.length, liveWithKeys.length)
    for (; overlap > 0; overlap--) {
      const persistedStart = persistedWithKeys.length - overlap
      const liveStart = liveWithKeys.length - overlap
      let matches = true
      for (let i = 0; i < overlap; i++) {
        if (keyOf(persistedWithKeys[persistedStart + i]!) !== keyOf(liveWithKeys[liveStart + i]!)) {
          matches = false
          break
        }
      }
      if (matches) break
    }

    if (overlap === 0) return [...persistedWithKeys, ...liveWithKeys]
    return [
      ...persistedWithKeys.slice(0, persistedWithKeys.length - overlap),
      ...liveWithKeys,
    ]
  }, [persistedSDKMessages, liveMessages, streaming])
  const hasContent = allSDKMessages.length > 0
  // 跨 turn task_notification 是历史 Task 卡片唯一需要追踪的外部元数据。
  // 普通 token/live snapshot 不改变此签名，MessageGroupRenderer comparator 因而可忽略全消息数组新引用。
  const taskNotificationSignature = React.useMemo(() => (
    allSDKMessages
      .filter((message) => message.type === 'system' && message.subtype === 'task_notification')
      .map((message) => getSDKMessageStableKey(message))
      .join('\u0000')
  ), [allSDKMessages])

  // 仅扫描当前 live turn；不从持久化历史恢复任务，避免跨 turn 显示旧进度。
  const liveTaskActivities = React.useMemo(() => {
    const liveGroups = groupIntoTurns(liveMessages ?? [], sessionModelId)
    const currentTurn = [...liveGroups].reverse().find((group) => group.type === 'assistant-turn')
    return currentTurn ? buildTaskProgressDataForTurn(currentTurn).taskActivities : []
  }, [liveMessages, sessionModelId])

  const contextCompaction = React.useMemo(
    () => getContextCompactionProgress(liveMessages ?? [], streamState?.isCompacting, streamState?.contextCompaction),
    [liveMessages, streamState?.isCompacting, streamState?.contextCompaction],
  )
  // 压缩流程进行中（含收尾窗口：compact_boundary 已到但 result 未到）
  // → 抑制 AgentRunningIndicator，避免压缩分隔符切换期间闪烁。
  // Pi 同一 stream 续跑后，getContextCompactionProgress 会清除终态反馈；此时即使旧标记尚未刷新，
  // 也必须恢复正常运行指示器。
  const suppressAgentRunning = streamState?.isCompacting
    || (streamState?.compactInFlight && contextCompaction != null)

  // 流式更新只重新分组当前 turn；已完成历史复用 group 引用，使 memoized renderer
  // 跳过历史 Markdown/代码高亮/工具结果树。非流式刷新仍保持完整 groupIntoTurns 语义。
  const messageGroupCacheRef = React.useRef(createMessageGroupRenderCache())
  const allGroups = React.useMemo(() => {
    const result = groupMessagesForRendering(
      allSDKMessages,
      sessionModelId,
      streaming,
      messageGroupCacheRef.current,
    )
    messageGroupCacheRef.current = result.cache
    return result.groups
  }, [allSDKMessages, sessionModelId, streaming])
  // 压缩过程由底部 Progress Overlay 独立承载，不占用对话历史、迷你地图或用户锚点。
  const visibleGroups = React.useMemo(
    () => allGroups.filter((group) => !isCompactionControlHistoryGroup(group)),
    [allGroups],
  )
  // queue/interrupt 用户消息可能先于当前 partial 的 stable final 进入 Jotai。它们先从
  // transcript 主序列拿出，交给稳定 tail 在 partial 之后渲染；final 到达后 listener 会
  // 原位插入 assistant 并解除用户边界标记，下一次分组自然恢复 canonical 顺序。
  const pendingBoundaryGroups = React.useMemo(
    () => visibleGroups.filter((group) => group.type === 'user'
      && (group.message as unknown as Record<string, unknown>)._promaPendingAfterLiveAssistant === true),
    [visibleGroups],
  )
  const orderedVisibleGroups = React.useMemo(
    () => pendingBoundaryGroups.length === 0
      ? visibleGroups
      : visibleGroups.filter((group) => !pendingBoundaryGroups.includes(group)),
    [pendingBoundaryGroups, visibleGroups],
  )
  // 最后一条 assistant turn 永久使用独立 tail 槽位；partial → final 不跨父节点迁移。
  const finalTailGroup = orderedVisibleGroups.at(-1)?.type === 'assistant-turn'
    ? orderedVisibleGroups.at(-1) as AssistantTurn
    : undefined
  const transcriptGroups = finalTailGroup ? orderedVisibleGroups.slice(0, -1) : orderedVisibleGroups

  // 标记哪些 group 属于实时流式消息（用于 isStreaming / onFork 差异化渲染）
  const liveGroupSet = React.useMemo(() => {
    return buildLiveGroupSet({
      allGroups,
      liveMessages,
      streaming,
      activeRunStartedAt: streamState?.startedAt,
    })
  }, [allGroups, liveMessages, streaming, streamState?.startedAt])

  const renderOrderedGroups = React.useMemo(
    () => [...orderedVisibleGroups, ...pendingBoundaryGroups],
    [orderedVisibleGroups, pendingBoundaryGroups],
  )
  // 迷你地图只追踪 immutable transcript，避免每个 token 更新 Tab 级缓存。
  const minimapItems: MinimapItem[] = React.useMemo(
    () => renderOrderedGroups.map((group) => ({
      id: getGroupId(group),
      role: group.type === 'user' ? 'user' as const
        : group.type === 'system' ? 'status' as const
        : 'assistant' as const,
      preview: getGroupPreview(group),
      avatar: group.type === 'user' ? userProfile.avatar : undefined,
      model: group.type === 'assistant-turn' ? group.model : undefined,
      channelId: group.type === 'assistant-turn' ? group.channelId : undefined,
    })),
    [renderOrderedGroups, userProfile.avatar]
  )

  // 同步 minimap 缓存到 Tab 级别（供 Tab hover 预览使用）
  React.useEffect(() => {
    if (minimapItems.length > 0) {
      setMinimapCache((prev) => {
        const next = new Map(prev)
        next.set(sessionId, minimapItems)
        return next
      })
    }
  }, [sessionId, minimapItems, setMinimapCache])

  // 所有用户消息的数据 — 供 StickyUserMessage 使用
  const allUserMessagesData = React.useMemo(() => {
    return renderOrderedGroups
      .filter((g): g is MessageGroup & { type: 'user' } => g.type === 'user')
      .map((g) => {
        const rawText = extractUserText(g.message) ?? ''
        const { files, text } = sdkParseAttachedFiles(rawText)
        return {
          id: getGroupId(g),
          text,
          attachments: files.map((f) => ({ filename: f.filename, isImage: sdkIsImageFile(f.filename) })),
        }
      })
  }, [renderOrderedGroups])

  const messageBasePaths = React.useMemo(
    () => [sessionPath, ...(attachedDirs ?? [])].filter((path): path is string => Boolean(path)),
    [sessionPath, attachedDirs],
  )

  // turn 在消息渲染时一次性标注到 DOM；历史划选只需读取锚点属性，绝不回扫全部消息。
  const groupHistoryTurns = React.useMemo(() => {
    let turn = 0
    const turns = new Map<MessageGroup, number>()
    for (const group of renderOrderedGroups) {
      if (group.type === 'user') turn += 1
      turns.set(group, Math.max(turn, 1))
    }
    return turns
  }, [renderOrderedGroups])
  const firstPendingBoundaryTurn = pendingBoundaryGroups[0]
    ? groupHistoryTurns.get(pendingBoundaryGroups[0])
    : undefined
  const tailHistoryTurn = finalTailGroup
    ? (groupHistoryTurns.get(finalTailGroup) ?? Math.max(allUserMessagesData.length, 1))
    : firstPendingBoundaryTurn != null
      ? Math.max(firstPendingBoundaryTurn - 1, 1)
      : Math.max(allUserMessagesData.length, 1)

  return (
    <BasePathsProvider basePaths={messageBasePaths}>
      <AgentBrowserLinkProvider sessionId={sessionId}>
        <div ref={historySelectionRootRef} className="relative flex min-h-0 flex-1 flex-col">
      <style>{`
        ::highlight(${AGENT_HISTORY_QUOTE_HIGHLIGHT_NAME}) {
          background-color: hsl(var(--primary) / 0.28);
          color: inherit;
        }
      `}</style>
          <Conversation
            resize="instant"
            className={ready ? 'opacity-100' : 'opacity-0'}
          >
        <ScrollPositionManager id={sessionId} ready={ready} />
        <ConversationContent>
          {hasEarlierMessages && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={onLoadEarlierMessages}
                disabled={loadingEarlierMessages || !onLoadEarlierMessages}
                className="titlebar-no-drag inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:cursor-wait disabled:opacity-60"
              >
                {loadingEarlierMessages && <Spinner size="sm" />}
                {loadingEarlierMessages ? '正在加载更早消息…' : '加载更早消息'}
              </button>
            </div>
          )}
          {!hasContent && !streaming ? (
            <EmptyState />
          ) : (
            <>
              {/* 统一消息渲染（持久化 + 实时合并为一个列表，确保 system 消息位置正确） */}
              {transcriptGroups.map((group) => {
                const isLive = liveGroupSet.has(group)
                const isErrorGroup = group.type === 'assistant-turn'
                  && group.assistantMessages.some((m) => !!m.error)
                const shouldDisableActions = isLive && !isErrorGroup
                const renderer = (
                  <MessageGroupRenderer
                    group={group}
                    allMessages={group.type === 'assistant-turn' ? allSDKMessages : EMPTY_SDK_MESSAGES}
                    externalMetadataSignature={group.type === 'assistant-turn' ? taskNotificationSignature : ''}
                    basePath={sessionPath || undefined}
                    onFork={shouldDisableActions ? undefined : onFork}
                    onRewind={shouldDisableActions ? undefined : onRewind}
                    onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
                    onCreateTodo={shouldDisableActions ? undefined : onCreateTodo}
                    onRetry={shouldDisableActions ? undefined : onRetry}
                    onRetryInNewSession={shouldDisableActions ? undefined : onRetryInNewSession}
                    onRelinkProjectRoot={shouldDisableActions ? undefined : onRelinkProjectRoot}
                    onRestoreProjectRoot={shouldDisableActions ? undefined : onRestoreProjectRoot}
                    onCompact={shouldDisableActions ? undefined : onCompact}
                    historyTurn={groupHistoryTurns.get(group)}
                    isStreaming={isLive || undefined}
                    sessionModelId={sessionModelId}
                  />
                )
                return <React.Fragment key={getGroupId(group)}>{renderer}</React.Fragment>
              })}

              <AgentTranscriptTail
                sessionId={sessionId}
                sessionModelId={sessionModelId}
                finalGroup={finalTailGroup}
                finalGroupStreaming={finalTailGroup ? liveGroupSet.has(finalTailGroup) : false}
                pendingBoundaryGroups={pendingBoundaryGroups}
                groupHistoryTurns={groupHistoryTurns}
                allMessages={allSDKMessages}
                externalMetadataSignature={taskNotificationSignature}
                basePath={sessionPath || undefined}
                historyTurn={tailHistoryTurn}
                running={streaming}
                retrying={retrying}
                startedAt={startedAt}
                suppressRunning={Boolean(suppressAgentRunning)}
                streamingModel={agentStreamingModel}
                streamingModelId={streamingModelId}
                streamingChannelId={streamingChannelId}
                stoppedByUser={!streaming && stoppedByUser}
                onFork={onFork}
                onRewind={onRewind}
                onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
                onCreateTodo={onCreateTodo}
                onRetry={onRetry}
                onRetryInNewSession={onRetryInNewSession}
                onCompact={onCompact}
                onRelinkProjectRoot={onRelinkProjectRoot}
                onRestoreProjectRoot={onRestoreProjectRoot}
              />

            </>
          )}
        </ConversationContent>
        <ScrollMinimap items={minimapItems} />
        <TaskProgressOverlay
          key={sessionId}
          activities={liveTaskActivities}
          streaming={streaming}
          contextCompaction={contextCompaction}
        />
        {allUserMessagesData.length > 0 && (
          <StickyUserMessage userMessages={allUserMessagesData} />
        )}
          </Conversation>
          <AgentHistorySelectionLayer
            sessionId={sessionId}
            rootRef={historySelectionRootRef}
            onAddToAgent={onAddHistoryQuote}
          />
        </div>
      </AgentBrowserLinkProvider>
    </BasePathsProvider>
  )
})
