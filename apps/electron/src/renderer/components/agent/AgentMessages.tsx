/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 流式输出通过 SDK 渲染路径（MessageGroupRenderer）展示工具活动。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Bot, RotateCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageResponse,
  BasePathsProvider,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { StickyUserMessage } from '@/components/ai-elements/sticky-user-message'
import { useSmoothStream } from '@proma/ui'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { getModelLogo, resolveModelDisplayName } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { ScrollPositionManager } from '@/hooks/useScrollPositionMemory'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupIntoTurns, MessageGroupRenderer, getGroupId, getGroupPreview, extractUserText, parseAttachedFiles as sdkParseAttachedFiles, isImageFile as sdkIsImageFile, CompactingIndicator, type MessageGroup } from './SDKMessageRenderer'
import type { AgentEventUsage, RetryAttempt, SDKMessage } from '@proma/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  /** 用户在前端选择的模型 ID（用于显示渠道配置的 Model Name） */
  sessionModelId?: string
  /** 消息是否已完成首次加载 */
  messagesLoaded?: boolean
  /** Phase 4: 持久化的 SDKMessage（新格式） */
  persistedSDKMessages?: SDKMessage[]
  streaming: boolean
  streamState?: AgentStreamState
  /** Phase 2: 实时 SDKMessage 列表（流式期间累积） */
  liveMessages?: SDKMessage[]
  /** 当前会话工作目录，用于解析相对文件路径 */
  sessionPath?: string | null
  /** 附加目录列表（与 sessionPath 一并用作相对路径解析候选） */
  attachedDirs?: string[]
  /** 最后一轮是否被用户中断 */
  stoppedByUser?: boolean
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onCompact?: () => void
}

/** 空状态引导 — 使用 WelcomeEmptyState */
function EmptyState(): React.ReactElement {
  return <WelcomeEmptyState />
}

