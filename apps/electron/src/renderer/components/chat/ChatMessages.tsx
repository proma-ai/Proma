/**
 * ChatMessages - 消息区域
 *
 * 使用 Conversation / ConversationContent / ConversationScrollButton 原语
 * 替代手动 scroll。支持上下文分隔线和并排模式切换。
 *
 * 功能：
 * - StickToBottom 自动滚动容器
 * - 遍历 messages → ChatMessageItem
 * - 消息间渲染 ContextDivider（根据 contextDividersAtom）
 * - streaming 时末尾显示临时 assistant 消息
 * - 并排模式切换到 ParallelChatMessages
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MessageSquare, Loader2, Brain, CheckCircle2, XCircle } from 'lucide-react'
import { ChatMessageItem, formatMessageTime } from './ChatMessageItem'
import type { InlineEditSubmitPayload } from './ChatMessageItem'
import { ParallelChatMessages } from './ParallelChatMessages'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageLoading,
  MessageResponse,
  StreamingIndicator,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { ContextDivider } from '@/components/ai-elements/context-divider'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import { useSmoothStream } from '@proma/ui'
import {
  currentMessagesAtom,
  streamingAtom,
  streamingContentAtom,
  streamingReasoningAtom,
  streamingModelAtom,
  streamingToolActivitiesAtom,
  contextDividersAtom,
  parallelModeAtom,
  hasMoreMessagesAtom,
  currentConversationIdAtom,
} from '@/atoms/chat-atoms'
import { getModelLogo } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import type { ChatMessage, ChatToolActivity } from '@proma/shared'
import { cn } from '@/lib/utils'

// ===== 记忆工具活动指示器 =====

/** 工具名称到中文标签的映射 */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  recall_memory: { running: '正在回忆…', done: '回忆完成' },
  add_memory: { running: '正在记住…', done: '已记住' },
}

function MemoryToolIndicator({ activities }: { activities: ChatToolActivity[] }): React.ReactElement | null {
  if (activities.length === 0) return null

  // 合并同一个 toolCallId 的 start/result 事件
  const merged = new Map<string, { toolName: string; done: boolean; isError?: boolean }>()
  for (const a of activities) {
    const existing = merged.get(a.toolCallId)
    if (a.type === 'start') {
      merged.set(a.toolCallId, { toolName: a.toolName, done: false })
    } else if (a.type === 'result') {
      merged.set(a.toolCallId, {
        toolName: existing?.toolName ?? a.toolName,
        done: true,
        isError: a.isError,
      })
    }
  }

  const items = Array.from(merged.values())
  if (items.length === 0) return null

  return (
    <div className="space-y-1 mb-2">
      {items.map((item, i) => {
        const label = TOOL_LABELS[item.toolName] ?? { running: item.toolName, done: item.toolName }
        return (
          <div
            key={i}
            className={cn(
              'flex items-center gap-1.5 text-xs text-muted-foreground',
              'animate-in fade-in slide-in-from-left-2 duration-200',
            )}
          >
            {!item.done ? (
              <Loader2 className="size-3 animate-spin text-primary" />
            ) : item.isError ? (
              <XCircle className="size-3 text-destructive" />
            ) : (
              <CheckCircle2 className="size-3 text-green-500" />
            )}
            <Brain className="size-3" />
            <span>{item.done ? (item.isError ? `${label.done}（失败）` : label.done) : label.running}</span>
          </div>
        )
      })}
    </div>
  )
}

// ===== 滚动到顶部加载更多 =====

interface ScrollTopLoaderProps {
  /** 是否还有更多历史消息 */
  hasMore: boolean
  /** 是否正在加载 */
  loading: boolean
  /** 加载更多回调 */
  onLoadMore: () => Promise<void>
}

/**
 * 滚动到顶部自动加载更多历史消息
 *
 * 挂在 Conversation（StickToBottom）内部，通过 context 获取滚动容器 ref，
 * 监听 scroll 事件，当滚动到顶部附近时触发加载。
 * 加载后恢复滚动位置，保证用户视角不变。
 */
