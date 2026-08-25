/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 流式输出通过 SDK 渲染路径（MessageGroupRenderer）展示工具活动。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RotateCw, AlertTriangle, CheckCircle2, Ban, ChevronDown, ChevronRight } from 'lucide-react'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import {
  BasePathsProvider,
  Message,
  MessageContent,
  MessageHeader,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { StickyUserMessage } from '@/components/ai-elements/sticky-user-message'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { resolveModelDisplayName } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { ScrollPositionManager } from '@/hooks/useScrollPositionMemory'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupIntoTurns, AssistantLogo, MessageGroupRenderer, getGroupId, getGroupPreview, extractUserText, parseAttachedFiles as sdkParseAttachedFiles, isImageFile as sdkIsImageFile, buildTaskProgressDataForTurn, type MessageGroup } from './SDKMessageRenderer'
import { buildLiveGroupSet } from './live-group-set'
import { AgentBrowserLinkProvider } from '@/components/browser/AgentBrowserLinkProvider'
import { AgentHistorySelectionLayer } from './AgentHistorySelectionLayer'
import { TaskProgressOverlay, type ContextCompactionProgress } from './TaskProgressOverlay'
import { createMessageGroupRenderCache, groupMessagesForRendering } from './message-group-rendering'
import type { AgentEventUsage, RetryAttempt, SDKAssistantMessage, SDKMessage, SDKSystemMessage, SDKTextBlock, SDKThinkingBlock } from '@proma/shared'
import { getSDKCompactStatus } from '@proma/shared'
import { agentLiveMessagesAtomFamily, agentSessionStreamingStateAtomFamily, type AgentStreamState } from '@/atoms/agent-atoms'
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

function hasRenderableAssistantMessage(message: SDKAssistantMessage): boolean {
  if (message.error != null) return true

  return message.message.content.some((block) => {
    if (block.type === 'text') return Boolean((block as SDKTextBlock).text)
    if (block.type === 'thinking') return Boolean((block as SDKThinkingBlock).thinking)
    return true
  })
}

export function hasRenderableAssistantTurnContent(group: MessageGroup): boolean {
  return group.type === 'assistant-turn' && group.assistantMessages.some(hasRenderableAssistantMessage)
}

export function shouldRenderLiveAssistantTurn(group: MessageGroup, isLive: boolean): boolean {
  return !isLive || group.type !== 'assistant-turn' || hasRenderableAssistantTurnContent(group)
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
  /** 嵌入在右侧探索分支时关闭嵌套探索入口，避免没有容器的二级分叉。 */
  explorationEnabled?: boolean
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

interface AgentTranscriptHistoryHandle {
  scrollToMessage: (messageId: string, onMounted?: (target: HTMLElement) => void) => void
}

interface AgentTranscriptHistoryProps {
  groups: MessageGroup[]
  liveGroupSet: ReadonlySet<MessageGroup>
  allMessages: SDKMessage[]
  taskNotificationSignature: string
  sessionPath?: string | null
  sessionModelId?: string
  groupHistoryTurns: Map<string, number>
  streaming: boolean
  stoppedByUser?: boolean
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onAgentHistoryQuoteClick?: (quote: QuotedSelection) => void
  onCreateTodo?: (text: string) => void
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onRelinkProjectRoot?: () => void
  onRestoreProjectRoot?: () => void
  onCompact?: () => void
}

const EMPTY_LIVE_GROUP_SET: ReadonlySet<MessageGroup> = new Set()
const EMPTY_MESSAGE_GROUPS: MessageGroup[] = []

/**
 * 比较两批 group 的“结构身份”是否一致。
 *
 * 流式期间只有活跃 turn 的 group 是新引用，历史前缀由 stabilizeMessageGroups 保持原引用。
 * 因此这里以引用比较为主路径，只对确实变化的位置回退到 type/id 比较，避免每帧构造签名字符串。
 */
function haveSameGroupIdentities(previous: MessageGroup[], next: MessageGroup[]): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index++) {
    const previousGroup = previous[index]
    const nextGroup = next[index]
    if (previousGroup === nextGroup) continue
    if (!previousGroup || !nextGroup) return false
    if (previousGroup.type !== nextGroup.type) return false
    if (getGroupId(previousGroup) !== getGroupId(nextGroup)) return false
  }
  return true
}

