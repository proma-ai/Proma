/**
 * AgentView — Agent 模式主视图容器
 *
 * 职责：
 * - 加载当前 Agent 会话消息
 * - 发送/停止/压缩 Agent 消息
 * - 附件上传处理
 * - AgentHeader 支持标题编辑 + 文件浏览器切换
 *
 * 注意：IPC 流式事件监听已提升到全局 useGlobalAgentListeners，
 * 本组件为纯展示 + 交互组件。
 *
 * 布局：AgentHeader | AgentMessages | AgentInput + 可选 FileBrowser 侧面板
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Bot, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, AlertCircle, X, FolderOpen, Copy, Check, Sparkles } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { PermissionModeSelector } from './PermissionModeSelector'
import { AskUserBanner } from './AskUserBanner'
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
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtom,
  agentWorkspacesAtom,
  agentContextStatusAtom,
  agentStreamErrorsAtom,
  currentAgentErrorAtom,
  currentAgentSessionDraftAtom,
  agentPromptSuggestionsAtom,
  currentAgentSuggestionAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentSendInput, AgentMessage, AgentPendingFile, AgentSavedFile, ModelOption } from '@proma/shared'
import { PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'

/** 将 File 对象转为 base64 字符串 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]!
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function AgentView(): React.ReactElement {
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const [currentMessages, setCurrentMessages] = useAtom(currentAgentMessagesAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streaming = useAtomValue(agentStreamingAtom)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const contextStatus = useAtomValue(agentContextStatusAtom)
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const agentError = useAtomValue(currentAgentErrorAtom)
  const store = useStore()
  const suggestion = useAtomValue(currentAgentSuggestionAtom)
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)

  const [inputContent, setInputContent] = useAtom(currentAgentSessionDraftAtom)
  const [fileBrowserOpen, setFileBrowserOpen] = React.useState(false)
  const [sessionPath, setSessionPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [pendingFolderRefs, setPendingFolderRefs] = React.useState<AgentSavedFile[]>([])
  const [isUploadingFolder, setIsUploadingFolder] = React.useState(false)
  const [dragFolderWarning, setDragFolderWarning] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    window.electronAPI.listChannels().then((channels) => {
      const channel = channels.find((c) => c.id === agentChannelId && c.enabled)
      if (!channel) return

      // Agent 优先使用 agentModels，回退到 models
      const modelList = channel.agentModels ?? channel.models
      // Proma 官方渠道优先选择默认 Agent 模型
      const preferredModel = channel.provider === 'proma'
        ? modelList.find((m) => m.id === PROMA_OFFICIAL_DEFAULT_AGENT_MODEL && m.enabled)
        : undefined
      const firstModel = preferredModel ?? modelList.find((m) => m.enabled)
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
        map.set(currentSessionId, {
          running: true,
          content: '',
          toolActivities: [],
          model: agentModelId || undefined,
          startedAt: Date.now(),
        })
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

  /** 为文件生成唯一文件名（避免粘贴多张图片时文件名重复导致覆盖） */
  const makeUniqueFilename = React.useCallback((originalName: string, existingNames: string[]): string => {
    if (!existingNames.includes(originalName)) return originalName
    const dotIdx = originalName.lastIndexOf('.')
    const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName
    const ext = dotIdx > 0 ? originalName.slice(dotIdx) : ''
    let counter = 1
    while (existingNames.includes(`${baseName}-${counter}${ext}`)) {
      counter++
    }
    return `${baseName}-${counter}${ext}`
  }, [])

  /** 将 File 对象列表添加为待发送附件 */
  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    // 收集已有的 pending 文件名，用于去重
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const uniqueFilename = makeUniqueFilename(file.name, usedNames)
        usedNames.push(uniqueFilename)

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
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
  }, [makeUniqueFilename, setPendingFiles])

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
    if (!currentSessionId || !currentWorkspaceId || isUploadingFolder) return

    const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!workspace) return

    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      setIsUploadingFolder(true)
      console.log(`[AgentView] 开始复制文件夹: ${result.path}`)

      const saved = await window.electronAPI.copyFolderToSession({
        sourcePath: result.path,
        workspaceSlug: workspace.slug,
        sessionId: currentSessionId,
      })

      setPendingFolderRefs((prev) => [...prev, ...saved])
      console.log(`[AgentView] 文件夹复制成功，共 ${saved.length} 个文件`)
    } catch (error) {
      console.error('[AgentView] 文件夹选择失败:', error)
      // 显示错误提示
      setAgentStreamErrors((prev) => {
        const map = new Map(prev)
        map.set(currentSessionId, `文件夹上传失败: ${error instanceof Error ? error.message : '未知错误'}`)
        return map
      })
    } finally {
      setIsUploadingFolder(false)
    }
  }, [currentSessionId, currentWorkspaceId, workspaces, isUploadingFolder, setAgentStreamErrors])

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
    let hasFolders = false

    // 使用 webkitGetAsEntry 区分文件和文件夹
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        // 检测到文件夹，显示警告
        hasFolders = true
        console.warn('[AgentView] 拖拽文件夹已禁用，请使用"添加文件夹"按钮')
      } else {
        const file = item.getAsFile()
        if (file) regularFiles.push(file)
      }
    }

    // 如果检测到文件夹，显示提示
    if (hasFolders) {
      setDragFolderWarning(true)
      setTimeout(() => setDragFolderWarning(false), 3000)
    }

    // 只处理普通文件
    if (regularFiles.length > 0) {
      addFilesAsAttachments(regularFiles)
    }
  }, [addFilesAsAttachments])

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
    // 如果输入为空但有建议，使用建议内容
    const effectiveText = text || suggestion || ''
    if ((!effectiveText && pendingFiles.length === 0 && pendingFolderRefs.length === 0) || !currentSessionId || !agentChannelId) return

    // 上一条消息仍在处理中，提示用户等待或停止
    if (streaming) {
      toast.info('上一条消息还在处理中', {
        description: '请等待完成后发送，或点击右下角停止按钮结束当前任务',
      })
      return
    }

    // 清除当前会话的错误消息
    setAgentStreamErrors((prev) => {
      if (!prev.has(currentSessionId)) return prev
      const map = new Map(prev)
      map.delete(currentSessionId)
      return map
    })

    // 清除当前会话的提示建议
    setPromptSuggestions((prev) => {
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
    const finalMessage = fileReferences + effectiveText

    // 防御性快照：将当前流式 assistant 内容保存到消息列表
    // 避免重置流式状态时丢失前一轮回复（竞态场景：complete 事件到达但 STREAM_COMPLETE 尚未到达）
    const prevStream = store.get(agentStreamingStatesAtom).get(currentSessionId)
    if (prevStream && prevStream.content && !prevStream.running) {
      setCurrentMessages((prev) => {
        // 仅在最后一条不是 assistant 消息时追加（避免重复）
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') return prev
        return [...prev, {
          id: `snapshot-${Date.now()}`,
          role: 'assistant' as const,
          content: prevStream.content,
          createdAt: Date.now(),
          model: prevStream.model,
        }]
      })
    }

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(currentSessionId, {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
      })
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
  }, [inputContent, pendingFiles, pendingFolderRefs, currentSessionId, agentChannelId, agentModelId, currentWorkspaceId, workspaces, streaming, suggestion, store, setStreamingStates, setCurrentMessages, setPendingFiles, setAgentStreamErrors, setPromptSuggestions])

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
      const current = prev.get(currentSessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: Date.now(),
      }
      map.set(currentSessionId, { ...current, running: true, startedAt: current.startedAt ?? Date.now() })
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

  /** 复制错误信息到剪贴板 */
  const handleCopyError = React.useCallback(async (): Promise<void> => {
    if (!agentError) return

    try {
      await navigator.clipboard.writeText(agentError)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    } catch (error) {
      console.error('[AgentView] 复制错误信息失败:', error)
    }
  }, [agentError])

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
        <AgentHeader />

        {/* 消息区域 */}
        <AgentMessages />

        {/* 拖拽文件夹警告 */}
        {dragFolderWarning && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm flex items-center gap-2">
            <FolderPlus className="size-4 shrink-0" />
            <span className="flex-1">不支持拖拽文件夹，请使用"添加文件夹"按钮</span>
            <button
              type="button"
              className="shrink-0 p-0.5 rounded hover:bg-amber-500/10 transition-colors"
              onClick={() => setDragFolderWarning(false)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* 权限请求横幅 */}
        <PermissionBanner />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner />

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

            {/* Agent 建议提示 */}
            {suggestion && !streaming && (
              <div className="px-3 pb-1.5">
                <button
                  type="button"
                  className="group flex items-start gap-2 w-full rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.06]"
                  onClick={handleSend}
                >
                  <Sparkles className="size-4 shrink-0 mt-0.5 text-primary/60 group-hover:text-primary/80" />
                  <span className="flex-1 min-w-0 text-foreground/80 group-hover:text-foreground line-clamp-3">{suggestion}</span>
                  <X
                    className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPromptSuggestions((prev) => {
                        if (!currentSessionId || !prev.has(currentSessionId)) return prev
                        const map = new Map(prev)
                        map.delete(currentSessionId)
                        return map
                      })
                    }}
                  />
                </button>
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
              autoFocusTrigger={currentSessionId}
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
                          className="size-[30px] rounded-full text-foreground/60 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={handleOpenFolderDialog}
                          disabled={isUploadingFolder}
                        >
                          <FolderPlus className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{isUploadingFolder ? '正在上传文件夹...' : '添加文件夹'}</p>
                      </TooltipContent>
                    </Tooltip>
                    <PermissionModeSelector />
                    <ModelSelector
                      filterChannelId={agentChannelId}
                      externalSelectedModel={externalSelectedModel}
                      onModelSelect={handleModelSelect}
                      useAgentModels
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

      {/* 文件浏览器侧栏 — 始终渲染 w-10 占位，避免切换模式时布局跳动 */}
      <div
        className={cn(
          'relative flex-shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden titlebar-drag-region',
          sessionPath && fileBrowserOpen ? 'w-[300px] border-l' : 'w-10'
        )}
      >
        {sessionPath && (
          <>
            {/* 切换按钮 — 始终固定在右上角，同一个 DOM 元素 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2.5 top-2.5 z-10 h-7 w-7 titlebar-no-drag"
                  onClick={() => setFileBrowserOpen((prev) => !prev)}
                >
                  <FolderOpen
                    className={cn(
                      'size-3.5 absolute transition-all duration-200',
                      fileBrowserOpen ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'
                    )}
                  />
                  <X
                    className={cn(
                      'size-3.5 absolute transition-all duration-200',
                      fileBrowserOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{fileBrowserOpen ? '关闭文件浏览器' : '打开文件浏览器'}</p>
              </TooltipContent>
            </Tooltip>

            {/* FileBrowser 内容 — 收起时隐藏 */}
            <div className={cn(
              'w-[300px] h-full transition-opacity duration-300 titlebar-no-drag',
              fileBrowserOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}>
              <FileBrowser rootPath={sessionPath} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
