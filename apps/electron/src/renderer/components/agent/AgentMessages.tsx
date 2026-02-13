/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 使用 ToolActivityList 渲染紧凑工具活动列表。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Bot, FileText, FileImage, RotateCw } from 'lucide-react'
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
import { useSmoothStream } from '@proma/ui'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { CopyButton } from '@/components/chat/CopyButton'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { getModelLogo } from '@/lib/model-logo'
import { ToolActivityList } from './ToolActivityItem'
import {
  currentAgentMessagesAtom,
  agentStreamingAtom,
  agentStreamingContentAtom,
  agentToolActivitiesAtom,
  agentStreamingModelAtom,
  agentRetryingAtom,
} from '@/atoms/agent-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import type { AgentMessage } from '@proma/shared'
import type { ToolActivity, AgentStreamState } from '@/atoms/agent-atoms'

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

/** 从持久化事件中提取工具活动列表 */
function extractToolActivities(events: AgentMessage['events']): ToolActivity[] {
  if (!events) return []

  const activities: ToolActivity[] = []
  for (const event of events) {
    if (event.type === 'tool_start') {
      const existingIdx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (existingIdx >= 0) {
        activities[existingIdx] = {
          ...activities[existingIdx],
          input: event.input,
          intent: event.intent || activities[existingIdx].intent,
          displayName: event.displayName || activities[existingIdx].displayName,
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
          ...activities[idx],
          result: event.result,
          isError: event.isError,
          done: true,
        }
      }
    } else if (event.type === 'task_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx], isBackground: true, taskId: event.taskId }
      }
    } else if (event.type === 'shell_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx], isBackground: true, shellId: event.shellId }
      }
    } else if (event.type === 'task_progress') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx], elapsedSeconds: event.elapsedSeconds }
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
  const lines = match[1].split('\n')
  for (const line of lines) {
    // 格式: - filename: /path/to/file
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1].trim(), path: lineMatch[2].trim() })
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

/** 重试提示组件 - 简洁版 */
function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3 px-1">
      <RotateCw className="size-3 animate-spin opacity-60" />
      <span>
        重试中 ({retrying.attempt}/{retrying.maxAttempts}) · {retrying.reason}
      </span>
    </div>
  )
}

function AgentMessageItem({ message }: { message: AgentMessage }): React.ReactElement | null {
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
          {message.content && (
            <MessageResponse>{message.content}</MessageResponse>
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

  return null
}

export function AgentMessages(): React.ReactElement {
  const messages = useAtomValue(currentAgentMessagesAtom)
  const streaming = useAtomValue(agentStreamingAtom)
  const streamingContent = useAtomValue(agentStreamingContentAtom)
  const toolActivities = useAtomValue(agentToolActivitiesAtom)
  const agentStreamingModel = useAtomValue(agentStreamingModelAtom)
  const retrying = useAtomValue(agentRetryingAtom)

  const { displayedContent: smoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })

  return (
    <Conversation>
      <ConversationContent>
        {messages.length === 0 && !streaming ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg: AgentMessage) => (
              <AgentMessageItem key={msg.id} message={msg} />
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
                    </div>
                  )}
                  {smoothContent ? (
                    <>
                      <MessageResponse>{smoothContent}</MessageResponse>
                      {streaming && <StreamingIndicator />}
                    </>
                  ) : (
                    streaming && toolActivities.length === 0 && !retrying && <MessageLoading />
                  )}
                </MessageContent>
              </Message>
            )}
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