function areTranscriptRowsEqual(
  previous: AgentTranscriptHistoryProps,
  next: AgentTranscriptHistoryProps,
): boolean {
  if (
    previous.groups.length !== next.groups.length
    || previous.liveGroupSet !== next.liveGroupSet
    || previous.taskNotificationSignature !== next.taskNotificationSignature
    || previous.sessionPath !== next.sessionPath
    || previous.sessionModelId !== next.sessionModelId
    || previous.streaming !== next.streaming
    || previous.stoppedByUser !== next.stoppedByUser
    || previous.onFork !== next.onFork
    || previous.onRewind !== next.onRewind
    || previous.onAgentHistoryQuoteClick !== next.onAgentHistoryQuoteClick
    || previous.onCreateTodo !== next.onCreateTodo
    || previous.onRetry !== next.onRetry
    || previous.onRetryInNewSession !== next.onRetryInNewSession
    || previous.onRelinkProjectRoot !== next.onRelinkProjectRoot
    || previous.onRestoreProjectRoot !== next.onRestoreProjectRoot
    || previous.onCompact !== next.onCompact
  ) {
    return false
  }
  return previous.groups.every((group, index) => group === next.groups[index])
}

const AgentTranscriptRows = React.memo(function AgentTranscriptRows({
  groups,
  liveGroupSet,
  allMessages,
  taskNotificationSignature,
  sessionPath,
  sessionModelId,
  groupHistoryTurns,
  streaming,
  stoppedByUser,
  onFork,
  onRewind,
  onAgentHistoryQuoteClick,
  onCreateTodo,
  onRetry,
  onRetryInNewSession,
  onRelinkProjectRoot,
  onRestoreProjectRoot,
  onCompact,
}: AgentTranscriptHistoryProps): React.ReactElement {
  const lastAssistantTurnIndex = React.useMemo(
    () => groups.findLastIndex((group) => group.type === 'assistant-turn'),
    [groups],
  )

  return (
    <>
      {groups.map((group, index) => {
        const isLive = liveGroupSet.has(group)
        const isErrorGroup = group.type === 'assistant-turn'
          && group.assistantMessages.some((message) => !!message.error)
        const shouldDisableActions = isLive && !isErrorGroup
        const isLastAssistantTurn = !streaming && stoppedByUser
          && group.type === 'assistant-turn'
          && index === lastAssistantTurnIndex
        const groupId = getGroupId(group)

        return (
          <div key={groupId} className="w-full pb-1">
            <MessageGroupRenderer
              group={group}
              allMessages={group.type === 'assistant-turn' ? allMessages : EMPTY_SDK_MESSAGES}
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
              historyTurn={groupHistoryTurns.get(groupId)}
              isStreaming={isLive || undefined}
              stoppedByUser={isLastAssistantTurn || undefined}
              sessionModelId={sessionModelId}
            />
          </div>
        )
      })}
    </>
  )
}, areTranscriptRowsEqual)

/**
 * Agent 历史消息使用普通 DOM 列表，避免滚动期间反复挂载和测量重型消息组件。
 * 稳定历史前缀与实时 tail 分开 memo，token 更新时不重新协调整个历史 DOM。
 */