function AssistantLogo({ model }: { model?: string }): React.ReactElement {
  if (model) {
    return (
      <img
        src={getModelLogo(model)}
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

  // 倒计时逻辑
  React.useEffect(() => {
    if (retrying.failed || retrying.history.length === 0) {
      setCountdown(0)
      return
    }

    const lastAttempt = retrying.history[retrying.history.length - 1]
    if (!lastAttempt) return

    // 计算倒计时
    const updateCountdown = (): void => {
      const elapsed = (Date.now() - lastAttempt.timestamp) / 1000 // 已过去的秒数
      const remaining = Math.max(0, lastAttempt.delaySeconds - elapsed)
      setCountdown(Math.ceil(remaining))

      if (remaining <= 0) {
        setCountdown(0)
      }
    }

    // 立即更新一次
    updateCountdown()

    // 每 100ms 更新一次倒计时
    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.failed, retrying.history])

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-3 mb-3">
      {/* 头部：简洁状态 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
        onClick={() => setExpanded(!expanded)}
      >
        {retrying.failed ? (
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <RotateCw className="size-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
        )}
        <span className="text-sm text-amber-900 dark:text-amber-100 flex-1">
          {retrying.failed
            ? `重试失败 (${retrying.currentAttempt}/${retrying.maxAttempts})`
            : countdown > 0
              ? `重试倒计时 ${countdown}秒 (${retrying.currentAttempt}/${retrying.maxAttempts})`
              : `重试中 (${retrying.currentAttempt}/${retrying.maxAttempts})`}
          {retrying.history.length > 0 && ` · ${retrying.history[retrying.history.length - 1]?.reason}`}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        )}
      </button>

      {/* 展开内容：重试历史 */}
      {expanded && retrying.history.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-amber-200 dark:border-amber-800 pt-3">
          <div className="text-xs font-medium text-amber-900 dark:text-amber-100">
            尝试历史：
          </div>
          {retrying.history.map((attempt, index) => (
            <RetryAttemptItem
              key={attempt.timestamp}
              attempt={attempt}
              isLatest={index === retrying.history.length - 1}
              isFailed={retrying.failed && index === retrying.history.length - 1}
            />
          ))}
          {!retrying.failed && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 pl-6">
              {countdown > 0 ? (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>等待 {countdown} 秒后开始第 {retrying.currentAttempt} 次尝试</span>
                </>
              ) : (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>正在进行第 {retrying.currentAttempt} 次尝试...</span>
                </>
              )}
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
  isFailed,
}: {
  attempt: RetryAttempt
  isLatest: boolean
  isFailed: boolean
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
          <div className="text-xs text-amber-900 dark:text-amber-100">
            第 {attempt.attempt} 次 ({time}) - {attempt.reason}
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
              {attempt.environment.workspace && <div>工作区: {attempt.environment.workspace}</div>}
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
    const pureInput = usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheCreationTokens ?? 0)
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

export function AgentMessages({ sessionId, sessionModelId, messagesLoaded, persistedSDKMessages, streaming, streamState, liveMessages, sessionPath, attachedDirs, stoppedByUser, onRetry, onRetryInNewSession, onFork, onRewind, onCompact }: AgentMessagesProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const setMinimapCache = useSetAtom(tabMinimapCacheAtom)
  const channels = useAtomValue(channelsAtom)
  /** 淡入控制：切换会话时先隐藏，等布局完成后再显示。 */
  const [ready, setReady] = React.useState(false)
  const prevSessionIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      setReady(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (ready) return

    // 必须等消息加载完成，否则空 SDK 消息会被误判为空对话
    if (messagesLoaded === false) return

    // 流式进行中且有实时内容 → 跳过 fade 直接显示
    if (streaming && liveMessages && liveMessages.length > 0) {
      setReady(true)
      return
    }

    if ((!persistedSDKMessages || persistedSDKMessages.length === 0) && !streaming) {
      setReady(true)
      return
    }
    let cancelled = false
    requestAnimationFrame(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [streaming, liveMessages, persistedSDKMessages, messagesLoaded])

  // 从 streamState 属性中计算派生值
  const streamingContent = streamState?.content ?? ''
  const agentStreamingModel = streamState?.model ? resolveModelDisplayName(streamState.model, channels) : undefined
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt

  const { displayedContent: rawSmoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })

  // 防闪屏守卫：useSmoothStream 通过 useEffect 重置 displayedContent，比 render 晚一帧。
  // 当 streamingContent 已清空但 smoothContent 仍持有旧值时，
  // 会导致 fallback 气泡与持久化消息同时渲染一帧（重复内容闪烁）。
  // 用原始 streamingContent 作为守卫：内容已清空且不在流式中，立即归零。
  const smoothContent = (streaming || streamingContent) ? rawSmoothContent : ''

  /**
   * 流式完成过渡：streaming 结束到持久化消息加载完成之间，
   * 强制 resize="instant" 避免中间高度变化触发平滑滚动动画。
   *
   * 使用 render-phase 计算避免 useEffect 延迟一帧的问题：
   * - streaming 变 false 的第一帧就能立即切到 instant，防止闪动
   * - 后续通过 ref+timeout 延迟 150ms 才允许切回 smooth
   */
  const [transitioningCooldown, setTransitioningCooldown] = React.useState(false)
  const wasStreamingRef = React.useRef(streaming)

  // render-phase 判断：是否处于需要 instant resize 的过渡期
  // liveMessages 非空说明持久化消息还没加载完（加载完后会清空 liveMessages）
  const needsInstant = !streaming && (!!streamingContent || !!smoothContent || (liveMessages != null && liveMessages.length > 0))

  React.useEffect(() => {
    // 刚从 streaming → not-streaming：启动 cooldown
    if (wasStreamingRef.current && !streaming) {
      setTransitioningCooldown(true)
    }
    wasStreamingRef.current = streaming
  }, [streaming])

  React.useEffect(() => {
    if (needsInstant) return
    // 过渡完成后延迟 150ms 才关闭 cooldown，给 StickToBottom 时间稳定
    const timer = setTimeout(() => setTransitioningCooldown(false), 150)
    return () => clearTimeout(timer)
  }, [needsInstant])

  const transitioning = needsInstant || transitioningCooldown

  // 合并持久化 + 实时 SDKMessage（供 ContentBlock 内查找工具结果）
  const allSDKMessages = React.useMemo(() => {
    const persisted = persistedSDKMessages ?? []
    const live = liveMessages ?? []
    const liveSet = new Set(live)
    return [...persisted.filter(m => !liveSet.has(m)), ...live]
  }, [persistedSDKMessages, liveMessages])
  const hasContent = allSDKMessages.length > 0

  // 压缩流程进行中（含收尾窗口：compact_boundary 已到但 result 未到）
  // → 一律抑制 AgentRunningIndicator，避免压缩分隔符切换期间闪烁。
  // compactInFlight 从点击压缩 / SDK compacting 事件开始为 true，
  // 直到整个 stream 结束（stream state 被删除）才消失。
  const suppressAgentRunning = streamState?.isCompacting || streamState?.compactInFlight

  // 统一分组：将持久化 + 实时消息合并后再分组，确保 system 消息（如压缩分割线）出现在正确位置
  const allGroups = React.useMemo(() => {
    return groupIntoTurns(allSDKMessages, sessionModelId)
  }, [allSDKMessages, sessionModelId])

  // 标记哪些 group 属于实时流式消息（用于 isStreaming / onFork 差异化渲染）
  const liveGroupSet = React.useMemo(() => {
    if (!liveMessages || liveMessages.length === 0) return new Set<MessageGroup>()
    const liveSet = new Set<SDKMessage>(liveMessages)
    const result = new Set<MessageGroup>()
    for (const group of allGroups) {
      let isLive = false
      if (group.type === 'user' || group.type === 'system') {
        isLive = liveSet.has(group.message as SDKMessage)
      } else {
        // assistant-turn 可能被 mergeAdjacentSameModelTurns 合并，
        // 需检查任意一条 assistantMessage 是否来自实时流
        isLive = group.assistantMessages.some((m) => liveSet.has(m as SDKMessage))
      }
      if (isLive) result.add(group)
    }
    return result
  }, [allGroups, liveMessages])

  // 迷你地图数据 — 直接使用统一的 allGroups（无需去重）
  const minimapItems: MinimapItem[] = React.useMemo(
    () => allGroups.map((group) => ({
      id: getGroupId(group),
      role: group.type === 'user' ? 'user' as const
        : group.type === 'system' ? 'status' as const
        : 'assistant' as const,
      preview: getGroupPreview(group),
      avatar: group.type === 'user' ? userProfile.avatar : undefined,
      model: group.type === 'assistant-turn' ? group.model : undefined,
    })),
    [allGroups, userProfile.avatar]
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
    return allGroups
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
  }, [allGroups])

  // 实时消息中是否已有可渲染的助手内容
  const hasLiveAssistantContent = allGroups.some((g) => g.type === 'assistant-turn' && liveGroupSet.has(g))

  return (
    <BasePathsProvider basePaths={attachedDirs}>
    <Conversation resize={ready && !transitioning ? 'smooth' : 'instant'} className={ready ? 'opacity-100 transition-opacity duration-200' : 'opacity-0'}>
      <ScrollPositionManager id={sessionId} ready={ready} />
      <ConversationContent>
        {!hasContent && !streaming ? (
          <EmptyState />
        ) : (
          <>
            {/* 统一消息渲染（持久化 + 实时合并为一个列表，确保 system 消息位置正确） */}
            {allGroups.map((group, idx) => {
              const isLive = liveGroupSet.has(group)
              // 仅在最后一个 assistant-turn 上显示"已被用户中断" badge
              const isLastAssistantTurn = !streaming && stoppedByUser
                && group.type === 'assistant-turn'
                && idx === allGroups.findLastIndex((g) => g.type === 'assistant-turn')
              return (
                <MessageGroupRenderer
                  key={getGroupId(group)}
                  group={group}
                  allMessages={allSDKMessages}
                  basePath={sessionPath || undefined}
                  onFork={isLive ? undefined : onFork}
                  onRewind={isLive ? undefined : onRewind}
                  onRetry={isLive ? undefined : onRetry}
                  onRetryInNewSession={isLive ? undefined : onRetryInNewSession}
                  onCompact={isLive ? undefined : onCompact}
                  isStreaming={isLive || undefined}
                  stoppedByUser={isLastAssistantTurn || undefined}
                  sessionModelId={sessionModelId}
                />
              )
            })}

            {/* 有实时助手内容时：显示运行指示器或占位（防止 streaming 结束到 Actions Bar 出现之间的高度跳动） */}
            {/* 不使用 mt：ConversationContent 的 gap-1(4px) 已提供间距，
                匹配内部 MessageActions 的 gap-0.5(2px)+mt-0.5(2px)=4px 间距 */}
            {hasLiveAssistantContent && !suppressAgentRunning && (
              <div className="pl-[56px] min-h-[28px]">
                {retrying && <RetryingNotice retrying={retrying} />}
                {streaming && <AgentRunningIndicator startedAt={startedAt} />}
              </div>
            )}

            {/* 无实时助手内容时：显示完整气泡（含头像/名称/时间） */}
            {/* 注意：工具活动已通过 SDK 渲染路径（liveGroups）展示 */}
            {!hasLiveAssistantContent && !suppressAgentRunning && (streaming || smoothContent || retrying) && (
              <Message from="assistant">
                <MessageHeader
                  model={agentStreamingModel}
                  time={formatMessageTime(Date.now())}
                  logo={<AssistantLogo model={agentStreamingModel} />}
                />
                <MessageContent>
                  {retrying && <RetryingNotice retrying={retrying} />}
                  {smoothContent ? (
                    <>
                      <MessageResponse basePath={sessionPath || undefined} basePaths={attachedDirs}>{smoothContent}</MessageResponse>
                      {streaming && <AgentRunningIndicator startedAt={startedAt} />}
                    </>
                  ) : (
                    streaming && <AgentRunningIndicator startedAt={startedAt} />
                  )}
                </MessageContent>
              </Message>
            )}

            {/* 压缩中指示器：由 isCompacting flag 驱动的尾部元素，compact_boundary 到达时 flag 翻 false 自然消失，
                视觉上被流中新出现的"上下文已压缩"分隔符无缝替换 */}
            {streamState?.isCompacting && <CompactingIndicator />}

          </>
        )}
      </ConversationContent>
      <ScrollMinimap items={minimapItems} />
      <ConversationScrollButton />
      {allUserMessagesData.length > 0 && (
        <StickyUserMessage userMessages={allUserMessagesData} />
      )}
    </Conversation>
    </BasePathsProvider>
  )
}
