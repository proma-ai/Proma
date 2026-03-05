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
import { Bot, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, X, Copy, Check, Sparkles } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { PermissionModeSelector } from './PermissionModeSelector'
import { AskUserBanner } from './AskUserBanner'
import { SidePanel } from './SidePanel'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  agentStreamingStatesAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtom,
  agentWorkspacesAtom,
  agentStreamErrorsAtom,
  agentSessionDraftsAtom,
  agentPromptSuggestionsAtom,
  agentMessageRefreshAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  cachedTeamOverviewsAtom,
  cachedTeammateStatesAtom,
  cachedTeamActivitiesAtom,
  dismissedTeamSessionIdsAtom,
  buildTeamActivityEntries,
  rebuildTeamDataFromMessages,
  agentAttachedDirectoriesMapAtom,
} from '@/atoms/agent-atoms'
import type { AgentContextStatus } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { AgentSessionProvider } from '@/contexts/session-context'
import type { AgentSendInput, AgentMessage, AgentPendingFile, AgentSavedFile, ModelOption } from '@proma/shared'
import { PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'
import { fileToBase64 } from '@/lib/file-utils'

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const streamState = streamingStates.get(sessionId)
  const streaming = streamState?.running ?? false
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const contextStatus: AgentContextStatus = {
    isCompacting: streamState?.isCompacting ?? false,
    inputTokens: streamState?.inputTokens,
    contextWindow: streamState?.contextWindow,
  }
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const streamErrors = useAtomValue(agentStreamErrorsAtom)
  const agentError = streamErrors.get(sessionId) ?? null
  const store = useStore()
  const suggestionsMap = useAtomValue(agentPromptSuggestionsAtom)
  const suggestion = suggestionsMap.get(sessionId) ?? null
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []

  const draftsMap = useAtomValue(agentSessionDraftsAtom)
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const inputContent = draftsMap.get(sessionId) ?? ''
  const setInputContent = React.useCallback((value: string) => {
    setDraftsMap((prev) => {
      const map = new Map(prev)
      if (value.trim() === '') {
        map.delete(sessionId)
      } else {
        map.set(sessionId, value)
      }
      return map
    })
  }, [sessionId, setDraftsMap])
  const [sessionPath, setSessionPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
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
    if (!currentWorkspaceId) {
      setSessionPath(null)
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, sessionId)
      .then(setSessionPath)
      .catch(() => setSessionPath(null))
  }, [sessionId, currentWorkspaceId])

  // 监听消息刷新版本号
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0

  // 加载当前会话消息
  React.useEffect(() => {
    window.electronAPI
      .getAgentSessionMessages(sessionId)
      .then((msgs) => {
        setMessages(msgs)

        // 从持久化消息中重建 Team 数据并填充缓存（页面刷新后恢复）
        const teamData = rebuildTeamDataFromMessages(msgs)
        if (teamData) {
          if (teamData.overview) {
            store.set(cachedTeamOverviewsAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, teamData.overview!)
              return map
            })
          }
          if (teamData.teammates.length > 0) {
            store.set(cachedTeammateStatesAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, teamData.teammates)
              return map
            })
          }
          const entries = buildTeamActivityEntries(teamData.toolActivities)
          if (entries.length > 0) {
            store.set(cachedTeamActivitiesAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, entries)
              return map
            })
          }
        }

        // 消息加载完成后，清除已完成的流式状态（running=false 的过渡气泡）
        // 在同一个微任务中执行，确保 React 在一次渲染中同时显示持久化消息并移除流式气泡
        setStreamingStates((prev) => {
          const state = prev.get(sessionId)
          if (!state || state.running) return prev  // 仍在运行中，不清除
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
      .catch(console.error)
  }, [sessionId, refreshVersion, setStreamingStates, store])

  // 从会话元数据初始化附加目录
  const sessions = useAtomValue(agentSessionsAtom)
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const dirs = meta?.attachedDirectories ?? []
    setAttachedDirsMap((prev) => {
      const existing = prev.get(sessionId)
      // 避免不必要的更新
      if (JSON.stringify(existing) === JSON.stringify(dirs)) return prev
      const map = new Map(prev)
      if (dirs.length > 0) {
        map.set(sessionId, dirs)
      } else {
        map.delete(sessionId)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedDirsMap])

  // 自动发送 pending prompt（从设置页"对话完成配置"触发）
  React.useEffect(() => {
    if (!pendingPrompt) return
    if (pendingPrompt.sessionId !== sessionId) return
    if (!agentChannelId || streaming) return

    // 立即清除，防止重复执行
    const prompt = pendingPrompt
    setPendingPrompt(null)

    // 短延时确保 IPC 订阅已就绪
    const timer = setTimeout(() => {
      // 初始化流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          teammates: [],
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
      setMessages((prev) => [...prev, tempUserMsg])

      // 发送消息
      const input: AgentSendInput = {
        sessionId,
        userMessage: prompt.message,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        workspaceId: currentWorkspaceId || undefined,
      }
      window.electronAPI.sendAgentMessage(input).catch((error) => {
        console.error('[AgentView] 自动发送配置消息失败:', error)
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
    }, 150)

    return () => clearTimeout(timer)
  }, [pendingPrompt, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates])

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

  /** 附加文件夹（不复制，仅记录路径） */
  const handleAttachFolder = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      const updated = await window.electronAPI.attachDirectory({
        sessionId,
        directoryPath: result.path,
      })

      setAttachedDirsMap((prev) => {
        const map = new Map(prev)
        map.set(sessionId, updated)
        return map
      })

      toast.success(`已附加目录: ${result.name}`)
    } catch (error) {
      console.error('[AgentView] 附加文件夹失败:', error)
      toast.error('附加文件夹失败')
    }
  }, [sessionId, setAttachedDirsMap])

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
    if ((!effectiveText && pendingFiles.length === 0) || !agentChannelId) return

    // 上一条消息仍在处理中，提示用户等待或停止
    if (streaming) {
      toast.info('上一条消息还在处理中', {
        description: '请等待完成后发送，或点击右下角停止按钮结束当前任务',
      })
      return
    }

    // 清除当前会话的错误消息
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 清除当前会话的提示建议
    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
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
            sessionId,
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

    // 2. 构建最终消息
    const finalMessage = fileReferences + effectiveText

    // 防御性快照：将当前流式 assistant 内容保存到消息列表
    // 避免重置流式状态时丢失前一轮回复（竞态场景：complete 事件到达但 STREAM_COMPLETE 尚未到达）
    const prevStream = store.get(agentStreamingStatesAtom).get(sessionId)
    if (prevStream && prevStream.content && !prevStream.running) {
      setMessages((prev) => {
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

    // 新一轮对话开始时，解除 Team 面板关闭状态（允许新 Team 数据显示）
    store.set(dismissedTeamSessionIdsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
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
    setMessages((prev) => [...prev, tempUserMsg])

    const input: AgentSendInput = {
      sessionId,
      userMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      ...(attachedDirs.length > 0 && { additionalDirectories: attachedDirs }),
    }

    setInputContent('')

    window.electronAPI.sendAgentMessage(input).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      setStreamingStates((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
    })
  }, [inputContent, pendingFiles, attachedDirs, sessionId, agentChannelId, agentModelId, currentWorkspaceId, workspaces, streaming, suggestion, store, setStreamingStates, setPendingFiles, setAgentStreamErrors, setPromptSuggestions, setInputContent])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current) return prev
      const map = new Map(prev)
      map.set(sessionId, { ...current, running: false })
      return map
    })

    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }, [sessionId, setStreamingStates])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback((): void => {
    if (!agentChannelId || streaming) return

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(sessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
        model: agentModelId || undefined,
        startedAt: Date.now(),
      }
      map.set(sessionId, { ...current, running: true, startedAt: current.startedAt ?? Date.now() })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }).catch(console.error)
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setStreamingStates])

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

  /** 重试：在当前会话中重新发送最后一条用户消息 */
  const handleRetry = React.useCallback((): void => {
    if (!agentChannelId || streaming) return

    // 找到最后一条用户消息
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return

    // 清除错误状态
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 初始化流式状态
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
        model: agentModelId || undefined,
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: lastUserMsg.content,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }).catch(console.error)
  }, [messages, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setAgentStreamErrors, setStreamingStates])

  /** 在新会话中重试：创建新会话 + 切换 tab + 发送引用旧会话的提示词 */
  const handleRetryInNewSession = React.useCallback(async (): Promise<void> => {
    if (!agentChannelId) return

    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined, agentChannelId, currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])

      // 切换到新会话 tab
      const result = openTab(tabs, layout, { type: 'agent', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentAgentSessionId(meta.id)

      // 发送引用旧会话的默认提示词
      const prompt = `上个会话的 id 是 ${sessionId}，可以参考同工作区下的会话继续完成工作`

      // 初始化新会话流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(meta.id, {
          running: true,
          content: '',
          toolActivities: [],
          teammates: [],
          model: agentModelId || undefined,
        })
        return map
      })

      window.electronAPI.sendAgentMessage({
        sessionId: meta.id,
        userMessage: prompt,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        workspaceId: currentWorkspaceId || undefined,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, tabs, layout, setAgentSessions, setCurrentAgentSessionId, setTabs, setLayout, setStreamingStates])

  const canSend = (inputContent.trim().length > 0 || pendingFiles.length > 0) && agentChannelId !== null && !streaming

  return (
    <AgentSessionProvider sessionId={sessionId}>
    <div className="flex h-full overflow-hidden">
      {/* 主内容区域 */}
      <div className="flex flex-col h-full flex-1 min-w-0 max-w-[min(72rem,100%)] mx-auto">
        {/* Agent Header */}
        <AgentHeader sessionId={sessionId} />

        {/* 消息区域 */}
        <AgentMessages
          sessionId={sessionId}
          messages={messages}
          streaming={streaming}
          streamState={streamState}
          onRetry={handleRetry}
          onRetryInNewSession={handleRetryInNewSession}
        />

        {/* 拖拽文件夹警告 */}
        {dragFolderWarning && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm flex items-center gap-2">
            <FolderPlus className="size-4 shrink-0" />
            <span className="flex-1">不支持拖拽文件夹，请使用"附加文件夹"按钮</span>
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
        <PermissionBanner sessionId={sessionId} />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner sessionId={sessionId} />

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
                        if (!prev.has(sessionId)) return prev
                        const map = new Map(prev)
                        map.delete(sessionId)
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
              autoFocusTrigger={sessionId}
              collapsible
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
                          onClick={handleAttachFolder}
                        >
                          <FolderPlus className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>附加文件夹</p>
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

      {/* 侧面板（Team Activity + File Browser） */}
      <SidePanel sessionId={sessionId} sessionPath={sessionPath} />
    </div>
    </AgentSessionProvider>
  )
}
