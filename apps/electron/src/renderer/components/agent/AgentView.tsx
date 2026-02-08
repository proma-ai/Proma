/**
 * AgentView — Agent 模式主视图容器
 *
 * 职责：
 * - 加载当前 Agent 会话消息
 * - 订阅 Agent 流式 IPC 事件
 * - 管理 streaming 状态
 * - 复用 ChatInput 组件（去掉 Chat 特有功能）
 * - AgentHeader 支持标题编辑 + 文件浏览器切换
 *
 * 布局：AgentHeader | AgentMessages | AgentInput + 可选 FileBrowser 侧面板
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, AlertCircle, X } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { ContextUsageBadge } from './ContextUsageBadge'
import { FileBrowser } from '@/components/file-browser'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  currentAgentSessionIdAtom,
  currentAgentMessagesAtom,
  agentStreamingStatesAtom,
  agentStreamingAtom,
  applyAgentEvent,
  agentSessionsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtom,
  agentWorkspacesAtom,
  agentContextStatusAtom,
  agentStreamErrorsAtom,
  currentAgentErrorAtom,
} from '@/atoms/agent-atoms'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentSendInput, AgentStreamEvent, AgentMessage, AgentPendingFile, AgentSavedFile, ModelOption } from '@proma/shared'

/** 将 File 对象转为 base64 字符串 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 递归读取 FileSystemDirectoryEntry 中所有文件 */
function readDirectoryRecursive(
  dirEntry: FileSystemDirectoryEntry,
  basePath: string,
): Promise<Array<{ relativePath: string; file: File }>> {
  return new Promise((resolve, reject) => {
    const results: Array<{ relativePath: string; file: File }> = []
    const reader = dirEntry.createReader()

    const readBatch = (): void => {
      reader.readEntries(
        async (entries) => {
          if (entries.length === 0) {
            resolve(results)
            return
          }

          for (const entry of entries) {
            if (entry.isFile) {
              const fileEntry = entry as FileSystemFileEntry
              const file = await new Promise<File>((res, rej) => {
                fileEntry.file(res, rej)
              })
              results.push({ relativePath: `${basePath}/${entry.name}`, file })
            } else if (entry.isDirectory) {
              const subResults = await readDirectoryRecursive(
                entry as FileSystemDirectoryEntry,
                `${basePath}/${entry.name}`,
              )
              results.push(...subResults)
            }
          }

          // readEntries 可能分批返回，需要持续读取
          readBatch()
        },
        reject,
      )
    }

    readBatch()
  })
}

