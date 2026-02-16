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
 * - Cmd/Ctrl+K 快捷键绑定清除上下文
 * - 卡片式容器样式
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { CornerDownLeft, Square, Lightbulb, Paperclip } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { ClearContextButton } from './ClearContextButton'
import { ContextSettingsPopover } from './ContextSettingsPopover'
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
  selectedModelAtom,
  streamingAtom,
  thinkingEnabledAtom,
  pendingAttachmentsAtom,
  currentConversationIdAtom,
  currentConversationDraftAtom,
} from '@/atoms/chat-atoms'
import type { PendingAttachment } from '@/atoms/chat-atoms'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  /** 发送消息回调 */
  onSend: (content: string) => void
  /** 停止生成回调 */
  onStop: () => void
  /** 清除上下文回调 */
  onClearContext?: () => void
}

/**
 * 将 File 对象转为 base64 字符串
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 去掉 data:xxx;base64, 前缀
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ChatInput({ onSend, onStop, onClearContext }: ChatInputProps): React.ReactElement {
  const [content, setContent] = useAtom(currentConversationDraftAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const streaming = useAtomValue(streamingAtom)
  const [thinkingEnabled, setThinkingEnabled] = useAtom(thinkingEnabledAtom)
  const [pendingAttachments, setPendingAttachments] = useAtom(pendingAttachmentsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
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

  // Cmd/Ctrl+K 快捷键
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        onClearContext?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClearContext])

  return (
    <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px] pt-2">
        {/* 卡片式输入容器 — 对标 Cherry Studio: border-radius 17px, 0.5px border */}
        <div
          className={cn(
            'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm pt-2 transition-all duration-200',
            'focus-within:border-foreground/20',
            isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 附件预览区域 — Cherry Studio: padding 5px 15px, flex-wrap, gap 4px */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1 px-[15px] py-[5px]">
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
            placeholder={
              selectedModel
                ? '输入消息... (Enter 发送，Shift+Enter 换行。支持拖放文件和直接粘贴图片)'
                : '请先选择模型'
            }
            disabled={!selectedModel}
            autoFocusTrigger={currentConversationId}
          />

          {/* Footer 工具栏 — Cherry Studio: padding 5px 8px, height 40px, gap 16px */}
          <div className="flex items-center justify-between px-2 py-[5px] h-[40px] gap-4">
            {/* 左侧工具按钮 */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {/* 附件按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[30px] rounded-full text-foreground/60 hover:text-foreground"
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
                      'size-[30px] rounded-full',
                      thinkingEnabled ? 'text-green-500' : 'text-foreground/60 hover:text-foreground'
                    )}
                    onClick={() => setThinkingEnabled(!thinkingEnabled)}
                  >
                    <Lightbulb className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{thinkingEnabled ? '关闭思考模式' : '开启思考模式'}</p>
                </TooltipContent>
              </Tooltip>

              <SpeechButton onTranscript={handleSpeechTranscript} />

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
                  className="size-[30px] rounded-full text-destructive hover:bg-destructive/10"
                  onClick={onStop}
                >
                  <Square className="size-[22px]" />
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-[30px] rounded-full',
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
