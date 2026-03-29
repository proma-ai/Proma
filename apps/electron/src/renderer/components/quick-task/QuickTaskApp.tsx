/**
 * QuickTaskApp — 快速任务窗口根组件
 *
 * 当 URL 含 ?window=quick-task 时渲染此组件（替代主 App）。
 * 轻量级独立窗口：多行输入 + 附件粘贴 + 模式切换 + 默认模型展示。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { fileToBase64 } from '@/lib/file-utils'

/** 任务模式 */
type TaskMode = 'chat' | 'agent'

/** 待上传附件（仅在快速任务窗口内使用） */
interface QuickAttachment {
  id: string
  filename: string
  mediaType: string
  base64: string
  size: number
  previewUrl?: string
}

/** 模型展示信息 */
interface ModelInfo {
  channelName: string
  modelId: string
}

export function QuickTaskApp(): React.ReactElement {
  const [mode, setMode] = useState<TaskMode>('agent')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<QuickAttachment[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 设置透明背景
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
  }, [])

  // 加载默认模型信息
  useEffect(() => {
    loadModelInfo()
  }, [mode])

  async function loadModelInfo(): Promise<void> {
    try {
      const [settings, channels] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.listChannels(),
      ])

      if (mode === 'agent') {
        const channelId = settings.agentChannelId
        const modelId = settings.agentModelId
        if (channelId && modelId) {
          const channel = channels.find((c) => c.id === channelId)
          if (channel) {
            setModelInfo({ channelName: channel.name, modelId })
            return
          }
        }
      } else {
        // Chat 模式读取 localStorage 中的 selectedModel
        const raw = localStorage.getItem('proma-selected-model')
        if (raw) {
          try {
            const selected = JSON.parse(raw) as { channelId: string; modelId: string }
            const channel = channels.find((c) => c.id === selected.channelId)
            if (channel) {
              setModelInfo({ channelName: channel.name, modelId: selected.modelId })
              return
            }
          } catch { /* 忽略解析错误 */ }
        }
      }
      setModelInfo(null)
    } catch {
      setModelInfo(null)
    }
  }

  // 聚焦输入框
  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [])

  // 监听主进程的聚焦通知（窗口每次显示时）
  useEffect(() => {
    const cleanup = window.electronAPI.onQuickTaskFocus(() => {
      setText('')
      setAttachments([])
      focusInput()
      loadModelInfo()
    })
    return cleanup
  }, [focusInput])

  // 初始聚焦
  useEffect(() => {
    focusInput()
  }, [focusInput])

  // 自动调整 textarea 高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  // 全局键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        window.electronAPI.hideQuickTask()
        return
      }

      const isMac = navigator.userAgent.includes('Mac')
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && e.key === '1') {
        e.preventDefault()
        setMode('chat')
        return
      }
      if (mod && e.key === '2') {
        e.preventDefault()
        setMode('agent')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 添加文件为附件
  const addFiles = useCallback(async (files: File[]) => {
    const newAttachments: QuickAttachment[] = []
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined
        newAttachments.push({
          id: crypto.randomUUID(),
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          base64,
          size: file.size,
          previewUrl,
        })
      } catch (err) {
        console.error('[快速任务] 读取文件失败:', err)
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments])
    }
  }, [])

  // 移除附件
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  // 粘贴事件
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }, [addFiles])

  // 拖拽事件
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) addFiles(files)
  }, [addFiles])

  // 文件选择
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) addFiles(files)
    e.target.value = '' // 允许重复选择同一文件
  }, [addFiles])

  // 提交任务
  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || isSubmitting) return

    setIsSubmitting(true)
    try {
      await window.electronAPI.submitQuickTask({
        text: trimmed,
        mode,
        files: attachments.map(({ filename, mediaType, base64, size }) => ({
          filename, mediaType, base64, size,
        })),
      })
      setText('')
      setAttachments([])
    } catch (err) {
      console.error('[快速任务] 提交失败:', err)
    } finally {
      setIsSubmitting(false)
    }
  }, [text, mode, attachments, isSubmitting])

  // Enter 提交，Shift+Enter 换行
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const hasContent = text.trim().length > 0 || attachments.length > 0

  return (
    <div
      className="flex h-screen w-screen items-start justify-center p-3 bg-transparent"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`quick-task-container flex w-full flex-col rounded-2xl bg-background transition-colors ${isDragOver ? 'ring-2 ring-primary/50' : ''}`}>
        {/* 顶栏：模式切换 + 模型信息 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            {/* 模式切换器 */}
            <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  mode === 'chat'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMode('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  mode === 'agent'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setMode('agent')}
              >
                Agent
              </button>
            </div>

            {/* 模型信息 */}
            {modelInfo && (
              <span className="text-[11px] text-muted-foreground/70 truncate max-w-[280px]">
                {modelInfo.channelName} / {modelInfo.modelId}
              </span>
            )}
          </div>

          {/* 快捷键提示 */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40">
            <span>⌘1 Chat</span>
            <span>⌘2 Agent</span>
            <span>Esc 关闭</span>
          </div>
        </div>

        {/* 输入区域 */}
        <div className="flex-1 px-4 py-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={mode === 'agent' ? '向 Proma 描述你的任务，Enter 发送...' : '向 Proma 发送消息，Enter 发送...'}
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50 leading-relaxed"
            style={{ minHeight: '60px', maxHeight: '160px' }}
            disabled={isSubmitting}
            rows={3}
          />
        </div>

        {/* 附件预览区 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                filename={att.filename}
                mediaType={att.mediaType}
                previewUrl={att.previewUrl}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* 底栏：附件按钮 + 发送 */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <div className="flex items-center gap-1">
            {/* 附件按钮 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              title="添加附件"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              附件
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* 拖拽/粘贴提示 */}
            <span className="text-[10px] text-muted-foreground/30 ml-1">
              支持粘贴或拖拽文件
            </span>
          </div>

          {/* 发送按钮 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || isSubmitting}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            )}
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 附件小标签 =====

interface AttachmentChipProps {
  filename: string
  mediaType: string
  previewUrl?: string
  onRemove: () => void
}

function AttachmentChip({ filename, mediaType, previewUrl, onRemove }: AttachmentChipProps): React.ReactElement {
  const isImage = mediaType.startsWith('image/')
  const displayName = filename.length > 20 ? filename.slice(0, 17) + '...' : filename

  if (isImage && previewUrl) {
    return (
      <div className="group/chip relative size-14 shrink-0 rounded-lg overflow-hidden">
        <img src={previewUrl} alt={filename} className="size-full object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="group/chip relative flex items-center gap-1.5 shrink-0 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      <span className="max-w-[120px] truncate">{displayName}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 size-3.5 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted opacity-0 group-hover/chip:opacity-100 transition-all"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  )
}
