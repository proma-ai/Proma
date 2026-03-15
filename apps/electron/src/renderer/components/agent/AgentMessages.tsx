/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 使用 ToolActivityList 渲染紧凑工具活动列表。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Bot, FileText, FileImage, RotateCw, AlertTriangle, ChevronDown, ChevronRight, Plus, Minimize2, Download } from 'lucide-react'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageActions,
  MessageLoading,
  MessageResponse,
  StreamingIndicator,
  UserMessageContent,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ScrollMinimap } from '@/components/ai-elements/scroll-minimap'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { useSmoothStream } from '@proma/ui'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { CopyButton } from '@/components/chat/CopyButton'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { Button } from '@/components/ui/button'
import { getModelLogo } from '@/lib/model-logo'
import { ToolActivityList } from './ToolActivityItem'
import { BackgroundTasksPanel } from './BackgroundTasksPanel'
import { useBackgroundTasks } from '@/hooks/useBackgroundTasks'
import { userProfileAtom } from '@/atoms/user-profile'
import { cn } from '@/lib/utils'
import type { AgentMessage, RetryAttempt } from '@proma/shared'
import type { ToolActivity, AgentStreamState } from '@/atoms/agent-atoms'

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  messages: AgentMessage[]
  streaming: boolean
  streamState?: AgentStreamState
  /** 当前会话工作目录，用于解析相对文件路径 */
  sessionPath?: string | null
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
}

function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Bot size={24} className="text-muted-foreground/60" />
        </div>
        <p className="text-sm">在下方输入框开始使用 Agent</p>
      </div>
    </div>
  )
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

/** 单张工具结果图片（内联显示） */
function InlineImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
      })
      .catch((error) => {
        console.error('[InlineImage] 读取附件失败:', error)
      })
  }, [attachment.localPath, attachment.mediaType])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return <div className="size-[280px] rounded-lg bg-muted/30 animate-pulse shrink-0" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="size-[280px] rounded-lg object-cover shrink-0"
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
    </div>
  )
}

/** 从工具活动中提取并内联显示所有生成的图片 */
function ToolResultInlineImages({ activities }: { activities: ToolActivity[] }): React.ReactElement | null {
  const allImages = activities.flatMap((a) => a.imageAttachments ?? [])
  if (allImages.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {allImages.map((img, i) => (
        <InlineImage key={`${img.localPath}-${i}`} attachment={img} />
      ))}
    </div>
  )
}

/** 从持久化事件中提取工具活动列表 */
function extractToolActivities(events: AgentMessage['events']): ToolActivity[] {
  if (!events) return []

  const activities: ToolActivity[] = []
  for (const event of events) {
    if (event.type === 'tool_start') {
      const existingIdx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (existingIdx >= 0) {
        activities[existingIdx] = {
          ...activities[existingIdx]!,
          input: event.input,
          intent: event.intent || activities[existingIdx]!.intent,
          displayName: event.displayName || activities[existingIdx]!.displayName,
        }
      } else {
        activities.push({
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: true,
          parentToolUseId: event.parentToolUseId,
        })
      }
    } else if (event.type === 'tool_result') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = {
          ...activities[idx]!,
          result: event.result,
          isError: event.isError,
          done: true,
          imageAttachments: event.imageAttachments,
        }
      }
    } else if (event.type === 'task_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, taskId: event.taskId }
      }
    } else if (event.type === 'shell_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, shellId: event.shellId }
      }
    } else if (event.type === 'task_progress') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, elapsedSeconds: event.elapsedSeconds }
      }
    } else if (event.type === 'task_started' && event.toolUseId) {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, intent: event.description, taskId: event.taskId }
      }
    }
  }
  return activities
}

/** 解析的附件引用 */
interface AttachedFileRef {
  filename: string
  path: string
}

/** 解析消息中的 <attached_files> 块，返回文件列表和剩余文本 */
function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    // 格式: - filename: /path/to/file
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

/** 判断文件是否为图片类型 */
function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

/** 附件引用芯片 */
function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
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

/** AgentMessageItem 属性接口 */
interface AgentMessageItemProps {
  message: AgentMessage
  sessionPath?: string | null
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
}