const AgentTranscriptHistory = React.forwardRef<AgentTranscriptHistoryHandle, AgentTranscriptHistoryProps>(function AgentTranscriptHistory({
  groups,
  liveGroupSet,
  allMessages,
  taskNotificationSignature,
  sessionPath,
  sessionModelId,
  groupHistoryTurns,
  streaming,
  stoppedByUser,
  onFork,
  onRewind,
  onAgentHistoryQuoteClick,
  onCreateTodo,
  onRetry,
  onRetryInNewSession,
  onRelinkProjectRoot,
  onRestoreProjectRoot,
  onCompact,
}, ref): React.ReactElement {
  const { scrollRef, isAtBottom, stopScroll } = useStickToBottomContext()
  const previousLayoutRef = React.useRef<{
    count: number
    firstGroupId: string | undefined
    scrollHeight: number
    isAtBottom: boolean
  } | null>(null)

  const firstGroupId = groups[0] ? getGroupId(groups[0]) : undefined
  const groupCount = groups.length

  React.useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const previous = previousLayoutRef.current
    if (
      previous
      && previous.firstGroupId !== undefined
      && groupCount > previous.count
      && firstGroupId !== previous.firstGroupId
      && !previous.isAtBottom
    ) {
      const heightDelta = element.scrollHeight - previous.scrollHeight
      if (heightDelta > 0) element.scrollTop += heightDelta
    }

    previousLayoutRef.current = {
      count: groupCount,
      firstGroupId,
      scrollHeight: element.scrollHeight,
      isAtBottom,
    }
  }, [firstGroupId, groupCount, isAtBottom, scrollRef])

  const firstLiveIndex = groups.findIndex((group) => liveGroupSet.has(group))
  const historyEnd = firstLiveIndex >= 0 ? firstLiveIndex : groups.length
  const stableHistoryGroupsRef = React.useRef<MessageGroup[]>([])
  const historyGroups = React.useMemo(() => {
    const previous = stableHistoryGroupsRef.current
    if (
      previous.length === historyEnd
      && previous.every((group, index) => group === groups[index])
    ) {
      return previous
    }
    const next = groups.slice(0, historyEnd)
    stableHistoryGroupsRef.current = next
    return next
  }, [groups, historyEnd])
  const liveGroups = historyEnd < groups.length ? groups.slice(historyEnd) : EMPTY_MESSAGE_GROUPS

  React.useImperativeHandle(ref, () => ({
    scrollToMessage: (messageId, onMounted) => {
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])
        .find((element) => element.dataset.messageId === messageId)
      if (!target) return

      stopScroll()
      if (onMounted) {
        onMounted(target)
        return
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    },
  }), [scrollRef, stopScroll])

  return (
    <div className="w-full shrink-0">
      <AgentTranscriptRows
        groups={historyGroups}
        liveGroupSet={EMPTY_LIVE_GROUP_SET}
        allMessages={allMessages}
        taskNotificationSignature={taskNotificationSignature}
        sessionPath={sessionPath}
        sessionModelId={sessionModelId}
        groupHistoryTurns={groupHistoryTurns}
        streaming={false}
        stoppedByUser={liveGroups.length === 0 ? stoppedByUser : undefined}
        onFork={onFork}
        onRewind={onRewind}
        onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
        onCreateTodo={onCreateTodo}
        onRetry={onRetry}
        onRetryInNewSession={onRetryInNewSession}
        onRelinkProjectRoot={onRelinkProjectRoot}
        onRestoreProjectRoot={onRestoreProjectRoot}
        onCompact={onCompact}
      />
      {liveGroups.length > 0 && (
        <AgentTranscriptRows
          groups={liveGroups}
          liveGroupSet={liveGroupSet}
          allMessages={allMessages}
          taskNotificationSignature={taskNotificationSignature}
          sessionPath={sessionPath}
          sessionModelId={sessionModelId}
          groupHistoryTurns={groupHistoryTurns}
          streaming={streaming}
          stoppedByUser={stoppedByUser}
          onFork={onFork}
          onRewind={onRewind}
          onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
          onCreateTodo={onCreateTodo}
          onRetry={onRetry}
          onRetryInNewSession={onRetryInNewSession}
          onRelinkProjectRoot={onRelinkProjectRoot}
          onRestoreProjectRoot={onRestoreProjectRoot}
          onCompact={onCompact}
        />
      )}
    </div>
  )
})

