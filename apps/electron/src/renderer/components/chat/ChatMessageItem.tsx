/**
 * ChatMessageItem - 单条消息渲染
 *
 * 使用 ai-elements 原语组合渲染消息。
 * 支持复制、删除、重新发送、原地编辑操作，并排模式。
 *
 * - assistant 消息：头像 + Reasoning 折叠 + Markdown 内容 + 操作按钮
 * - user 消息：右对齐气泡 + 可折叠长文本 + 操作按钮
 * - streaming 最后一条：呼吸脉冲指示器
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
  UserMessageContent,
  MessageStopped,
  StreamingIndicator,
  MessageAttachments,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import { CopyButton } from './CopyButton'
import { DeleteMessageDialog } from './DeleteMessageDialog'
import { InlineEditForm } from './InlineEditForm'
import { UserAvatar } from './UserAvatar'
import { getModelLogo } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import type { ChatMessage } from '@proma/shared'
import type { InlineEditSubmitPayload } from './InlineEditForm'
import { ChatToolActivityIndicator } from './ChatToolActivityIndicator'

// 重导出供外部使用
export type { InlineEditSubmitPayload } from './InlineEditForm'

/**
 * 格式化消息时间（简略写法）
 * - 今年：02/12 14:30
 * - 跨年：2025/02/12 14:30
 */
export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()

  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const time = `${hh}:${mm}`

  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${time}`
  }

  return `${date.getFullYear()}/${month}/${day} ${time}`
}

interface ChatMessageItemProps {
  /** 消息数据 */
  message: ChatMessage
  /** 是否正在流式生成中 */
  isStreaming?: boolean
  /** 是否为最后一条 assistant 消息（用于显示 StreamingIndicator） */
  isLastAssistant?: boolean
  /** 所有消息列表 */
  allMessages?: ChatMessage[]
  /** 消息在列表中的索引 */
  messageIndex?: number
  /** 删除消息回调 */
  onDeleteMessage?: (messageId: string) => Promise<void>
  /** 重新发送用户消息 */
  onResendMessage?: (message: ChatMessage) => Promise<void>
  /** 开始原地编辑用户消息 */
  onStartInlineEdit?: (message: ChatMessage) => void
  /** 原地编辑发送 */
  onSubmitInlineEdit?: (message: ChatMessage, payload: InlineEditSubmitPayload) => Promise<void>
  /** 取消原地编辑 */
  onCancelInlineEdit?: () => void
  /** 是否处于原地编辑态 */
  isInlineEditing?: boolean
  /** 是否并排模式（用户消息不右对齐） */
  isParallelMode?: boolean
}

export function ChatMessageItem({
  message,
  isStreaming = false,
  isLastAssistant = false,
  onDeleteMessage,
  onResendMessage,
  onStartInlineEdit,
  onSubmitInlineEdit,
  onCancelInlineEdit,
  isInlineEditing = false,
  isParallelMode = false,
}: ChatMessageItemProps): React.ReactElement {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const userProfile = useAtomValue(userProfileAtom)

  /** 确认删除消息 */
  const handleDeleteConfirm = async (): Promise<void> => {
    if (!onDeleteMessage) return
    setIsDeleting(true)
    try {
      await onDeleteMessage(message.id)
    } finally {
      setIsDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  /** 原地编辑提交 */
  const handleInlineEditSubmit = React.useCallback((payload: InlineEditSubmitPayload): void => {
    if (!onSubmitInlineEdit) return
    void onSubmitInlineEdit(message, payload)
  }, [message, onSubmitInlineEdit])

  // 并排模式下，user 消息不使用 from="user" 以避免右对齐
  const messageFrom = isParallelMode ? 'assistant' : message.role

  return (
    <>
      <Message from={messageFrom}>
        {/* assistant 头像 + 模型名 + 时间 */}
        {message.role === 'assistant' && (
          <MessageHeader
            model={message.model}
            time={formatMessageTime(message.createdAt)}
            logo={
              <img
                src={getModelLogo(message.model ?? '')}
                alt={message.model ?? 'AI'}
                className="size-[35px] rounded-[25%] object-cover"
              />
            }
          />
        )}

        {/* user 头像 + 用户名 + 时间 */}
        {message.role === 'user' && (
          <div className="flex items-start gap-2.5 mb-2.5">
            <UserAvatar avatar={userProfile.avatar} size={35} />
            <div className="flex flex-col justify-between h-[35px]">
              <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
              <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(message.createdAt)}</span>
            </div>
          </div>
        )}

        <MessageContent>
          {message.role === 'assistant' ? (
            <>
              {/* 工具活动记录（历史消息） */}
              {message.toolActivities && message.toolActivities.length > 0 && (
                <ChatToolActivityIndicator activities={message.toolActivities} />
              )}

              {/* 推理折叠区域 */}
              {message.reasoning && (
                <Reasoning
                  isStreaming={isStreaming && !message.content}
                  defaultOpen={isStreaming && !message.content}
                >
                  <ReasoningTrigger />
                  <ReasoningContent>{message.reasoning}</ReasoningContent>
                </Reasoning>
              )}

              {/* 内容区域 */}
              {message.content ? (
                <>
                  <MessageResponse>{message.content}</MessageResponse>
                  {/* 流式传输中的呼吸指示器 */}
                  {isStreaming && isLastAssistant && !message.stopped && (
                    <StreamingIndicator />
                  )}
                </>
              ) : message.stopped ? (
                <MessageStopped />
              ) : null}
            </>
          ) : (
            /* 用户消息 - 附件 + 可折叠文本 / 原地编辑 */
            <>
              {!isInlineEditing && message.attachments && message.attachments.length > 0 && (
                <MessageAttachments attachments={message.attachments} />
              )}
              {isInlineEditing ? (
                <InlineEditForm
                  message={message}
                  onSubmit={handleInlineEditSubmit}
                  onCancel={() => onCancelInlineEdit?.()}
                />
              ) : message.content && (
                <UserMessageContent>{message.content}</UserMessageContent>
              )}
            </>
          )}
        </MessageContent>

        {/* 操作按钮（非 streaming 时显示，hover 时可见） */}
        {(message.content || (message.attachments && message.attachments.length > 0)) && !isStreaming && !isInlineEditing && (
          <MessageActions className="pl-[46px] mt-0.5">
            <CopyButton content={message.content} />
            {message.role === 'user' && onResendMessage && (
              <MessageAction
                tooltip="重新发送"
                onClick={() => { void onResendMessage(message) }}
              >
                <RotateCcw className="size-3.5" />
              </MessageAction>
            )}
            {message.role === 'user' && onStartInlineEdit && (
              <MessageAction
                tooltip="编辑后重发"
                onClick={() => onStartInlineEdit(message)}
              >
                <Pencil className="size-3.5" />
              </MessageAction>
            )}
            {onDeleteMessage && (
              <MessageAction
                tooltip="删除"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-3.5" />
              </MessageAction>
            )}
            {message.role === 'assistant' && message.stopped && (
              <span className="text-[11px] text-foreground/40 ml-1">（已中止）</span>
            )}
          </MessageActions>
        )}
      </Message>

      {/* 删除确认对话框 */}
      <DeleteMessageDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </>
  )
}
