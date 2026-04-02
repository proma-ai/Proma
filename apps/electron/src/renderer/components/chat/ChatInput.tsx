/**
 * ChatInput - 输入区域
 *
 * 完整输入体验，包含：
 * - RichTextInput (TipTap 编辑器) 替代原生 textarea
 * - 附件预览区域（pendingAttachments 缩略图列表）
 * - Footer 工具栏（左右分布）：
 *   左侧：Paperclip 附件按钮、ModelSelector、ThinkingButton、SpeechButton、ContextSettingsPopover、ClearContextButton
 *   右侧：Send/Stop 按钮
 * - 拖放文件支持（onDragOver/onDragLeave/onDrop）
 * - 监听 proma:clear-context 和 proma:focus-input 自定义事件
 * - 卡片式容器样式
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { CornerDownLeft, Square, Brain, Paperclip } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { ClearContextButton } from './ClearContextButton'
import { ContextSettingsPopover } from './ContextSettingsPopover'
import { ToolSelectorPopover } from './ToolSelectorPopover'
import { AttachmentPreviewItem } from './AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  conversationDraftsAtom,
} from '@/atoms/chat-atoms'
import type { PendingAttachment } from '@/atoms/chat-atoms'
import {
  useConversationModel,
  useConversationThinkingEnabled,
} from '@/hooks/useConversationSettings'
import { FeishuNotifyToggle } from './FeishuNotifyToggle'
import { cn } from '@/lib/utils'
import { fileToBase64 } from '@/lib/file-utils'

interface ChatInputProps {
  /** 当前对话 ID */
  conversationId: string
  /** 是否正在流式生成 */
  streaming: boolean
  /** 待发送附件列表 */
  pendingAttachments: PendingAttachment[]
  /** 设置待发送附件 */
  onSetPendingAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>
  /** 发送消息回调 */
  onSend: (content: string) => void
  /** 停止生成回调 */
  onStop: () => void
  /** 清除上下文回调 */
  onClearContext?: () => void
}

