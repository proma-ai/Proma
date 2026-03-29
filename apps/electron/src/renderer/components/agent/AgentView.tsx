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
import { Bot, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, X, Copy, Check, Sparkles, Brain, Map as MapIcon } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { PermissionModeSelector } from './PermissionModeSelector'
import { AskUserBanner } from './AskUserBanner'
import { ExitPlanModeBanner } from './ExitPlanModeBanner'
import { SidePanel } from './SidePanel'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FeishuNotifyToggle } from '@/components/chat/FeishuNotifyToggle'
import {
  agentStreamingStatesAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
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
  agentAttachedDirectoriesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  liveMessagesMapAtom,
  agentThinkingAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
} from '@/atoms/agent-atoms'
import type { AgentContextStatus } from '@/atoms/agent-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { channelsAtom } from '@/atoms/chat-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { AgentSessionProvider } from '@/contexts/session-context'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import type { AgentSendInput, AgentMessage, AgentPendingFile, AgentSavedFile, ModelOption, SDKMessage } from '@proma/shared'
import { PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'
import { fileToBase64 } from '@/lib/file-utils'

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [persistedSDKMessages, setPersistedSDKMessages] = React.useState<SDKMessage[]>([])
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const streamState = streamingStates.get(sessionId)
  const streaming = streamState?.running ?? false
  const liveMessagesMap = useAtomValue(liveMessagesMapAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  const liveMessages = liveMessagesMap.get(sessionId) ?? []
  // Per-session 渠道/模型配置（优先读 session map，回退到全局默认值）
  const sessionChannelMap = useAtomValue(agentSessionChannelMapAtom)
  const sessionModelMap = useAtomValue(agentSessionModelMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const [defaultChannelId, setDefaultChannelId] = useAtom(agentChannelIdAtom)
  const [defaultModelId, setDefaultModelId] = useAtom(agentModelIdAtom)
  const agentChannelId = sessionChannelMap.get(sessionId) ?? defaultChannelId
  const agentModelId = sessionModelMap.get(sessionId) ?? defaultModelId
  const agentChannelIds = useAtomValue(agentChannelIdsAtom)
  const [agentThinking, setAgentThinking] = useAtom(agentThinkingAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  // 保持 channelId 稳定：初始化前使用上次有效值，避免工具栏抖动
  const stableChannelIdRef = React.useRef(agentChannelId)
  if (agentChannelId) stableChannelIdRef.current = agentChannelId
  const stableChannelId = agentChannelId ?? stableChannelIdRef.current

  // 已有会话首次打开时，从全局默认值初始化 per-session map
  React.useEffect(() => {
    if (!sessionId) return
    if (!sessionChannelMap.has(sessionId) && defaultChannelId) {
      setSessionChannelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, defaultChannelId)
        return map
      })
    }
    if (!sessionModelMap.has(sessionId) && defaultModelId) {
      setSessionModelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, defaultModelId)
        return map
      })
    }
  }, [sessionId, sessionChannelMap, sessionModelMap, defaultChannelId, defaultModelId, setSessionChannelMap, setSessionModelMap])

  const contextStatus: AgentContextStatus = {
    isCompacting: streamState?.isCompacting ?? false,
    inputTokens: streamState?.inputTokens,
    contextWindow: streamState?.contextWindow,
  }
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const streamErrors = useAtomValue(agentStreamErrorsAtom)
  const agentError = streamErrors.get(sessionId) ?? null
  const planModeSessions = useAtomValue(agentPlanModeSessionsAtom)
  const isPlanMode = planModeSessions.has(sessionId)
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
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []

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
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [dragFolderWarning, setDragFolderWarning] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  const globalChannels = useAtomValue(channelsAtom)
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    const channel = globalChannels.find((c) => c.id === agentChannelId && c.enabled)
    if (!channel) return

      // Agent 优先使用 agentModels，回退到 models
      const modelList = channel.agentModels ?? channel.models
      // Proma 官方渠道优先选择默认 Agent 模型
      const preferredModel = channel.provider === 'proma'
        ? modelList.find((m) => m.id === PROMA_OFFICIAL_DEFAULT_AGENT_MODEL && m.enabled)
        : undefined
      const firstModel = preferredModel ?? modelList.find((m) => m.enabled)
      if (!firstModel) return

    // 更新 per-session map
    setSessionModelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, firstModel.id)
      return map
    })
    // 同步全局默认值
    setDefaultModelId(firstModel.id)
    window.electronAPI.updateSettings({
      agentChannelId,
      agentModelId: firstModel.id,
    }).catch(console.error)
  }, [agentChannelId, agentModelId, globalChannels, sessionId, setSessionModelMap, setDefaultModelId])

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

  // 获取工作区共享文件目录路径（@ 引用时需要搜索）
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI
      .getWorkspaceFilesPath(workspaceSlug)
      .then(setWorkspaceFilesPath)
      .catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  // 合并工作区文件目录、工作区级附加目录和会话级附加目录，供 @ 引用搜索
  const allAttachedDirs = React.useMemo(() => {
    const dirs = [...attachedDirs]
    // 添加工作区级附加目录
    for (const d of wsAttachedDirs) {
      if (!dirs.includes(d)) dirs.push(d)
    }
    // 添加工作区共享文件目录
    if (workspaceFilesPath && !dirs.includes(workspaceFilesPath)) {
      dirs.unshift(workspaceFilesPath)
    }
    return dirs
  }, [attachedDirs, wsAttachedDirs, workspaceFilesPath])

  // 监听消息刷新版本号
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0

  // 消息是否已完成首次加载（用于 auto-send 等待）
  const [messagesLoaded, setMessagesLoaded] = React.useState(false)

  // 加载当前会话消息
  React.useEffect(() => {
    setMessagesLoaded(false)
    // 并行加载旧格式（用于 Team 数据重建）和新格式（用于 UI 渲染）
    const loadOldMessages = window.electronAPI.getAgentSessionMessages(sessionId)
    const loadSDKMessages = window.electronAPI.getAgentSessionSDKMessages(sessionId)

    Promise.all([loadOldMessages, loadSDKMessages])
      .then(([msgs, sdkMsgs]) => {
        setMessages(msgs)
        setPersistedSDKMessages(sdkMsgs)
        setMessagesLoaded(true)

        // 消息加载完成后，同步清除流式状态和实时消息，
        // 确保 React 在一次渲染中同时显示持久化消息并移除流式气泡/实时消息，
        // 避免「实时消息已清 → 持久化消息未到」的空档闪烁
        setStreamingStates((prev) => {
          const state = prev.get(sessionId)
          if (!state || state.running) return prev  // 仍在运行中，不清除
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
        setLiveMessagesMap((prev) => {
          if (!prev.has(sessionId)) return prev
          // 仍在运行中，不清除实时消息（与 streamingStates 保护逻辑一致）
          const streamingState = store.get(agentStreamingStatesAtom).get(sessionId)
          if (streamingState?.running) return prev
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
      .catch(console.error)
  }, [sessionId, refreshVersion, setStreamingStates, setLiveMessagesMap, store])

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

  // 自动发送 pending prompt（从快速任务窗口或设置页触发）
  // 等待 messagesLoaded 确保消息加载完成后再插入乐观消息，避免被加载结果覆盖。
  // 使用 queueMicrotask 延迟发送：避免 setState → 重渲染 → cleanup 取消 timer 的竞态。
  React.useEffect(() => {
    if (!messagesLoaded) return
    if (!pendingPrompt) return
    if (pendingPrompt.sessionId !== sessionId) return
    if (!agentChannelId || streaming) return

    // 快照当前上下文
    const snapshot = {
      message: pendingPrompt.message,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }
    setPendingPrompt(null)

    queueMicrotask(() => {
      // 初始化流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          teammates: [],
          model: snapshot.modelId,
          startedAt: Date.now(),
        })
        return map
      })

      // 乐观更新：显示用户消息
      const tempUserMsg: AgentMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: snapshot.message,
        createdAt: Date.now(),
      }
      setMessages((prev) => [...prev, tempUserMsg])

      // 乐观更新：SDKMessage 格式（Phase 4）
      const tempUserSDKMsg: SDKMessage = {
        type: 'user',
        message: {
          content: [{ type: 'text', text: snapshot.message }],
        },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage
      setPersistedSDKMessages((prev) => [...prev, tempUserSDKMsg])

      // 发送消息
      const input: AgentSendInput = {
        sessionId,
        userMessage: snapshot.message,
        channelId: snapshot.channelId,
        modelId: snapshot.modelId,
        workspaceId: snapshot.workspaceId,
      }
      window.electronAPI.sendAgentMessage(input).catch((error) => {
        console.error('[AgentView] 自动发送配置消息失败:', error)
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
    })
  }, [messagesLoaded, pendingPrompt, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates])

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
    // 更新当前会话的 per-session 配置
    setSessionChannelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, option.channelId)
      return map
    })
    setSessionModelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, option.modelId)
      return map
    })

    // 同时更新全局默认值（新会话继承）
    setDefaultChannelId(option.channelId)
    setDefaultModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)
  }, [sessionId, setSessionChannelMap, setSessionModelMap, setDefaultChannelId, setDefaultModelId])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const externalSelectedModel = React.useMemo(() => {
    if (!agentChannelId || !agentModelId) return null
    return { channelId: agentChannelId, modelId: agentModelId }
  }, [agentChannelId, agentModelId])

  /** 发送消息 */
  const handleSend = React.useCallback(async (): Promise<void> => {
    const text = inputContent.trim()
    // 如果输入为空但有建议，使用建议内容
    const effectiveText = text || suggestion || ''
    if ((!effectiveText && pendingFiles.length === 0) || !agentChannelId) return

    // 上一条消息仍在处理中，直接追加发送
    if (streaming) {
      // 流式追加时不处理附件（仅支持纯文本）
      if (pendingFiles.length > 0) {
        toast.info('Agent 运行中暂不支持追加发送附件', {
          description: '请等待完成后再发送附件，或先撤除附件仅发送文本',
        })
        return
      }

      const localUuid = crypto.randomUUID()

      // 1. 立即注入 liveMessages（作为普通用户消息显示）
      const syntheticMsg: import('@proma/shared').SDKMessage = {
        type: 'user',
        uuid: localUuid,
        message: {
          content: [{ type: 'text', text: effectiveText }],
        },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as import('@proma/shared').SDKMessage

      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        map.set(sessionId, [...current, syntheticMsg])
        return map
      })

      // 2. 清空输入框
      setInputContent('')
      setPromptSuggestions((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })

      // 3. 异步发送到后端（'now' 优先级立即注入 SDK + 持久化 JSONL）
      window.electronAPI.queueAgentMessage({
        sessionId,
        userMessage: effectiveText,
        uuid: localUuid,
      }).then(() => {
        toast.info('消息已追加发送')
      }).catch((error) => {
        console.error('[AgentView] 追加消息失败:', error)
        toast.error('追加消息失败', { description: String(error) })
        // 回滚：从 liveMessages 移除
        store.set(liveMessagesMapAtom, (prev) => {
          const map = new Map(prev)
          const current = (map.get(sessionId) ?? []).filter(
            (m) => (m as unknown as { uuid?: string }).uuid !== localUuid
          )
          map.set(sessionId, current)
          return map
        })
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

    // 清除打断状态（上一轮的打断标记不再显示）
    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    // 取消 draft 标记，让会话出现在侧边栏
    setDraftSessionIds((prev: Set<string>) => {
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
        startedAt: Date.now(),
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

    // 乐观更新：SDKMessage 格式的用户消息（Phase 4）
    const tempUserSDKMsg: SDKMessage = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: finalMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: Date.now(),
    } as unknown as SDKMessage
    setPersistedSDKMessages((prev) => [...prev, tempUserSDKMsg])

    const input: AgentSendInput = {
      sessionId,
      userMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      ...(attachedDirs.length > 0 && { additionalDirectories: attachedDirs }),
      // 解析用户消息中的 Skill/MCP 引用，传递结构化元数据给后端
      ...(() => {
        const skills = [...effectiveText.matchAll(/\/skill:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
        const mcps = [...effectiveText.matchAll(/#mcp:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
        return {
          ...(skills.length > 0 && { mentionedSkills: skills }),
          ...(mcps.length > 0 && { mentionedMcpServers: mcps }),
        }
      })(),
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
  }, [inputContent, pendingFiles, attachedDirs, sessionId, agentChannelId, agentModelId, currentWorkspaceId, workspaces, streaming, suggestion, store, setStreamingStates, setPendingFiles, setAgentStreamErrors, setPromptSuggestions, setInputContent, setLiveMessagesMap])

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
        startedAt: Date.now(),
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
          startedAt: Date.now(),
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

  /** 分叉会话：从指定消息处创建新会话并自动切换 */
  const handleFork = React.useCallback(async (upToMessageUuid: string): Promise<void> => {
    try {
      const meta = await window.electronAPI.forkAgentSession({
        sessionId,
        upToMessageUuid,
      })
      setAgentSessions((prev) => [meta, ...prev])

      // 切换到新会话 tab
      const result = openTab(tabs, layout, { type: 'agent', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentAgentSessionId(meta.id)

      toast.success('已创建分叉会话', {
        description: meta.title,
      })
    } catch (error) {
      console.error('[AgentView] 分叉会话失败:', error)
      toast.error('分叉会话失败', {
        description: error instanceof Error ? error.message : '未知错误',
      })
    }
  }, [sessionId, tabs, layout, setAgentSessions, setCurrentAgentSessionId, setTabs, setLayout])

  // 监听快捷键系统分发的 stop-generation 事件（Cmd+.）
  React.useEffect(() => {
    const handler = (): void => {
      if (streaming) handleStop()
    }
    window.addEventListener('proma:stop-generation', handler)
    return () => window.removeEventListener('proma:stop-generation', handler)
  }, [streaming, handleStop])

  // 监听快捷键系统分发的 focus-input 事件（Cmd+L）
  React.useEffect(() => {
    const handler = (): void => {
      const proseMirror = document.querySelector('[data-input-mode="agent"] .ProseMirror') as HTMLElement | null
      proseMirror?.focus()
    }
    window.addEventListener('proma:focus-input', handler)
    return () => window.removeEventListener('proma:focus-input', handler)
  }, [])

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
          persistedSDKMessages={persistedSDKMessages}
          streaming={streaming}
          streamState={streamState}
          liveMessages={liveMessages}
          sessionPath={sessionPath}
          onRetry={handleRetry}
          onRetryInNewSession={handleRetryInNewSession}
          onFork={handleFork}
          onCompact={handleCompact}
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

        {/* Plan 模式指示条 */}
        {isPlanMode && (
          <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-primary text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
            <MapIcon className="size-4 animate-pulse" />
            <span className="font-medium">Agent 正在规划中...</span>
            <span className="text-xs text-muted-foreground">完成后将请求你的审批</span>
          </div>
        )}

        {/* ExitPlanMode 计划审批横幅 */}
        <ExitPlanModeBanner sessionId={sessionId} />

        {/* 输入区域 — 复用 Chat 的卡片式输入风格 */}
        <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px] pt-2" data-input-mode="agent">
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
                  onClick={() => setSettingsOpen(true)}
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
                  ? '输入消息... (Enter 发送，Shift+Enter 换行，@ 引用文件，/ 调用 Skill，# 调用 MCP)'
                  : '请先在设置中选择 Agent 供应商'
              }
              disabled={!agentChannelId}
              autoFocusTrigger={sessionId}
              collapsible
              workspacePath={sessionPath}
              workspaceSlug={workspaceSlug}
              attachedDirs={allAttachedDirs}
            />

            {/* Footer 工具栏 */}
            <div className="flex items-center justify-between px-2 py-1 h-[48px] gap-4">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {agentChannelId && (
                  <>
                    <ModelSelector
                      filterChannelId={agentChannelId}
                      externalSelectedModel={externalSelectedModel}
                      onModelSelect={handleModelSelect}
                      useAgentModels
                    />
                    <PermissionModeSelector />
                    {/* 思考模式切换 */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'size-[36px] rounded-full',
                            agentThinking?.type === 'adaptive'
                              ? 'text-green-500'
                              : 'text-foreground/60 hover:text-foreground'
                          )}
                          onClick={() => {
                            const next = agentThinking?.type === 'adaptive'
                              ? { type: 'disabled' as const }
                              : { type: 'adaptive' as const }
                            setAgentThinking(next)
                            window.electronAPI.updateSettings({ agentThinking: next })
                          }}
                        >
                          <Brain className="size-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{agentThinking?.type === 'adaptive' ? '关闭思考模式' : '开启思考模式（自适应）'}</p>
                      </TooltipContent>
                    </Tooltip>
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
                    <ContextUsageBadge
                      inputTokens={contextStatus.inputTokens}
                      outputTokens={contextStatus.outputTokens}
                      cacheReadTokens={contextStatus.cacheReadTokens}
                      cacheCreationTokens={contextStatus.cacheCreationTokens}
                      contextWindow={contextStatus.contextWindow}
                      isCompacting={contextStatus.isCompacting}
                      isProcessing={streaming}
                      onCompact={handleCompact}
                    />
                    <FeishuNotifyToggle sessionId={sessionId} />
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {streaming ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[36px] rounded-full text-destructive hover:bg-destructive/10"
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
      </div>

      {/* 侧面板（Team Activity + File Browser） */}
      <SidePanel sessionId={sessionId} sessionPath={sessionPath} />
    </div>
    </AgentSessionProvider>
  )
}