export function AgentView(): React.ReactElement {
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const [currentMessages, setCurrentMessages] = useAtom(currentAgentMessagesAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streaming = useAtomValue(agentStreamingAtom)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const contextStatus = useAtomValue(agentContextStatusAtom)
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const agentError = useAtomValue(currentAgentErrorAtom)

  const [inputContent, setInputContent] = React.useState('')
  const [fileBrowserOpen, setFileBrowserOpen] = React.useState(false)
  const [sessionPath, setSessionPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [pendingFolderRefs, setPendingFolderRefs] = React.useState<AgentSavedFile[]>([])

  // 当前会话 ID ref（避免闭包捕获旧值）
  const currentSessionIdRef = React.useRef(currentSessionId)
  React.useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    window.electronAPI.listChannels().then((channels) => {
      const channel = channels.find((c) => c.id === agentChannelId && c.enabled)
      if (!channel) return

      const firstModel = channel.models.find((m) => m.enabled)
      if (!firstModel) return

      setAgentModelId(firstModel.id)
      window.electronAPI.updateSettings({
        agentChannelId,
        agentModelId: firstModel.id,
      }).catch(console.error)
    }).catch(console.error)
  }, [agentChannelId, agentModelId, setAgentModelId])

  // 获取当前 session 的工作路径（文件浏览器需要）
  React.useEffect(() => {
    if (!currentSessionId || !currentWorkspaceId) {
      setSessionPath(null)
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, currentSessionId)
      .then(setSessionPath)
      .catch(() => setSessionPath(null))
  }, [currentSessionId, currentWorkspaceId])

  // 加载当前会话消息
  React.useEffect(() => {
    if (!currentSessionId) {
      setCurrentMessages([])
      return
    }

    window.electronAPI
      .getAgentSessionMessages(currentSessionId)
      .then(setCurrentMessages)
      .catch(console.error)
  }, [currentSessionId, setCurrentMessages])

  // 订阅 Agent 流式 IPC 事件
  React.useEffect(() => {
    /** 辅助：更新指定会话的流式状态 */
    const updateState = (
      sessionId: string,
      updater: (prev: AgentStreamState) => AgentStreamState,
    ): void => {
      setStreamingStates((prev) => {
        const current = prev.get(sessionId) ?? { running: true, content: '', toolActivities: [] }
        const next = updater(current)
        const map = new Map(prev)
        map.set(sessionId, next)
        return map
      })
    }

    /** 辅助：从 Map 中移除状态 */
    const removeState = (sessionId: string): void => {
      setStreamingStates((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
    }

    const cleanupEvent = window.electronAPI.onAgentStreamEvent(
      (streamEvent: AgentStreamEvent) => {
        updateState(streamEvent.sessionId, (prev) =>
          applyAgentEvent(prev, streamEvent.event)
        )
      }
    )

    const cleanupComplete = window.electronAPI.onAgentStreamComplete(
      (data: { sessionId: string }) => {
        // 先加载持久化消息，再移除流式状态
        // 确保两次状态更新在同一回调中，React 批量合并为一次渲染，避免跳动
        const finalize = (): void => {
          removeState(data.sessionId)
          // 刷新会话列表
          window.electronAPI
            .listAgentSessions()
            .then(setAgentSessions)
            .catch(console.error)
        }

        if (data.sessionId === currentSessionIdRef.current) {
          window.electronAPI
            .getAgentSessionMessages(data.sessionId)
            .then((messages) => {
              setCurrentMessages(messages)
              finalize()
            })
            .catch(() => finalize())
        } else {
          finalize()
        }
      }
    )

    const cleanupError = window.electronAPI.onAgentStreamError(
      (data: { sessionId: string; error: string }) => {
        console.error('[AgentView] 流式错误:', data.error)

        // 存储错误消息，供 UI 显示
        setAgentStreamErrors((prev) => {
          const map = new Map(prev)
          map.set(data.sessionId, data.error)
          return map
        })

        const finalize = (): void => removeState(data.sessionId)

        if (data.sessionId === currentSessionIdRef.current) {
          window.electronAPI
            .getAgentSessionMessages(data.sessionId)
            .then((messages) => {
              setCurrentMessages(messages)
              finalize()
            })
            .catch(() => finalize())
        } else {
          finalize()
        }
      }
    )

    // 监听主进程自动标题生成完成事件
    const cleanupTitleUpdated = window.electronAPI.onAgentTitleUpdated(() => {
      window.electronAPI
        .listAgentSessions()
        .then(setAgentSessions)
        .catch(console.error)
    })

    return () => {
      cleanupEvent()
      cleanupComplete()
      cleanupError()
      cleanupTitleUpdated()
    }
  }, [setStreamingStates, setCurrentMessages, setAgentSessions, setAgentStreamErrors])

  // 自动发送 pending prompt（从设置页"对话完成配置"触发）
  React.useEffect(() => {
    if (!pendingPrompt) return
    if (!currentSessionId || pendingPrompt.sessionId !== currentSessionId) return
    if (!agentChannelId || streaming) return

    // 立即清除，防止重复执行
    const prompt = pendingPrompt
    setPendingPrompt(null)

    // 短延时确保 IPC 订阅已就绪
    const timer = setTimeout(() => {
      // 初始化流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(currentSessionId, { running: true, content: '', toolActivities: [] })
        return map
      })

      // 乐观更新：显示用户消息
      const tempUserMsg: AgentMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: prompt.message,
        createdAt: Date.now(),
      }
      setCurrentMessages((prev) => [...prev, tempUserMsg])

      // 发送消息
      const input: AgentSendInput = {
        sessionId: currentSessionId,
        userMessage: prompt.message,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        workspaceId: currentWorkspaceId || undefined,
      }
      window.electronAPI.sendAgentMessage(input).catch((error) => {
        console.error('[AgentView] 自动发送配置消息失败:', error)
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(currentSessionId)
          return map
        })
      })
    }, 150)

    return () => clearTimeout(timer)
  }, [pendingPrompt, currentSessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates, setCurrentMessages])

  // ===== 附件处理 =====

  /** 将 File 对象列表添加为待发送附件 */
  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, base64)

        setPendingFiles((prev) => [...prev, pending])
      } catch (error) {
        console.error('[AgentView] 添加附件失败:', error)
      }
    }
  }, [setPendingFiles])

  /** 打开文件选择对话框 */
  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      for (const fileInfo of result.files) {
        const previewUrl = fileInfo.mediaType.startsWith('image/')
          ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
          : undefined

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: fileInfo.filename,
          mediaType: fileInfo.mediaType,
          size: fileInfo.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, fileInfo.data)

        setPendingFiles((prev) => [...prev, pending])
      }
    } catch (error) {
      console.error('[AgentView] 文件选择对话框失败:', error)
    }
  }, [setPendingFiles])

  /** 打开文件夹选择对话框 */
  const handleOpenFolderDialog = React.useCallback(async (): Promise<void> => {
    if (!currentSessionId || !currentWorkspaceId) return

    const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!workspace) return

    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const saved = await window.electronAPI.copyFolderToSession({
        sourcePath: result.path,
        workspaceSlug: workspace.slug,
        sessionId: currentSessionId,
      })

      setPendingFolderRefs((prev) => [...prev, ...saved])
    } catch (error) {
      console.error('[AgentView] 文件夹选择失败:', error)
    }
  }, [currentSessionId, currentWorkspaceId, workspaces])

  /** 移除待发送文件 */
  const handleRemoveFile = React.useCallback((id: string): void => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl)
      }
      window.__pendingAgentFileData?.delete(id)
      return prev.filter((f) => f.id !== id)
    })
  }, [setPendingFiles])

  /** 粘贴文件处理 */
  const handlePasteFiles = React.useCallback((files: File[]): void => {
    addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  /** 拖放处理 */
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

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const items = Array.from(e.dataTransfer.items)
    const regularFiles: File[] = []
    const folderEntries: FileSystemDirectoryEntry[] = []

    // 使用 webkitGetAsEntry 区分文件和文件夹
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        folderEntries.push(entry as FileSystemDirectoryEntry)
      } else {
        const file = item.getAsFile()
        if (file) regularFiles.push(file)
      }
    }

    // 处理普通文件
    if (regularFiles.length > 0) {
      addFilesAsAttachments(regularFiles)
    }

    // 处理文件夹：递归读取 → base64 → saveFilesToAgentSession
    if (folderEntries.length > 0 && currentSessionId && currentWorkspaceId) {
      const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
      if (!workspace) return

      for (const dirEntry of folderEntries) {
        try {
          const files = await readDirectoryRecursive(dirEntry, dirEntry.name)
          if (files.length === 0) continue

          const filesToSave = await Promise.all(
            files.map(async ({ relativePath, file }) => ({
              filename: relativePath,
              data: await fileToBase64(file),
            }))
          )

          const saved = await window.electronAPI.saveFilesToAgentSession({
            workspaceSlug: workspace.slug,
            sessionId: currentSessionId,
            files: filesToSave,
          })

          setPendingFolderRefs((prev) => [...prev, ...saved])
        } catch (error) {
          console.error('[AgentView] 拖拽文件夹处理失败:', error)
        }
      }
    }
  }, [addFilesAsAttachments, currentSessionId, currentWorkspaceId, workspaces])

  /** ModelSelector 选择回调 */
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    setAgentChannelId(option.channelId)
    setAgentModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)
  }, [setAgentChannelId, setAgentModelId])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const externalSelectedModel = React.useMemo(() => {
    if (!agentChannelId) return null
    if (!agentModelId) return { channelId: agentChannelId, modelId: '' }
    return { channelId: agentChannelId, modelId: agentModelId }
  }, [agentChannelId, agentModelId])

  /** 发送消息 */
  const handleSend = React.useCallback(async (): Promise<void> => {
    const text = inputContent.trim()
    if ((!text && pendingFiles.length === 0 && pendingFolderRefs.length === 0) || !currentSessionId || !agentChannelId || streaming) return

    // 清除当前会话的错误消息
    setAgentStreamErrors((prev) => {
      if (!prev.has(currentSessionId)) return prev
      const map = new Map(prev)
      map.delete(currentSessionId)
      return map
    })

    // 1. 如果有 pending 文件，先保存到 session 目录
    let fileReferences = ''
    if (pendingFiles.length > 0) {
      const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
      if (workspace) {
        const filesToSave = pendingFiles.map((f) => ({
          filename: f.filename,
          data: window.__pendingAgentFileData?.get(f.id) || '',
        }))
        try {
          const saved = await window.electronAPI.saveFilesToAgentSession({
            workspaceSlug: workspace.slug,
            sessionId: currentSessionId,
            files: filesToSave,
          })
          const refs = saved.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')
          fileReferences += `<attached_files>\n${refs}\n</attached_files>\n\n`
        } catch (error) {
          console.error('[AgentView] 保存附件到 session 失败:', error)
        }
      }

      // 清理
      for (const f of pendingFiles) {
        if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl)
        window.__pendingAgentFileData?.delete(f.id)
      }
      setPendingFiles([])
    }

    // 1b. 如果有 pending 文件夹引用（已复制到 session 目录）
    if (pendingFolderRefs.length > 0) {
      const refs = pendingFolderRefs.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')
      fileReferences += `<attached_files>\n${refs}\n</attached_files>\n\n`
      setPendingFolderRefs([])
    }

    // 2. 构建最终消息
    const finalMessage = fileReferences + text

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(currentSessionId, { running: true, content: '', toolActivities: [] })
      return map
    })

    // 乐观更新：立即显示用户消息
    const tempUserMsg: AgentMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: finalMessage,
      createdAt: Date.now(),
    }
    setCurrentMessages((prev) => [...prev, tempUserMsg])

    const input: AgentSendInput = {
      sessionId: currentSessionId,
      userMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }

    setInputContent('')

    window.electronAPI.sendAgentMessage(input).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      setStreamingStates((prev) => {
        if (!prev.has(currentSessionId)) return prev
        const map = new Map(prev)
        map.delete(currentSessionId)
        return map
      })
    })
  }, [inputContent, pendingFiles, pendingFolderRefs, currentSessionId, agentChannelId, agentModelId, currentWorkspaceId, workspaces, streaming, setStreamingStates, setCurrentMessages, setPendingFiles, setAgentStreamErrors])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    if (!currentSessionId) return

    setStreamingStates((prev) => {
      const current = prev.get(currentSessionId)
      if (!current) return prev
      const map = new Map(prev)
      map.set(currentSessionId, { ...current, running: false })
      return map
    })

    window.electronAPI.stopAgent(currentSessionId).catch(console.error)
  }, [currentSessionId, setStreamingStates])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback((): void => {
    if (!currentSessionId || !agentChannelId || streaming) return

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(currentSessionId) ?? { running: true, content: '', toolActivities: [] }
      map.set(currentSessionId, { ...current, running: true })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId: currentSessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }).catch(console.error)
  }, [currentSessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setStreamingStates])

  const canSend = (inputContent.trim().length > 0 || pendingFiles.length > 0 || pendingFolderRefs.length > 0) && agentChannelId !== null && !streaming

  // 无当前会话 → 引导文案
  if (!currentSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full max-w-[min(72rem,100%)] mx-auto gap-4 text-muted-foreground" style={{ zoom: 1.1 }}>
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Bot size={32} className="text-muted-foreground/60" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-lg font-medium text-foreground">Agent 模式</h2>
          <p className="text-sm max-w-[300px]">
            从左侧点击"新会话"按钮创建一个 Agent 会话
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 主内容区域 */}
      <div className="flex flex-col h-full flex-1 min-w-0 max-w-[min(72rem,100%)] mx-auto">
        {/* Agent Header */}
        <AgentHeader
          onToggleFileBrowser={() => setFileBrowserOpen((prev) => !prev)}
          fileBrowserOpen={fileBrowserOpen}
        />

        {/* 消息区域 */}
        <AgentMessages />

        {/* 错误提示 */}
        {agentError && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1 break-all">{agentError}</span>
            <button
              type="button"
              className="shrink-0 p-0.5 rounded hover:bg-destructive/10 transition-colors"
              onClick={() => {
                if (!currentSessionId) return
                setAgentStreamErrors((prev) => {
                  const map = new Map(prev)
                  map.delete(currentSessionId)
                  return map
                })
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* 输入区域 — 复用 Chat 的卡片式输入风格 */}
        <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px] pt-2">
          <div
            className={cn(
              'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm pt-2 transition-all duration-200',
              isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* 无 Agent 渠道提示 */}
            {!agentChannelId && (
              <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Settings size={14} />
                <span>请在设置中选择 Agent 供应商</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setActiveView('settings')}
                >
                  前往设置
                </button>
              </div>
            )}

            {/* 附件预览区域 */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pb-1.5">
                {pendingFiles.map((file) => (
                  <AttachmentPreviewItem
                    key={file.id}
                    filename={file.filename}
                    mediaType={file.mediaType}
                    previewUrl={file.previewUrl}
                    onRemove={() => handleRemoveFile(file.id)}
                  />
                ))}
              </div>
            )}

            {/* 文件夹引用预览区域 */}
            {pendingFolderRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-xs text-muted-foreground">
                  <FolderPlus className="size-3.5" />
                  <span>已附加 {pendingFolderRefs.length} 个文件</span>
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground/60 hover:text-foreground transition-colors"
                    onClick={() => setPendingFolderRefs([])}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            <RichTextInput
              value={inputContent}
              onChange={setInputContent}
              onSubmit={handleSend}
              onPasteFiles={handlePasteFiles}
              placeholder={
                agentChannelId
                  ? '输入消息... (Enter 发送，Shift+Enter 换行)'
                  : '请先在设置中选择 Agent 供应商'
              }
              disabled={!agentChannelId}
            />

            {/* Footer 工具栏 */}
            <div className="flex items-center justify-between px-2 py-[5px] h-[40px] gap-4">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {agentChannelId && (
                  <>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-[30px] rounded-full text-foreground/60 hover:text-foreground"
                          onClick={handleOpenFolderDialog}
                        >
                          <FolderPlus className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>添加文件夹</p>
                      </TooltipContent>
                    </Tooltip>
                    <ModelSelector
                      filterChannelId={agentChannelId}
                      externalSelectedModel={externalSelectedModel}
                      onModelSelect={handleModelSelect}
                    />
                    <ContextUsageBadge
                      inputTokens={contextStatus.inputTokens}
                      contextWindow={contextStatus.contextWindow}
                      isCompacting={contextStatus.isCompacting}
                      isProcessing={streaming}
                      onCompact={handleCompact}
                    />
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {streaming ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[30px] rounded-full text-destructive hover:bg-destructive/10"
                    onClick={handleStop}
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
      </div>

      {/* 文件浏览器侧面板 */}
      {fileBrowserOpen && sessionPath && (
        <div className="w-[300px] border-l flex-shrink-0">
          <FileBrowser
            rootPath={sessionPath}
            onClose={() => setFileBrowserOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