export function ChatInput({ conversationId, streaming, pendingAttachments, onSetPendingAttachments, onSend, onStop, onClearContext }: ChatInputProps): React.ReactElement {
  // 从 Map atom 读写草稿
  const draftsMap = useAtomValue(conversationDraftsAtom)
  const setDraftsMap = useSetAtom(conversationDraftsAtom)
  const content = draftsMap.get(conversationId) ?? ''
  const setContent = React.useCallback((value: string) => {
    setDraftsMap((prev) => {
      const map = new Map(prev)
      if (value.trim() === '') {
        map.delete(conversationId)
      } else {
        map.set(conversationId, value)
      }
      return map
    })
  }, [conversationId, setDraftsMap])

  const [selectedModel] = useConversationModel()
  const [thinkingEnabled, setThinkingEnabled] = useConversationThinkingEnabled()
  const setPendingAttachments = onSetPendingAttachments
  const [isDragOver, setIsDragOver] = React.useState(false)

  const canSend = (content.trim().length > 0 || pendingAttachments.length > 0)
    && selectedModel !== null
    && !streaming

  /**
   * 将文件列表添加为附件
   *
   * File → base64 → saveAttachment IPC → 创建 blob URL → 添加到 atom
   */
  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)

        // 通过 IPC 保存到本地（需要当前对话 ID，但附件保存时可能还没对话）
        // 这里先不保存到磁盘，等发送时再保存
        // 创建 blob URL 用于预览
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined

        const pendingAttachment: PendingAttachment = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          localPath: '', // 发送时填充
          size: file.size,
          previewUrl,
          // 临时存储 base64 数据（通过扩展字段）
        }

        // 将 base64 数据存储在 window 临时缓存中
        if (!window.__pendingAttachmentData) {
          window.__pendingAttachmentData = new Map<string, string>()
        }
        window.__pendingAttachmentData.set(pendingAttachment.id, base64)

        setPendingAttachments((prev) => [...prev, pendingAttachment])
      } catch (error) {
        console.error('[ChatInput] 添加附件失败:', error)
      }
    }
  }, [setPendingAttachments])

  /** 通过 IPC 打开文件选择对话框 */
  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      for (const fileInfo of result.files) {
        const previewUrl = fileInfo.mediaType.startsWith('image/')
          ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
          : undefined

        const pendingAttachment: PendingAttachment = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: fileInfo.filename,
          mediaType: fileInfo.mediaType,
          localPath: '',
          size: fileInfo.size,
          previewUrl,
        }

        if (!window.__pendingAttachmentData) {
          window.__pendingAttachmentData = new Map<string, string>()
        }
        window.__pendingAttachmentData.set(pendingAttachment.id, fileInfo.data)

        setPendingAttachments((prev) => [...prev, pendingAttachment])
      }
    } catch (error) {
      console.error('[ChatInput] 文件选择对话框失败:', error)
    }
  }, [setPendingAttachments])

  /** 移除待发送附件 */
  const handleRemoveAttachment = React.useCallback((id: string): void => {
    setPendingAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id)
      // 回收 blob URL
      if (attachment?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
      // 清理临时 base64 缓存
      window.__pendingAttachmentData?.delete(id)
      return prev.filter((a) => a.id !== id)
    })
  }, [setPendingAttachments])

  /** 发送消息 */
  const handleSend = React.useCallback((): void => {
    if (!canSend) return
    onSend(content.trim())
    setContent('')
    // 附件清理由 ChatView 的 handleSend 负责
  }, [canSend, content, onSend])

  /** 语音识别结果 */
  const handleSpeechTranscript = React.useCallback((text: string): void => {
    setContent(content + (content ? ' ' : '') + text)
  }, [content, setContent])

  /** 粘贴文件回调 */
  const handlePasteFiles = React.useCallback((files: File[]): void => {
    addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  // 拖放处理
  const handleDragOver = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      addFilesAsAttachments(files)
    }
  }, [addFilesAsAttachments])

  // 监听快捷键系统分发的 clear-context 事件（Cmd+K）
  React.useEffect(() => {
    const handler = (): void => {
      onClearContext?.()
    }
    window.addEventListener('proma:clear-context', handler)
    return () => window.removeEventListener('proma:clear-context', handler)
  }, [onClearContext])

  // 监听快捷键系统分发的 focus-input 事件（Cmd+L）
  React.useEffect(() => {
    const handler = (): void => {
      // 聚焦 TipTap 编辑器：查找 Chat 输入框内的 ProseMirror 元素
      const proseMirror = document.querySelector('[data-input-mode="chat"] .ProseMirror') as HTMLElement | null
      proseMirror?.focus()
    }
    window.addEventListener('proma:focus-input', handler)
    return () => window.removeEventListener('proma:focus-input', handler)
  }, [])

  return (
    <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px]" data-input-mode="chat">
        {/* 卡片式输入容器 — 对标 Cherry Studio: border-radius 17px, 0.5px border */}
        <div
          className={cn(
            'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm transition-all duration-200',
            'focus-within:border-foreground/20',
            isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 附件预览区域 — Cherry Studio: padding 5px 15px, flex-wrap, gap 4px */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-[15px] pt-[10px] pb-[15px]">
              {pendingAttachments.map((att) => (
                <AttachmentPreviewItem
                  key={att.id}
                  filename={att.filename}
                  mediaType={att.mediaType}
                  previewUrl={att.previewUrl}
                  onRemove={() => handleRemoveAttachment(att.id)}
                />
              ))}
            </div>
          )}

          {/* TipTap 富文本编辑器 */}
          <RichTextInput
            value={content}
            onChange={setContent}
            onSubmit={handleSend}
            onPasteFiles={handlePasteFiles}
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            autoFocusTrigger={conversationId}
          />

          {/* Footer 工具栏 — Cherry Studio: padding 5px 8px, height 40px, gap 16px */}
          <div className="flex items-center justify-between px-2 py-1 h-[48px] gap-4">
            {/* 左侧工具按钮 */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {/* 附件按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[36px] rounded-full text-foreground/60 hover:text-foreground"
                    onClick={handleOpenFileDialog}
                  >
                    <Paperclip className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>添加附件</p>
                </TooltipContent>
              </Tooltip>

              <ModelSelector />

              {/* 思考模式切换 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-[36px] rounded-full',
                      thinkingEnabled ? 'text-green-500' : 'text-foreground/60 hover:text-foreground'
                    )}
                    onClick={() => setThinkingEnabled(!thinkingEnabled)}
                  >
                    <Brain className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{thinkingEnabled ? '关闭思考模式' : '开启思考模式'}</p>
                </TooltipContent>
              </Tooltip>

              <FeishuNotifyToggle sessionId={conversationId} />

              <SpeechButton onTranscript={handleSpeechTranscript} />

              <ToolSelectorPopover />

              <ContextSettingsPopover />

              <ClearContextButton onClick={onClearContext} />
            </div>

            {/* 右侧：发送 / 停止按钮 */}
            <div className="flex items-center gap-1.5">
              {streaming ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[36px] rounded-full text-destructive hover:!text-[hsl(0,75%,55%)] hover:!bg-[var(--stop-hover-bg)]"
                  onClick={onStop}
                >
                  <Square className="size-[16px]" fill="currentColor" strokeWidth={0} />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-[36px] rounded-full',
                    canSend
                      ? 'text-primary hover:bg-primary/10'
                      : 'text-foreground/30 cursor-not-allowed'
                  )}
                  onClick={handleSend}
                  disabled={!canSend}
                >
                  <CornerDownLeft className="size-[22px]" />
                </Button>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}