function ScrollTopLoader({ hasMore, loading, onLoadMore }: ScrollTopLoaderProps): React.ReactElement | null {
  const { scrollRef } = useStickToBottomContext()
  const triggeredRef = React.useRef(false)

  // hasMore 变化时重置触发标记（例如切换对话）
  React.useEffect(() => {
    triggeredRef.current = false
  }, [hasMore])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !hasMore || triggeredRef.current) return

    const handleScroll = (): void => {
      // 滚动到顶部 100px 以内时触发
      if (el.scrollTop < 100 && !triggeredRef.current) {
        triggeredRef.current = true
        const prevHeight = el.scrollHeight

        onLoadMore().then(() => {
          // 加载完成后恢复滚动位置：新内容插入顶部，保持用户视角不变
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight - prevHeight
          })
        })
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollRef, hasMore, onLoadMore])

  if (!hasMore) return null

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return null
}

// ===== 主组件 =====

interface ChatMessagesProps {
  /** 删除消息回调 */
  onDeleteMessage?: (messageId: string) => Promise<void>
  /** 重新发送消息回调 */
  onResendMessage?: (message: ChatMessage) => Promise<void>
  /** 开始原地编辑消息 */
  onStartInlineEdit?: (message: ChatMessage) => void
  /** 提交原地编辑 */
  onSubmitInlineEdit?: (message: ChatMessage, payload: InlineEditSubmitPayload) => Promise<void>
  /** 取消原地编辑 */
  onCancelInlineEdit?: () => void
  /** 当前正在编辑的消息 ID */
  inlineEditingMessageId?: string | null
  /** 删除分隔线回调 */
  onDeleteDivider?: (messageId: string) => void
  /** 加载更多历史消息回调 */
  onLoadMore?: () => Promise<void>
}

/** 空状态引导 */
function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <MessageSquare size={24} className="text-muted-foreground/60" />
        </div>
        <p className="text-sm">在下方输入框开始对话</p>
      </div>
    </div>
  )
}