function AgentMessageItem({ message, sessionPath, onRetry, onRetryInNewSession, onCompact }: AgentMessageItemProps): React.ReactElement | null {
  const userProfile = useAtomValue(userProfileAtom)

  if (message.role === 'user') {
    const { files: attachedFiles, text: messageText } = parseAttachedFiles(message.content)

    return (
      <Message from="user">
        <div className="flex items-start gap-2.5 mb-2.5">
          <UserAvatar avatar={userProfile.avatar} size={35} />
          <div className="flex flex-col justify-between h-[35px]">
            <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
            <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(message.createdAt)}</span>
          </div>
        </div>
        <MessageContent>
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((file) => (
                <AttachedFileChip key={file.path} file={file} />
              ))}
            </div>
          )}
          {messageText && (
            <UserMessageContent>{messageText}</UserMessageContent>
          )}
        </MessageContent>
        {/* 操作按钮（hover 时可见） */}
        {messageText && (
          <MessageActions className="pl-[46px] mt-0.5">
            <CopyButton content={messageText} />
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'assistant') {
    const toolActivities = extractToolActivities(message.events)

    return (
      <Message from="assistant">
        <MessageHeader
          model={message.model}
          time={formatMessageTime(message.createdAt)}
          logo={<AssistantLogo model={message.model} />}
        />
        <MessageContent>
          {toolActivities.length > 0 && (
            <div className="mb-3">
              <ToolActivityList activities={toolActivities} />
            </div>
          )}
          <ToolResultInlineImages activities={toolActivities} />
          {message.content && (
            <MessageResponse basePath={sessionPath || undefined}>{message.content}</MessageResponse>
          )}
        </MessageContent>
        {/* 操作按钮（hover 时可见） */}
        {message.content && (
          <MessageActions className="pl-[46px] mt-0.5">
            <CopyButton content={message.content} />
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'status' && message.errorCode) {
    // TypedError 消息 - 复用普通消息格式，简单显示错误
    return (
      <Message from="assistant">
        <MessageHeader
          model={undefined}
          time={formatMessageTime(message.createdAt)}
          logo={
            <div className="size-[35px] rounded-[25%] bg-destructive/10 flex items-center justify-center">
              <AlertTriangle size={18} className="text-destructive" />
            </div>
          }
        />
        <MessageContent>
          <div className="text-destructive">
            <MessageResponse>{message.content}</MessageResponse>
          </div>
          {/* 错误操作按钮 */}
          <div className="flex items-center gap-2 mt-3">
            {message.errorCode === 'prompt_too_long' && onCompact && (
              <Button size="sm" onClick={onCompact}>
                <Minimize2 className="size-3.5 mr-1.5" />
                压缩上下文
              </Button>
            )}
            {onRetry && (
              <Button size="sm" variant={message.errorCode === 'prompt_too_long' ? 'outline' : 'default'} onClick={onRetry}>
                <RotateCw className="size-3.5 mr-1.5" />
                重试
              </Button>
            )}
            {onRetryInNewSession && (
              <Button size="sm" variant="outline" onClick={onRetryInNewSession}>
                <Plus className="size-3.5 mr-1.5" />
                在新会话中重试
              </Button>
            )}
          </div>
        </MessageContent>
        {/* 操作按钮（hover 时可见） */}
        <MessageActions className="pl-[46px] mt-0.5">
          <CopyButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  return null
}

export function AgentMessages({ sessionId, messages, streaming, streamState, sessionPath, onRetry, onRetryInNewSession, onCompact }: AgentMessagesProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)

  /**
   * 淡入控制：切换会话时先隐藏，等布局完成后再显示。
   * 同时用于延迟启用 content-visibility 优化，避免初次加载跳动。
   */
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
    if (messages.length === 0 && !streaming) {
      setReady(true)
      return
    }
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })
    })
    return () => { cancelled = true }
  }, [messages, streaming, ready])

  // 从 streamState 属性中计算派生值
  const streamingContent = streamState?.content ?? ''
  const toolActivities = streamState?.toolActivities ?? []
  const agentStreamingModel = streamState?.model
  const retrying = streamState?.retrying
  const startedAt = streamState?.startedAt

  // 获取后台任务列表
  const { tasks: backgroundTasks } = useBackgroundTasks(sessionId)

  const { displayedContent: smoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })

  // 迷你地图数据
  const minimapItems: MinimapItem[] = React.useMemo(
    () => messages.map((m) => ({
      id: m.id,
      role: m.role === 'status' ? 'status' as const : m.role as MinimapItem['role'],
      preview: m.content.replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '').slice(0, 80),
      avatar: m.role === 'user' ? userProfile.avatar : undefined,
      model: m.model,
    })),
    [messages, userProfile.avatar]
  )

  return (
    <Conversation className={ready ? 'cv-ready opacity-100 transition-opacity duration-200' : 'opacity-0'}>
      <ConversationContent>
        {messages.length === 0 && !streaming ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg: AgentMessage) => (
              <div key={msg.id} data-message-id={msg.id}>
                <AgentMessageItem
                  message={msg}
                  sessionPath={sessionPath}
                  onRetry={onRetry}
                  onRetryInNewSession={onRetryInNewSession}
                  onCompact={onCompact}
                />
              </div>
            ))}

            {(streaming || smoothContent || toolActivities.length > 0 || retrying) && (
              <Message from="assistant">
                <MessageHeader
                  model={agentStreamingModel}
                  time={formatMessageTime(Date.now())}
                  logo={<AssistantLogo model={agentStreamingModel} />}
                />
                <MessageContent>
                  {retrying && <RetryingNotice retrying={retrying} />}
                  {toolActivities.length > 0 && (
                    <div className="mb-3">
                      <ToolActivityList activities={toolActivities} animate />
                      {/* 后台任务面板 — 显示在工具活动下方 */}
                      <BackgroundTasksPanel tasks={backgroundTasks} />
                    </div>
                  )}
                  <ToolResultInlineImages activities={toolActivities} />
                  {smoothContent ? (
                    <>
                      <MessageResponse basePath={sessionPath || undefined}>{smoothContent}</MessageResponse>
                      {streaming && <StreamingIndicator />}
                    </>
                  ) : (
                    streaming && toolActivities.length === 0 && !retrying && <MessageLoading startedAt={startedAt} />
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