export const AgentMessages = React.memo(function AgentMessages({
  sessionId,
  sessionModelId,
  messagesLoaded,
  persistedSDKMessages,
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
  explorationEnabled = true,
  onAgentHistoryQuoteClick,
  historyQuoteNavigation,
}: AgentMessagesProps): React.ReactElement {
  // 高频 token/live message 状态在历史区内闭环，避免唤醒 AgentView 输入框和工具栏。
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const liveMessages = useAtomValue(agentLiveMessagesAtomFamily(sessionId))
  const streaming = streamState?.running ?? false
  const userProfile = useAtomValue(userProfileAtom)
  const channels = useAtomValue(channelsAtom)
  const setMinimapCache = useSetAtom(tabMinimapCacheAtom)
  const historySelectionRootRef = React.useRef<HTMLDivElement>(null)
  const historyRef = React.useRef<AgentTranscriptHistoryHandle>(null)
  const visibleGroupsRef = React.useRef<MessageGroup[]>([])
  const selectionHighlightUsesBrowserSelectionRef = React.useRef(false)
  const clearHistoryQuoteHighlight = React.useCallback((): void => {
    getCustomHighlightRegistry()?.delete(AGENT_HISTORY_QUOTE_HIGHLIGHT_NAME)
    if (selectionHighlightUsesBrowserSelectionRef.current) {
      window.getSelection()?.removeAllRanges()
      selectionHighlightUsesBrowserSelectionRef.current = false
    }
  }, [])
  // 消息和布局恢复完成后才显示会话。隐藏期间不让用户看到 StickToBottom 初始化时
  // 可能出现的临时底部位置；显示前 ScrollPositionManager 已经直接设置了 scrollTop。
  const [readySessionId, setReadySessionId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (messagesLoaded === false) {
      setReadySessionId(null)
      return
    }
    setReadySessionId(sessionId)
  }, [messagesLoaded, sessionId])
  const ready = messagesLoaded !== false && readySessionId === sessionId

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
    const messageId = navigation.quote.messageId
    if (!messageId) return
    const frame = window.requestAnimationFrame(() => {
      const root = historySelectionRootRef.current
      if (!root) return

      const applyNavigation = (target: HTMLElement): void => {
        const range = getAgentHistoryQuoteRange(target, navigation.quote)
        if (!range) return
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        selectionHighlightUsesBrowserSelectionRef.current = applyAgentHistoryQuoteHighlight(range)
      }

      const targetIndex = visibleGroupsRef.current.findIndex((group) => getGroupId(group) === messageId)
      if (targetIndex >= 0) {
        historyRef.current?.scrollToMessage(messageId, applyNavigation)
        return
      }

      const target = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (element) => element.dataset.messageId === messageId,
      )
      if (target) applyNavigation(target)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [clearHistoryQuoteHighlight, historyQuoteNavigation, sessionId])

  // 实时文本仅从 liveMessages 读取。AgentStreamState 只保留运行/控制状态，
  // 避免每个 sdk_delta 同时更新 transcript 和 legacy content 两条路径。
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt
  const optimisticModelId = streamState?.model || sessionModelId
  const optimisticModel = optimisticModelId
    ? resolveModelDisplayName(optimisticModelId, channels)
    : undefined
  const optimisticTime = startedAt ? formatMessageTime(startedAt) : undefined

  // Agent 消息区不使用 StickToBottom 的 smooth resize。切换会话、虚拟列表测量和
  // 历史消息加载都必须立即定位，避免 ResizeObserver 触发滚动 spring 动画。
  // 合并持久化 + 实时 SDKMessage：同一 UUID 的 live 消息替换历史快照，避免
  // 历史会话快速续跑时 live atom 尚未清空而把同一 assistant 渲染两次。
  const allSDKMessages = React.useMemo(() => {
    const persisted = persistedSDKMessages ?? []
    const live = liveMessages ?? []
    const stampStableKey = (message: SDKMessage): SDKMessage => {
      const key = getSDKMessageStableKey(message)
      const record = message as Record<string, unknown>
      // 已标记且未变化时不重写：对老世代消息对象的属性写入会触发 GC 写屏障，
      // 在数百条历史 × 高频 partial 下形成持续开销。
      if (record._promaStableKey !== key) record._promaStableKey = key
      return message
    }
    const hasUuid = (message: SDKMessage): boolean => {
      const uuid = (message as Record<string, unknown>).uuid
      return typeof uuid === 'string' && uuid.length > 0
    }
    const result: SDKMessage[] = []
    const uuidIndexes = new Map<string, number>()
    const upsert = (message: SDKMessage): void => {
      const stamped = stampStableKey(message)
      if (hasUuid(stamped)) {
        const key = (stamped as Record<string, unknown>)._promaStableKey as string
        const existingIndex = uuidIndexes.get(key)
        if (existingIndex != null) {
          result[existingIndex] = stamped
          return
        }
        uuidIndexes.set(key, result.length)
      }
      result.push(stamped)
    }

    for (const message of persisted) upsert(message)
    for (const message of live) upsert(message)
    return result
  }, [persistedSDKMessages, liveMessages])
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
  // 标记哪些 group 属于实时流式消息（用于 isStreaming / onFork 差异化渲染）。
  // 该集合必须先于 visibleGroups 计算，让空 assistant snapshot 能在真正渲染前被过滤。
  const liveGroupSet = React.useMemo(() => {
    return buildLiveGroupSet({
      allGroups,
      liveMessages,
      streaming,
      activeRunStartedAt: streamState?.startedAt,
    })
  }, [allGroups, liveMessages, streaming, streamState?.startedAt])

  // 压缩过程由底部 Progress Overlay 独立承载，不占用对话历史、迷你地图或用户锚点。
  // Pi 的 text_start/thinking_start 会产生没有可见 DOM 的空内容块；过滤掉对应的 live turn，
  // 直到有实际内容时再交给 transcript 渲染，避免与乐观计时器壳重复显示 assistant header。
  const visibleGroups = React.useMemo(
    () => allGroups.filter((group) => (
      !isCompactionControlHistoryGroup(group)
      && shouldRenderLiveAssistantTurn(group, liveGroupSet.has(group))
    )),
    [allGroups, liveGroupSet],
  )
  visibleGroupsRef.current = visibleGroups

  // 结构派生（迷你地图、用户锚点、turn 编号、sticky 布局）只关心 group 身份，不关心流式 token。
  // 流式期间活跃 group 每帧都是新引用；若直接依赖 visibleGroups，getGroupPreview 与
  // parseAttachedFiles 的正则会按 partial 帧率重跑整段历史。此处在身份未变时保持旧数组引用，
  // 让这些派生只在真正新增/删除消息时重算。
  const structuralGroupsRef = React.useRef<MessageGroup[]>(visibleGroups)
  const structuralStreamingRef = React.useRef(streaming)
  // 流式开始/结束时必须刷新一次：活跃 group 的 id 不变但正文从空到完整，
  // 否则本轮迷你地图 preview 会永久停留在空值。
  if (
    structuralStreamingRef.current !== streaming
    || !haveSameGroupIdentities(structuralGroupsRef.current, visibleGroups)
  ) {
    structuralStreamingRef.current = streaming
    structuralGroupsRef.current = visibleGroups
  }
  const structuralGroups = structuralGroupsRef.current

  // 迷你地图数据 — 只依赖结构快照，流式 token 不触发 getGroupPreview 正则
  const minimapItems: MinimapItem[] = React.useMemo(
    () => structuralGroups.map((group) => ({
      id: getGroupId(group),
      role: group.type === 'user' ? 'user' as const
        : group.type === 'system' ? 'status' as const
        : 'assistant' as const,
      preview: getGroupPreview(group),
      avatar: group.type === 'user' ? userProfile.avatar : undefined,
      model: group.type === 'assistant-turn' ? group.model : undefined,
    })),
    [structuralGroups, userProfile.avatar]
  )

  // 同步 minimap 缓存到 Tab 级别（供 Tab hover 预览使用）。
  // 流式期间不写：本轮结束后统一同步一次，避免高频写入全局 atom 唤醒其他订阅者。
  React.useEffect(() => {
    if (streaming || minimapItems.length === 0) return
    setMinimapCache((prev) => {
      const next = new Map(prev)
      next.set(sessionId, minimapItems)
      return next
    })
  }, [sessionId, minimapItems, streaming, setMinimapCache])

  // 所有用户消息的数据 — 供 StickyUserMessage 使用；只依赖结构快照，
  // 避免流式期间重复解析已存在用户消息的附件标记。
  const allUserMessagesData = React.useMemo(() => {
    return structuralGroups
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
  }, [structuralGroups])

  // 只有 assistant turn 产生实际内容后，才把计时器从乐观消息壳迁移到历史区。
  // Pi 会先推送空 assistant snapshot；若立即迁移，空消息头会把计时器下推，
  // 直到首个过程/文本块到达才填补空白。
  const hasLiveAssistantContent = streaming
    ? allGroups.some((group) => liveGroupSet.has(group) && hasRenderableAssistantTurnContent(group))
    : (liveMessages != null && liveMessages.some((message) => (
      message.type === 'assistant' && hasRenderableAssistantMessage(message as SDKAssistantMessage)
    )))

  const messageBasePaths = React.useMemo(
    () => [sessionPath, ...(attachedDirs ?? [])].filter((path): path is string => Boolean(path)),
    [sessionPath, attachedDirs],
  )

  // turn 在消息渲染时一次性标注到 DOM；历史划选只需读取锚点属性，绝不回扫全部消息。
  const groupHistoryTurns = React.useMemo(() => {
    let turn = 0
    const turns = new Map<string, number>()
    for (const group of structuralGroups) {
      if (group.type === 'user') turn += 1
      turns.set(getGroupId(group), Math.max(turn, 1))
    }
    return turns
  }, [structuralGroups])

  const stickyLayoutSignature = React.useMemo(() => {
    const firstGroup = structuralGroups[0]
    return `${structuralGroups.length}:${firstGroup ? getGroupId(firstGroup) : ''}`
  }, [structuralGroups])

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
          <Conversation resize="instant" className={ready ? 'opacity-100' : 'opacity-0'}>
        <ScrollPositionManager id={sessionId} ready={ready} />
        <ConversationContent>
          {!hasContent && !streaming ? (
            <EmptyState />
          ) : (
            <>
              {/* 统一消息渲染（持久化 + 实时合并为一个列表，确保 system 消息位置正确） */}
              <AgentTranscriptHistory
                ref={historyRef}
                groups={visibleGroups}
                liveGroupSet={liveGroupSet}
                allMessages={allSDKMessages}
                taskNotificationSignature={taskNotificationSignature}
                sessionPath={sessionPath}
                sessionModelId={sessionModelId}
                groupHistoryTurns={groupHistoryTurns}
                streaming={streaming}
                stoppedByUser={stoppedByUser}
                onFork={onFork}
                onRewind={onRewind}
                onAgentHistoryQuoteClick={onAgentHistoryQuoteClick}
                onCreateTodo={onCreateTodo}
                onRetry={onRetry}
                onRetryInNewSession={onRetryInNewSession}
                onRelinkProjectRoot={onRelinkProjectRoot}
                onRestoreProjectRoot={onRestoreProjectRoot}
                onCompact={onCompact}
              />

              {/* 有实时助手内容时：显示运行指示器或占位（防止 streaming 结束到 Actions Bar 出现之间的高度跳动） */}
              {/* 不使用 mt：ConversationContent 的 gap-1(4px) 已提供间距，
                  匹配内部 MessageActions 的 gap-0.5(2px)+mt-0.5(2px)=4px 间距 */}
              {hasLiveAssistantContent && !suppressAgentRunning && (
                <div className="pl-[56px] min-h-[28px]">
                  {retrying && <RetryingNotice retrying={retrying} />}
                  {streaming && <AgentRunningIndicator startedAt={startedAt} />}
                </div>
              )}

              {/* 首个 live assistant block 到达前，先乐观渲染 assistant 外壳和 Logo；文本仍完全由 SDKMessage 渲染。 */}
              {!hasLiveAssistantContent && !suppressAgentRunning && (streaming || retrying) && (
                <Message from="assistant">
                  <MessageHeader
                    model={optimisticModel}
                    time={optimisticTime}
                    logo={<AssistantLogo model={optimisticModelId} />}
                  />
                  <MessageContent>
                    {retrying && <RetryingNotice retrying={retrying} />}
                    {streaming && <AgentRunningIndicator startedAt={startedAt} />}
                  </MessageContent>
                </Message>
              )}

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
          <StickyUserMessage
            userMessages={allUserMessagesData}
            layoutSignature={stickyLayoutSignature}
          />
        )}
          </Conversation>
          <AgentHistorySelectionLayer
            sessionId={sessionId}
            rootRef={historySelectionRootRef}
            onAddToAgent={onAddHistoryQuote}
            explorationEnabled={explorationEnabled}
          />
        </div>
      </AgentBrowserLinkProvider>
    </BasePathsProvider>
  )
})