export function ChatMessages({
  onDeleteMessage,
  onResendMessage,
  onStartInlineEdit,
  onSubmitInlineEdit,
  onCancelInlineEdit,
  inlineEditingMessageId,
  onDeleteDivider,
  onLoadMore,
}: ChatMessagesProps): React.ReactElement {
  const messages = useAtomValue(currentMessagesAtom)
  const userProfile = useAtomValue(userProfileAtom)
  const streaming = useAtomValue(streamingAtom)
  const streamingContent = useAtomValue(streamingContentAtom)
  const streamingReasoning = useAtomValue(streamingReasoningAtom)
  const toolActivities = useAtomValue(streamingToolActivitiesAtom)

  // 平滑流式输出：将高频 atom 更新转为逐字渲染
  const { displayedContent: smoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })
  const { displayedContent: smoothReasoning } = useSmoothStream({
    content: streamingReasoning,
    isStreaming: streaming,
  })
  const contextDividers = useAtomValue(contextDividersAtom)
  const parallelMode = useAtomValue(parallelModeAtom)
  const streamingModel = useAtomValue(streamingModelAtom)
  const hasMore = useAtomValue(hasMoreMessagesAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)

  /** 是否正在加载更多历史 */
  const [loadingMore, setLoadingMore] = React.useState(false)

  /**
   * 淡入控制：切换对话时先隐藏，等 StickToBottom 定位完成后再显示。
   * 避免 "先看到顶部消息再跳到底部" 的闪烁。
   */
  const [ready, setReady] = React.useState(false)
  const prevConversationIdRef = React.useRef<string | null>(null)

  // 对话切换时立即隐藏
  React.useEffect(() => {
    if (currentConversationId !== prevConversationIdRef.current) {
      prevConversationIdRef.current = currentConversationId
      setReady(false)
    }
  }, [currentConversationId])

  // 消息渲染 + StickToBottom 定位完成后淡入
  React.useEffect(() => {
    if (ready) return

    // 空对话直接显示
    if (messages.length === 0 && !streaming) {
      setReady(true)
      return
    }

    // 双 rAF：确保 DOM 渲染和 StickToBottom 滚动都完成
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    })
    return () => { cancelled = true }
  }, [messages, streaming, ready])

  /** 加载更多历史消息 */
  const handleLoadMore = React.useCallback(async () => {
    if (!onLoadMore || loadingMore || !hasMore) return

    setLoadingMore(true)
    await onLoadMore()
    setLoadingMore(false)
  }, [onLoadMore, loadingMore, hasMore])

  // 并排模式：自动加载全部历史消息（并排视图需要完整上下文）
  React.useEffect(() => {
    if (parallelMode && hasMore) {
      handleLoadMore()
    }
  }, [parallelMode, hasMore, handleLoadMore])

  // 迷你地图数据（必须在所有条件分支之前调用，遵守 hooks 规则）
  const minimapItems: MinimapItem[] = React.useMemo(
    () => messages.map((m) => ({
      id: m.id,
      role: m.role as MinimapItem['role'],
      preview: m.content.slice(0, 80),
      avatar: m.role === 'user' ? userProfile.avatar : undefined,
      model: m.model,
    })),
    [messages, userProfile.avatar]
  )

  // 并排模式
  if (parallelMode) {
    return (
      <ParallelChatMessages
        messages={messages}
        streaming={streaming}
        streamingContent={smoothContent}
        streamingReasoning={smoothReasoning}
        contextDividers={contextDividers}
        onDeleteDivider={onDeleteDivider}
        onDeleteMessage={onDeleteMessage}
        onResendMessage={onResendMessage}
        onStartInlineEdit={onStartInlineEdit}
        onSubmitInlineEdit={onSubmitInlineEdit}
        onCancelInlineEdit={onCancelInlineEdit}
        inlineEditingMessageId={inlineEditingMessageId}
        loadingMore={loadingMore}
      />
    )
  }

  // 标准消息列表模式
  const dividerSet = new Set(contextDividers)

  return (
    <Conversation className={ready ? 'opacity-100 transition-opacity duration-200' : 'opacity-0'}>
      {/* 滚动到顶部时自动加载更多历史 */}
      <ScrollTopLoader
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={handleLoadMore}
      />
      <ConversationContent>
        {messages.length === 0 && !streaming ? (
          <EmptyState />
        ) : (
          <>
            {/* 已有消息 + 分隔线 */}
            {messages.map((msg: ChatMessage) => (
              <React.Fragment key={msg.id}>
                <div data-message-id={msg.id}>
                  <ChatMessageItem
                    message={msg}
                    isStreaming={false}
                    isLastAssistant={false}
                    allMessages={messages}
                    onDeleteMessage={onDeleteMessage}
                    onResendMessage={onResendMessage}
                    onStartInlineEdit={onStartInlineEdit}
                    onSubmitInlineEdit={onSubmitInlineEdit}
                    onCancelInlineEdit={onCancelInlineEdit}
                    isInlineEditing={msg.id === inlineEditingMessageId}
                  />
                </div>
                {/* 分隔线 */}
                {dividerSet.has(msg.id) && (
                  <ContextDivider
                    messageId={msg.id}
                    onDelete={onDeleteDivider}
                  />
                )}
              </React.Fragment>
            ))}

            {/* 正在生成 / 停止后等待磁盘消息加载的临时 assistant 消息 */}
            {(streaming || smoothContent || smoothReasoning) && (
              <Message from="assistant">
                <MessageHeader
                  model={streamingModel ?? undefined}
                  time={formatMessageTime(Date.now())}
                  logo={
                    <img
                      src={getModelLogo(streamingModel ?? '')}
                      alt="AI"
                      className="size-[35px] rounded-[25%] object-cover"
                    />
                  }
                />
                <MessageContent>
                  {/* 记忆工具活动指示器 */}
                  <MemoryToolIndicator activities={toolActivities} />

                  {/* 推理内容（如果有） */}
                  {smoothReasoning && (
                    <Reasoning
                      isStreaming={streaming && !smoothContent}
                      defaultOpen={true}
                    >
                      <ReasoningTrigger />
                      <ReasoningContent>{smoothReasoning}</ReasoningContent>
                    </Reasoning>
                  )}

                  {/* 流式内容（经过平滑处理） */}
                  {smoothContent ? (
                    <>
                      <MessageResponse>{smoothContent}</MessageResponse>
                      {streaming && <StreamingIndicator />}
                    </>
                  ) : (
                    /* 等待首个 chunk 时的加载动画（仅流式中且无推理时显示） */
                    streaming && !smoothReasoning && <MessageLoading />
                  )}
                </MessageContent>
              </Message>
            )}
          </>
        )}
      </ConversationContent>
      <ScrollMinimap items={minimapItems} />
      <ConversationScrollButton />
    </Conversation>
  )
}
