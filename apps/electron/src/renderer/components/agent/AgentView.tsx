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
import { unstable_batchedUpdates } from 'react-dom'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Box, CornerDownLeft, Square, Settings, Paperclip, FolderPlus, X, Copy, Check, Brain, Sparkles, Eye, ChevronDown } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { AgentHeader } from './AgentHeader'
import { AgentMessageQueue } from './AgentMessageQueue'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { PermissionModeSelector } from './PermissionModeSelector'
import { AskUserBanner } from './AskUserBanner'
import { ExitPlanModeBanner } from './ExitPlanModeBanner'
import { PlanModeDashedBorder } from './PlanModeDashedBorder'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { AttachmentPreviewItem } from '@/components/chat/AttachmentPreviewItem'
import { QuotedSelectionChip } from '@/components/diff/QuotedSelectionChip'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import { InputToolbarOverflow, type ToolbarItem } from '@/components/ai-elements/InputToolbarOverflow'
import {
  inputToolbarActiveButtonClass,
  inputToolbarButtonClass,
  inputToolbarDangerButtonClass,
  inputToolbarDisabledButtonClass,
  inputToolbarSendButtonClass,
} from '@/components/ai-elements/input-toolbar-styles'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { nextAgentChannelIdsAfterModelSelect } from '@/lib/agent-channel-selection'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { registerShortcut } from '@/lib/shortcut-registry'
import { supportsChannelPlanQuota } from '@/lib/channel-plan-quota'
import { previewPanelOpenMapAtom, quotedSelectionMapAtom, currentQuotedSelectionAtom } from '@/atoms/preview-atoms'
import type { QuotedSelection } from '@/atoms/preview-atoms'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentRuntimeAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtomFamily,
  agentMessageQueueAtomFamily,
  agentWorkspacesAtom,
  agentStreamErrorsAtom,
  agentSessionDraftsAtom,
  agentSessionDraftAtomFamily,
  agentSessionDraftHtmlAtom,
  agentSessionDraftHtmlAtomFamily,
  agentPromptSuggestionsAtom,
  agentMessageRefreshAtom,
  agentSDKMessagesCacheAtom,
  setSessionMessagesCache,
  agentDiffRefreshVersionAtom,
  agentSessionsAtom,
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
  liveMessagesMapAtom,
  agentThinkingAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  sessionPersistedPermissionModeAtom,
  agentSessionPathMapAtom,
  allPendingAskUserRequestsAtom,
  allPendingPermissionRequestsAtom,
  allPendingExitPlanRequestsAtom,
  finalizeStreamingActivities,
  agentProcessGroupsKeepExpandedAtom,
} from '@/atoms/agent-atoms'
import type { AgentContextStatus } from '@/atoms/agent-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { longTextPasteAsAttachmentEnabledAtom } from '@/atoms/ui-preferences'
import { channelsAtom, thinkingExpandedAtom } from '@/atoms/chat-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { AgentSessionProvider } from '@/contexts/session-context'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'
import type { AgentRuntime, AgentSendInput, AgentPendingFile, FileDialogLargeFile, ModelOption, SDKMessage, SDKUserMessage, ProviderType } from '@proma/shared'
import { inferAgentSdkContextWindow, inferContextWindow, MAX_ATTACHMENT_SIZE } from '@proma/shared'
import { fileToBase64, formatFileNames, getFileParentPath } from '@/lib/file-utils'
import { buildQuotedSelectionBlock } from '@/lib/quoted-selection'
import { createClipboardPendingFile, createClipboardTextDraft, makeUniqueAttachmentName } from '@/lib/clipboard-text-attachment'
import {
  buildQueuedMessageSendPayload,
  createAgentQueuedMessage,
  moveQueuedMessage,
  parseQueuedMessageMentions,
  queuedTextToParagraphHtml,
  removeQueuedMessage,
  restoreQueuedMessageToFront,
} from '@/lib/agent-message-queue'
import type { AgentQueuedAttachment, AgentQueuedMessage, QueueDropPlacement } from '@/lib/agent-message-queue'

/** 稳定的空 SDKMessage 数组引用，避免 ?? [] 每次创建新引用 */
const EMPTY_SDK_MESSAGES: SDKMessage[] = []
const LONG_TEXT_ATTACHMENT_THRESHOLD = 2000

interface OptimisticSDKUserMessage extends SDKUserMessage {
  _createdAt: number
}

interface PreparedAgentAttachment {
  referenceBlock: string
  attachments: AgentQueuedAttachment[]
  additionalDirectories: string[]
}

function createUserSDKMessage(text: string, uuid?: string, createdAt = Date.now()): SDKMessage {
  const message: OptimisticSDKUserMessage = {
    type: 'user',
    uuid,
    message: {
      content: [{ type: 'text', text }],
    },
    parent_tool_use_id: null,
    _createdAt: createdAt,
  }
  return message
}

function resolveRunContextWindow(
  modelId: string | undefined,
  provider: ProviderType | undefined,
  previous: number | undefined,
): number | undefined {
  return provider
    ? inferAgentSdkContextWindow(modelId, provider) ?? previous
    : inferContextWindow(modelId) ?? previous
}

interface SDKMessageRecord {
  type?: string
  parent_tool_use_id?: string | null
  isSynthetic?: boolean
  message?: {
    content?: unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getUserTextFromSDKMessage(message: SDKMessage): string | null {
  const sdkMessage = message as unknown as SDKMessageRecord
  if (sdkMessage.type !== 'user' || sdkMessage.parent_tool_use_id || sdkMessage.isSynthetic) {
    return null
  }

  const content = sdkMessage.message?.content
  if (!Array.isArray(content)) return null
  if (content.some((block) => isRecord(block) && block.type === 'tool_result')) return null

  const texts = content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => (block as { text: string }).text)

  return texts.length > 0 ? texts.join('\n') : null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isStaleAgentQueueError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes('会话未运行，无法追加消息') ||
    message.includes('无活跃消息通道可注入队列消息')
}

// ===== 思考模式 Hover Popover =====

interface AgentThinkingPopoverProps {
  agentThinking: import('@proma/shared').ThinkingConfig | undefined
  onToggle: () => void
}

function AgentThinkingPopover({ agentThinking, onToggle }: AgentThinkingPopoverProps): React.ReactElement {
  const [thinkingExpanded, setThinkingExpanded] = useAtom(thinkingExpandedAtom)
  const [open, setOpen] = React.useState(false)
  const hoverTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEnabled = agentThinking?.type === 'adaptive'

  const handleMouseEnter = React.useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    setOpen(true)
  }, [])

  const handleMouseLeave = React.useCallback(() => {
    hoverTimeout.current = setTimeout(() => setOpen(false), 150)
  }, [])

  React.useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            inputToolbarButtonClass,
            isEnabled && inputToolbarActiveButtonClass
          )}
          onClick={onToggle}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Brain className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-auto min-w-[160px] p-2 px-2.5"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-foreground/70">思考模式</span>
            <Switch
              checked={isEnabled}
              onCheckedChange={onToggle}
              className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
            />
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-foreground/70">展开思考</span>
            <Switch
              checked={thinkingExpanded}
              onCheckedChange={setThinkingExpanded}
              className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const AGENT_RUNTIME_OPTIONS: Array<{ value: AgentRuntime; label: string; description: string }> = [
  { value: 'claude', label: 'Claude', description: '使用 Claude Agent SDK' },
  { value: 'pi', label: 'Pi', description: '使用 Pi Agent SDK' },
]

interface AgentRuntimeSelectorProps {
  runtime: AgentRuntime
  disabled?: boolean
  onChange: (runtime: AgentRuntime) => void
}

function AgentRuntimeSelector({ runtime, disabled = false, onChange }: AgentRuntimeSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const current = AGENT_RUNTIME_OPTIONS.find((option) => option.value === runtime) ?? AGENT_RUNTIME_OPTIONS[0]!

  const handleOpenChange = (nextOpen: boolean): void => {
    if (disabled && nextOpen) return
    setOpen(nextOpen)
  }

  const handleSelect = (nextRuntime: AgentRuntime): void => {
    onChange(nextRuntime)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`Agent 内核：${current.label}`}
              className={cn(
                'model-selector-trigger flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-muted-foreground'
              )}
            >
              <Box className="size-3.5" />
              <span>{current.label}</span>
              <ChevronDown className="size-3" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          <p className="font-medium">{current.description}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {disabled ? 'Agent 运行中，完成后可切换' : '切换当前会话下一轮使用的内核'}
          </p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[180px] p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          {AGENT_RUNTIME_OPTIONS.map((option) => {
            const active = runtime === option.value
            return (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                aria-pressed={active}
                className={cn(
                  'h-auto justify-start rounded-md px-2.5 py-2 text-left',
                  active && 'bg-accent text-accent-foreground'
                )}
                onClick={() => handleSelect(option.value)}
              >
                <div className="flex w-full items-center gap-2">
                  <Box className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{option.label}</div>
                    <div className="mt-0.5 truncate text-[11px] font-normal text-muted-foreground">
                      {option.description}
                    </div>
                  </div>
                  {active && <Check className="size-3.5 shrink-0" />}
                </div>
              </Button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface DisplayOptionsPopoverProps {
  processGroupsKeepExpanded: boolean
  onProcessGroupsKeepExpandedChange: (expanded: boolean) => void
}

function DisplayOptionsPopover({
  processGroupsKeepExpanded,
  onProcessGroupsKeepExpandedChange,
}: DisplayOptionsPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const hoverTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = React.useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    setOpen(true)
  }, [])

  const handleMouseLeave = React.useCallback(() => {
    hoverTimeout.current = setTimeout(() => setOpen(false), 150)
  }, [])

  React.useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            inputToolbarButtonClass,
            processGroupsKeepExpanded && inputToolbarActiveButtonClass
          )}
          aria-label="显示选项"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <Eye className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-auto min-w-[190px] p-2 px-2.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-foreground/70">输出完保持展开</span>
            <Switch
              checked={processGroupsKeepExpanded}
              onCheckedChange={onProcessGroupsKeepExpandedChange}
              className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const [persistedSDKMessages, setPersistedSDKMessages] = React.useState<SDKMessage[]>([])
  const persistedSDKMessagesRef = React.useRef<SDKMessage[]>([])
  persistedSDKMessagesRef.current = persistedSDKMessages
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  // 按 sessionId 切片订阅：仅本 session 的 streaming state 变化才让 AgentView 重渲染。
  // 流式期间其他 session 的高频更新（每 token 一次）通过 base map atom 传播但派生
  // atom 输出引用未变，订阅者跳过通知。
  const streamState = useAtomValue(agentSessionStreamingStateAtomFamily(sessionId))
  const streaming = streamState?.running ?? false
  // 软空闲态：本轮主体已结束、UI 可输入，但 SDK 通道仍开着等后台任务唤醒。
  // 此时服务端 activeSessions 仍保留，新消息须走注入通道而非新建 run。
  const backgroundWaiting = streamState?.backgroundWaiting ?? false
  const stoppedByUserSessions = useAtomValue(stoppedByUserSessionsAtom)
  const sendWithCmdEnter = useAtomValue(sendWithCmdEnterAtom)
  const longTextPasteAsAttachmentEnabled = useAtomValue(longTextPasteAsAttachmentEnabledAtom)
  const stoppedByUser = stoppedByUserSessions.has(sessionId)
  const liveMessagesMap = useAtomValue(liveMessagesMapAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  // 稳定化空数组引用，避免 ?? [] 每次创建新引用导致下游 useMemo 链不必要重算
  const liveMessages = liveMessagesMap.get(sessionId) ?? EMPTY_SDK_MESSAGES
  // Per-session 渠道/模型配置（优先读 session map，回退到全局默认值）
  const sessionChannelMap = useAtomValue(agentSessionChannelMapAtom)
  const sessionModelMap = useAtomValue(agentSessionModelMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const [defaultChannelId, setDefaultChannelId] = useAtom(agentChannelIdAtom)
  const [defaultModelId, setDefaultModelId] = useAtom(agentModelIdAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const sessionMeta = React.useMemo(
    () => sessions.find((s) => s.id === sessionId),
    [sessions, sessionId],
  )
  const sessionMetaChannelId = sessionMeta?.channelId
  const sessionMetaModelId = sessionMeta?.modelId
  const hasSessionMeta = Boolean(sessionMeta)
  const agentChannelId = sessionMetaChannelId ?? sessionChannelMap.get(sessionId) ?? defaultChannelId
  const agentModelId = sessionMetaModelId ?? sessionModelMap.get(sessionId) ?? defaultModelId
  const agentChannelIds = useAtomValue(agentChannelIdsAtom)
  const setAgentChannelIds = useSetAtom(agentChannelIdsAtom)
  const [agentRuntime, setAgentRuntime] = useAtom(agentRuntimeAtom)
  const [agentThinking, setAgentThinking] = useAtom(agentThinkingAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const globalWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  // 从会话元数据派生 workspaceId：会话数据已加载时以自身为准，未加载时回退全局 atom
  const currentWorkspaceId = React.useMemo(() => {
    if (!sessionMeta) return globalWorkspaceId // 数据未加载，回退全局
    return sessionMeta.workspaceId ?? null     // 数据已加载，以会话自身为准
  }, [sessionMeta, globalWorkspaceId])
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtomFamily(sessionId))
  const [queuedMessages, setQueuedMessages] = useAtom(agentMessageQueueAtomFamily(sessionId))
  const workspaces = useAtomValue(agentWorkspacesAtom)
  // 保持 channelId 稳定：初始化前使用上次有效值，避免工具栏抖动
  const stableChannelIdRef = React.useRef(agentChannelId)
  if (agentChannelId) stableChannelIdRef.current = agentChannelId
  const stableChannelId = agentChannelId ?? stableChannelIdRef.current

  // 已有会话首次打开时，从会话元数据初始化 per-session map。
  // setter 内的 `prev.has(sessionId)` 守卫保证幂等，外层不再订阅 Map atom，
  // 避免 setter 写入 → atom 引用变化 → effect 重跑的自循环（React #185）。
  const sessionAgentRuntime: AgentRuntime = hasSessionMeta
    ? sessionMeta?.agentRuntime ?? 'claude'
    : agentRuntime
  // 只有会话元数据尚未加载时，才允许使用全局默认值初始化新会话。
  React.useEffect(() => {
    if (!sessionId) return
    const initialChannelId = sessionMetaChannelId ?? (!hasSessionMeta ? defaultChannelId : undefined)
    const initialModelId = sessionMetaModelId ?? (!hasSessionMeta ? defaultModelId : undefined)
    if (initialChannelId) {
      setSessionChannelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, initialChannelId)
        return map
      })
    }
    if (initialModelId) {
      setSessionModelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, initialModelId)
        return map
      })
    }
  }, [sessionId, sessionMetaChannelId, sessionMetaModelId, hasSessionMeta, defaultChannelId, defaultModelId, setSessionChannelMap, setSessionModelMap])

  const contextStatus: AgentContextStatus = {
    isCompacting: streamState?.isCompacting ?? false,
    inputTokens: streamState?.inputTokens,
    contextWindow: streamState?.contextWindow,
    usageUpdatedAt: streamState?.usageUpdatedAt,
  }
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const streamErrors = useAtomValue(agentStreamErrorsAtom)
  const agentError = streamErrors.get(sessionId) ?? null
  const planModeSessions = useAtomValue(agentPlanModeSessionsAtom)
  const isPlanMode = planModeSessions.has(sessionId)
  const permissionModeMap = useAtomValue(agentPermissionModeMapAtom)
  const defaultPermissionMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedPermissionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const permissionMode = permissionModeMap.get(sessionId) ?? persistedPermissionMode ?? defaultPermissionMode
  const isPermissionPlanMode = permissionMode === 'plan'
  const store = useStore()
  const currentQuotedSelection = useAtomValue(currentQuotedSelectionAtom)
  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const openPreview = useOpenPreview()

  /** 移除当前引用选中文本 */
  const handleRemoveQuotedSelection = React.useCallback(() => {
    setQuotedSelectionMap((prev) => {
      const m = new Map(prev)
      m.delete(sessionId)
      return m
    })
  }, [sessionId, setQuotedSelectionMap])

  /** 消费当前引用选区，用于把引用快照固定到本次发送/队列消息中 */
  const consumeQuotedSelection = React.useCallback((): QuotedSelection | null => {
    const quotedSelection = store.get(quotedSelectionMapAtom).get(sessionId) ?? null
    if (!quotedSelection) return null

    const capturedAt = quotedSelection.capturedAt
    store.set(quotedSelectionMapAtom, (prev) => {
      const m = new Map(prev)
      const current = m.get(sessionId)
      if (current && current.capturedAt === capturedAt) m.delete(sessionId)
      return m
    })
    return quotedSelection
  }, [sessionId, store])

  const suggestionsMap = useAtomValue(agentPromptSuggestionsAtom)
  const suggestion = suggestionsMap.get(sessionId) ?? null
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const openSession = useOpenSession()
  const setAttachedDirsMap = useSetAtom(agentAttachedDirectoriesMapAtom)
  const attachedDirsMap = useAtomValue(agentAttachedDirectoriesMapAtom)
  const attachedDirs = attachedDirsMap.get(sessionId) ?? []
  const setAttachedFilesMap = useSetAtom(agentAttachedFilesMapAtom)
  const attachedFilesMap = useAtomValue(agentAttachedFilesMapAtom)
  const attachedFiles = attachedFilesMap.get(sessionId) ?? []
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []
  const setWsAttachedFilesMap = useSetAtom(workspaceAttachedFilesMapAtom)
  const wsAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const wsAttachedFiles = currentWorkspaceId ? (wsAttachedFilesMap.get(currentWorkspaceId) ?? []) : []

  // 按 sessionId 切片订阅 drafts/draftHtml：仅本 session 草稿变化才让 AgentView 重渲染。
  // 输入框每次按键都会写整 Map atom，若直接订阅整 Map，AgentView 跟着每键重渲染。
  const inputContent = useAtomValue(agentSessionDraftAtomFamily(sessionId))
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
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
  const inputHtmlContent = useAtomValue(agentSessionDraftHtmlAtomFamily(sessionId))
  const setDraftHtmlMap = useSetAtom(agentSessionDraftHtmlAtom)
  const setInputHtmlContent = React.useCallback((html: string) => {
    setDraftHtmlMap((prev) => {
      const map = new Map(prev)
      if (!html || html === '<p></p>') {
        map.delete(sessionId)
      } else {
        map.set(sessionId, html)
      }
      return map
    })
  }, [sessionId, setDraftHtmlMap])
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  const globalChannels = useAtomValue(channelsAtom)
  const stableChannel = React.useMemo(
    () => stableChannelId ? globalChannels.find((channel) => channel.id === stableChannelId) : undefined,
    [globalChannels, stableChannelId],
  )
  const planQuotaChannelId = stableChannel && supportsChannelPlanQuota(stableChannel)
    ? stableChannel.id
    : null
  const planQuotaChannelUpdatedAt = planQuotaChannelId ? stableChannel?.updatedAt : undefined
  const agentChannelProvider = React.useMemo(
    () => globalChannels.find((c) => c.id === agentChannelId)?.provider,
    [globalChannels, agentChannelId],
  )

  // 检查 Agent 渠道列表中是否存在可用的模型（渠道 enabled + 模型 enabled）
  const hasAvailableModel = React.useMemo(() => {
    // Proma 官方渠道（商业版）：只要 enabled 且有可用模型，直接视为可用
    const promaOfficial = globalChannels.find((c) => c.id === 'proma-official')
    if (promaOfficial?.enabled && promaOfficial.models.some((m) => m.enabled)) return true
    // Pi runtime 支持所有协议，任何已启用渠道都可用
    if (sessionAgentRuntime === 'pi') {
      return globalChannels.some((c) => c.enabled && c.models.some((m) => m.enabled))
    }
    // Claude runtime：需在 agentChannelIds 白名单中
    if (!agentChannelIds || agentChannelIds.length === 0) return false
    return globalChannels.some(
      (c) => c.enabled && agentChannelIds.includes(c.id) && c.models.some((m) => m.enabled),
    )
  }, [globalChannels, agentChannelIds, sessionAgentRuntime])
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    const channel = globalChannels.find((c) => c.id === agentChannelId && c.enabled)
    if (!channel) return

    const firstModel = channel.models.find((m) => m.enabled)
    if (!firstModel) return

    // 更新 per-session map（带幂等守卫，避免无意义写入导致 effect 自循环）
    setSessionModelMap((prev) => {
      if (prev.get(sessionId) === firstModel.id) return prev
      const map = new Map(prev)
      map.set(sessionId, firstModel.id)
      return map
    })
    // 全局默认值 + 持久化 IPC 也加幂等：firstModel 与当前 defaultModelId 相同时跳过，
    // 避免每次 agentChannelId / globalChannels 变化都重复写盘和触发 agentModelIdAtom 更新。
    if (defaultModelId !== firstModel.id) {
      setDefaultModelId(firstModel.id)
      window.electronAPI.updateSettings({
        agentChannelId,
        agentModelId: firstModel.id,
      }).catch(console.error)
    }
  }, [agentChannelId, agentModelId, globalChannels, sessionId, setSessionModelMap, setDefaultModelId])

  // 获取当前 session 的工作路径（文件浏览器需要）
  React.useEffect(() => {
    if (!currentWorkspaceId) {
      setSessionPathMap((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, sessionId)
      .then((path) => {
        if (path) {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, path)
            return map
          })
        } else {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.delete(sessionId)
            return map
          })
        }
      })
      .catch(() => {
        setSessionPathMap((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
  }, [sessionId, currentWorkspaceId, setSessionPathMap])

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

  // 获取工作区级附加文件（@ 引用和路径解析都需要）
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI
      .getWorkspaceAttachedFiles(workspaceSlug)
      .then((files) => {
        setWsAttachedFilesMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, files)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedFilesMap])

  // 工作区级目录（workspace shared files + 工作区级附加目录），@ 引用标记为工作区文件
  const workspaceDirs = React.useMemo(() => {
    const dirs: string[] = []
    if (workspaceFilesPath) dirs.push(workspaceFilesPath)
    for (const d of wsAttachedDirs) {
      if (!dirs.includes(d)) dirs.push(d)
    }
    return dirs
  }, [workspaceFilesPath, wsAttachedDirs])

  const attachedFileDirectories = React.useMemo(() => {
    const dirs: string[] = []
    for (const filePath of [...attachedFiles, ...wsAttachedFiles]) {
      const parent = getFileParentPath(filePath)
      if (parent && !dirs.includes(parent)) dirs.push(parent)
    }
    return dirs
  }, [attachedFiles, wsAttachedFiles])

  const workspaceMentionPaths = React.useMemo(() => {
    const paths = [...workspaceDirs]
    for (const filePath of wsAttachedFiles) {
      if (!paths.includes(filePath)) paths.push(filePath)
    }
    return paths
  }, [workspaceDirs, wsAttachedFiles])

  const sessionMentionPaths = React.useMemo(() => {
    const paths = [...attachedDirs]
    for (const filePath of attachedFiles) {
      if (!paths.includes(filePath)) paths.push(filePath)
    }
    return paths
  }, [attachedDirs, attachedFiles])

  // 合并会话级 + 工作区级附加目录，供消息区文件路径解析使用
  const allAttachedDirs = React.useMemo(() => {
    const dirs = [...attachedDirs]
    for (const d of workspaceDirs) {
      if (d && !dirs.includes(d)) dirs.push(d)
    }
    for (const filePath of [...attachedFiles, ...wsAttachedFiles]) {
      if (filePath && !dirs.includes(filePath)) dirs.push(filePath)
      const parent = getFileParentPath(filePath)
      if (parent && !dirs.includes(parent)) dirs.push(parent)
    }
    return dirs
  }, [attachedDirs, workspaceDirs, attachedFiles, wsAttachedFiles])

  const createBaseAdditionalDirectories = React.useCallback((): Set<string> => {
    const dirs = new Set(attachedDirs)
    for (const dir of attachedFileDirectories) {
      dirs.add(dir)
    }
    return dirs
  }, [attachedDirs, attachedFileDirectories])

  // 监听消息刷新版本号
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0

  // 持久化消息缓存 setter — 仅写入，读取时用 store.get 同步取值避免订阅触发重渲染
  const setMessagesCache = useSetAtom(agentSDKMessagesCacheAtom)
  const appendOptimisticPersistedMessage = React.useCallback((message: SDKMessage) => {
    // 切会话时优先命中内存缓存，因此乐观插入的用户消息也要同步写入缓存，
    // 否则“发送后立刻切走再切回”会短暂回退到旧消息数组。
    const next = [...persistedSDKMessagesRef.current, message]
    persistedSDKMessagesRef.current = next
    setPersistedSDKMessages(next)
    setMessagesCache((prev) => setSessionMessagesCache(prev, sessionId, next))
  }, [sessionId, setMessagesCache])

  const appendLiveUserMessage = React.useCallback((message: SDKMessage) => {
    store.set(liveMessagesMapAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? []
      map.set(sessionId, [...current, message])
      return map
    })
  }, [sessionId, store])

  const removeLiveUserMessage = React.useCallback((messageId: string) => {
    store.set(liveMessagesMapAtom, (prev) => {
      const map = new Map(prev)
      const current = (map.get(sessionId) ?? []).filter(
        (item) => (item as Record<string, unknown>).uuid !== messageId,
      )
      map.set(sessionId, current)
      return map
    })
  }, [sessionId, store])

  const clearStoppedByUser = React.useCallback(() => {
    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, store])

  const queueMessageIntoActiveAgent = React.useCallback(async (
    message: AgentQueuedMessage,
    rawText: string,
    sdkText: string,
    mentions: ReturnType<typeof parseQueuedMessageMentions>,
    interruptCurrentTurn: boolean,
  ): Promise<void> => {
    // 气泡显示用原文 text（保留 /skill: #mcp: &session: 语法），
    // 让 message.tsx 的 remarkMentions 立即渲染出引用芯片；
    // 剥离后的 sdkText 仅用于传给 SDK，不作为展示文本。
    appendLiveUserMessage(createUserSDKMessage(rawText, message.id, Date.now()))

    try {
      await window.electronAPI.queueAgentMessage({
        sessionId,
        userMessage: sdkText,
        rawUserMessage: rawText,
        uuid: message.id,
        interrupt: interruptCurrentTurn,
        ...(mentions.mentionedSkills.length > 0 && { mentionedSkills: mentions.mentionedSkills }),
        ...(mentions.mentionedMcpServers.length > 0 && { mentionedMcpServers: mentions.mentionedMcpServers }),
        ...(mentions.mentionedSessionIds.length > 0 && { mentionedSessionIds: mentions.mentionedSessionIds }),
      })
    } catch (error) {
      removeLiveUserMessage(message.id)
      throw error
    }
  }, [appendLiveUserMessage, removeLiveUserMessage, sessionId])

  const startQueuedMessageRun = React.useCallback(async (
    text: string,
    mentions: ReturnType<typeof parseQueuedMessageMentions>,
    channelId: string,
    queuedAdditionalDirectories: string[] = [],
  ): Promise<void> => {
    const streamStartedAt = Date.now()
    const additionalDirectoriesForRun = createBaseAdditionalDirectories()
    for (const dir of queuedAdditionalDirectories) {
      additionalDirectoriesForRun.add(dir)
    }
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const existing = prev.get(sessionId)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
        inputTokens: existing?.inputTokens,
        contextWindow: existing?.contextWindow,
      })
      return map
    })

    appendOptimisticPersistedMessage(createUserSDKMessage(text, undefined, streamStartedAt))

    try {
      await window.electronAPI.sendAgentMessage({
        sessionId,
        userMessage: text,
        channelId,
        modelId: agentModelId || undefined,
        agentRuntime: sessionAgentRuntime,
        workspaceId: currentWorkspaceId || undefined,
        startedAt: streamStartedAt,
        permissionModeOverride: permissionMode,
        ...(additionalDirectoriesForRun.size > 0 && {
          additionalDirectories: Array.from(additionalDirectoriesForRun),
        }),
        ...(mentions.mentionedSkills.length > 0 && { mentionedSkills: mentions.mentionedSkills }),
        ...(mentions.mentionedMcpServers.length > 0 && { mentionedMcpServers: mentions.mentionedMcpServers }),
        ...(mentions.mentionedSessionIds.length > 0 && { mentionedSessionIds: mentions.mentionedSessionIds }),
      })
    } catch (error) {
      setStreamingStates((prev) => {
        const current = prev.get(sessionId)
        if (!current) return prev
        const map = new Map(prev)
        map.set(sessionId, { ...current, running: false })
        return map
      })
      throw error
    }
  }, [
    agentModelId,
    appendOptimisticPersistedMessage,
    createBaseAdditionalDirectories,
    currentWorkspaceId,
    permissionMode,
    sessionAgentRuntime,
    sessionId,
    setStreamingStates,
  ])

  const sendPlainTextAgentMessage = React.useCallback(async (
    message: AgentQueuedMessage,
  ): Promise<void> => {
    const quotedSelectionBlock = message.quotedSelection
      ? buildQuotedSelectionBlock(message.quotedSelection)
      : ''
    const payload = buildQueuedMessageSendPayload(message, quotedSelectionBlock)
    if (!payload.rawText || !agentChannelId || !hasAvailableModel) return

    clearStoppedByUser()

    // 发起新一轮（含队列消息自动发送、后台续轮注入等非用户显式路径）时，
    // 清除上一轮遗留的流式错误，避免正常输出后底部仍残留旧报错。
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // interrupt 由本函数读到的实时 streaming 决定，而非调用方传入的快照：
    // - streaming（本轮真正进行中）：注入前需软中断当前 turn
    // - backgroundWaiting（软空闲，无活跃 turn）：直接注入，无需中断
    // 避免"外层判定 streaming、内层已结束"两个快照不一致导致的竞态。
    if (streaming || backgroundWaiting) {
      try {
        await queueMessageIntoActiveAgent(message, payload.rawText, payload.sdkText, payload.mentions, streaming)
      } catch (error) {
        if (isStaleAgentQueueError(error)) {
          console.warn('[AgentView] 检测到陈旧的 Agent 追加通道，改为启动新一轮运行:', error)
          await startQueuedMessageRun(payload.rawText, payload.mentions, agentChannelId, message.additionalDirectories)
          return
        }
        throw error
      }
      return
    }

    await startQueuedMessageRun(payload.rawText, payload.mentions, agentChannelId, message.additionalDirectories)
  }, [
    agentChannelId,
    backgroundWaiting,
    clearStoppedByUser,
    hasAvailableModel,
    queueMessageIntoActiveAgent,
    sessionId,
    setAgentStreamErrors,
    startQueuedMessageRun,
    streaming,
  ])

  // 消息是否已完成首次加载（用于 auto-send 等待）
  const [messagesLoaded, setMessagesLoaded] = React.useState(false)
  const [messagesRefreshing, setMessagesRefreshing] = React.useState(false)
  const messagesRefreshingRef = React.useRef(false)
  const loadingSessionIdRef = React.useRef<string | null>(null)

  // 加载当前会话消息
  React.useEffect(() => {
    // 只有切换会话时才进入 loading 态；同一会话在流式完成后的刷新要保留当前
    // persisted/live 消息，避免“助手气泡先消失、持久化消息再恢复”的空窗跳动。
    const isSessionSwitch = loadingSessionIdRef.current !== sessionId
    if (isSessionSwitch) {
      loadingSessionIdRef.current = sessionId
      // 命中缓存则立即填充，消除「先清空 → 等 IPC 全量读盘」的可见空窗；
      // IPC 返回后仍会以最新数据覆盖。未命中才回退到清空 + loading 态。
      // 注意：refreshVersion bump（流结束/出错/rewind）不是会话切换，
      // 走 else 分支保留当前消息，并在下方 IPC 覆盖时获得最新数据。
      const cached = store.get(agentSDKMessagesCacheAtom).get(sessionId)
      if (cached) {
        setPersistedSDKMessages(cached)
        setMessagesLoaded(true)
      } else {
        setPersistedSDKMessages([])
        setMessagesLoaded(false)
      }
    }
    messagesRefreshingRef.current = true
    setMessagesRefreshing(true)
    let cancelled = false
    window.electronAPI.getAgentSessionSDKMessages(sessionId)
      .then((sdkMsgs) => {
        if (cancelled) return
        // 写入缓存（含 LRU 淘汰，防止会话数增长导致内存无限膨胀）
        setMessagesCache((prev) => setSessionMessagesCache(prev, sessionId, sdkMsgs))
        unstable_batchedUpdates(() => {
          persistedSDKMessagesRef.current = sdkMsgs
          setPersistedSDKMessages(sdkMsgs)
          setMessagesLoaded(true)
          messagesRefreshingRef.current = false
          setMessagesRefreshing(false)

          // 消息加载完成后，同步清除流式展示状态和实时消息，
          // 确保 React 在一次渲染中同时显示持久化消息并移除流式气泡/实时消息，
          // 避免「实时消息已清 → 持久化消息未到」的空档闪烁
          // 注意：保留 inputTokens/contextWindow 以维持上下文用量圆环显示
          setStreamingStates((prev) => {
            const state = prev.get(sessionId)
            // 仍在运行中：不清除
            if (!state || state.running) return prev
            const map = new Map(prev)
            // 软空闲态（后台任务等待）：必须保留 backgroundWaiting 标志（否则 handleSend 误走新建 run），
            // 但展示字段 content/toolActivities 仍要清空——否则上一轮流式文本残留会被兜底气泡渲染成重复消息。
            if (state.inputTokens !== undefined) {
              // 保留 usage 数据，仅清除流式展示字段
              map.set(sessionId, {
                running: false,
                backgroundWaiting: state.backgroundWaiting,
                content: '',
                toolActivities: [],
                inputTokens: state.inputTokens,
                outputTokens: state.outputTokens,
                cacheReadTokens: state.cacheReadTokens,
                cacheCreationTokens: state.cacheCreationTokens,
                contextWindow: state.contextWindow,
                model: state.model,
              })
            } else if (state.backgroundWaiting) {
              // 无 usage 数据但处于软空闲：保留标志，清空展示字段
              map.set(sessionId, {
                running: false,
                backgroundWaiting: true,
                content: '',
                toolActivities: [],
              })
            } else {
              map.delete(sessionId)
            }
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
      })
      .catch((error) => {
        if (cancelled) return
        console.error(error)
        setMessagesLoaded(true)
        messagesRefreshingRef.current = false
        setMessagesRefreshing(false)
      })
    return () => { cancelled = true }
  }, [sessionId, refreshVersion, setStreamingStates, setLiveMessagesMap, setMessagesCache, store])

  // 从会话元数据初始化附加目录（仅冷启动水合，后续由 handleAttachFolder/handleDetachDirectory 实时写入）
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const dirs = meta?.attachedDirectories ?? []
    setAttachedDirsMap((prev) => {
      const existing = prev.get(sessionId)
      if (existing != null) return prev
      const map = new Map(prev)
      if (dirs.length > 0) {
        map.set(sessionId, dirs)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedDirsMap])

  // 从会话元数据初始化附加文件（仅冷启动水合，后续由 attachFile/detachFile 实时写入）
  React.useEffect(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    const files = meta?.attachedFiles ?? []
    setAttachedFilesMap((prev) => {
      const existing = prev.get(sessionId)
      if (existing != null) return prev
      const map = new Map(prev)
      if (files.length > 0) {
        map.set(sessionId, files)
      }
      return map
    })
  }, [sessionId, sessions, setAttachedFilesMap])

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
      additionalDirectories: Array.from(new Set([...attachedDirs, ...attachedFileDirectories, ...(pendingPrompt.additionalDirectories ?? [])])),
    }
    setPendingPrompt(null)

    queueMicrotask(() => {
      // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传，确保竞态保护使用同一个值）
      const streamStartedAt = Date.now()
      setStreamingStates((prev) => {
        const map = new Map(prev)
        const existing = prev.get(sessionId)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          model: snapshot.modelId,
          startedAt: streamStartedAt,
          inputTokens: existing?.inputTokens,
          contextWindow: resolveRunContextWindow(snapshot.modelId, agentChannelProvider, existing?.contextWindow),
        })
        return map
      })

      // 乐观更新：SDKMessage 格式（Phase 4）
      const tempUserSDKMsg: SDKMessage = {
        type: 'user',
        message: {
          content: [{ type: 'text', text: snapshot.message }],
        },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage
      appendOptimisticPersistedMessage(tempUserSDKMsg)

      // 发送消息
      const input: AgentSendInput = {
        sessionId,
        userMessage: snapshot.message,
        channelId: snapshot.channelId,
        modelId: snapshot.modelId,
        agentRuntime: sessionAgentRuntime,
        workspaceId: snapshot.workspaceId,
        startedAt: streamStartedAt,
        permissionModeOverride: permissionMode,
        ...(snapshot.additionalDirectories && snapshot.additionalDirectories.length > 0 && {
          additionalDirectories: snapshot.additionalDirectories,
        }),
      }
      window.electronAPI.sendAgentMessage(input).catch((error) => {
        console.error('[AgentView] 自动发送配置消息失败:', error)
        setStreamingStates((prev) => {
          const current = prev.get(sessionId)
          if (!current) return prev
          const map = new Map(prev)
          map.set(sessionId, { ...current, running: false })
          return map
        })
      })
    })
  }, [messagesLoaded, pendingPrompt, sessionId, agentChannelId, agentModelId, sessionAgentRuntime, agentChannelProvider, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates, permissionMode, attachedDirs, attachedFileDirectories])
  // ===== 附件处理 =====

  /** 为文件生成唯一文件名（避免粘贴多张图片时文件名重复导致覆盖） */
  const makeUniqueFilename = React.useCallback((originalName: string, existingNames: string[]): string => {
    return makeUniqueAttachmentName(originalName, existingNames)
  }, [])

  const attachSessionFile = React.useCallback(async (filePath: string): Promise<void> => {
    const updated = await window.electronAPI.attachFile({ sessionId, filePath })
    setAttachedFilesMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, updated)
      return map
    })
  }, [sessionId, setAttachedFilesMap])

  const preparePendingFilesForSend = React.useCallback(async (
    files: AgentPendingFile[],
    additionalDirectoriesForRun: Set<string>,
  ): Promise<PreparedAgentAttachment | null> => {
    if (files.length === 0) {
      return { referenceBlock: '', attachments: [], additionalDirectories: [] }
    }

    const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!workspace) {
      toast.warning('暂时无法发送附件', {
        description: '当前 Agent 会话没有绑定有效工作区。请在顶部选择工作区，或新建 Agent 会话后重新上传。',
      })
      return null
    }

    // 区分三类：
    // - 剪贴板临时草稿（isClipboardDraft）：sourcePath 指向 os.tmpdir，可能被系统清理，
    //   需读取最新内容（含预览面板 autosave 的编辑）拷贝进 session 目录持久化
    // - 侧面板真实文件（仅 sourcePath）：原地引用，不复制
    // - 新上传文件（无 sourcePath）：从内存数据保存到 session 目录
    const existingFiles = files.filter((f) => f.sourcePath && !f.isClipboardDraft)
    const clipboardDrafts = files.filter((f) => f.sourcePath && f.isClipboardDraft)
    const newFiles = files.filter((f) => !f.sourcePath)

    const allRefs: Array<{ filename: string; targetPath: string; sourceFile: AgentPendingFile }> = []
    const queuedAdditionalDirectories = new Set<string>()

    // 已有路径的文件直接引用
    for (const f of existingFiles) {
      const sourcePath = f.sourcePath!
      allRefs.push({ filename: f.filename, targetPath: sourcePath, sourceFile: f })
      const parentPath = getFileParentPath(sourcePath)
      if (parentPath) {
        additionalDirectoriesForRun.add(parentPath)
        queuedAdditionalDirectories.add(parentPath)
      }
    }

    // 剪贴板草稿：读取临时文件最新内容，转为待保存数据
    const draftFilesToSave: Array<{ sourceFile: AgentPendingFile; filename: string; data: string }> = []
    const staleDraftFiles: string[] = []
    for (const f of clipboardDrafts) {
      const sourcePath = f.sourcePath!
      const parentPath = getFileParentPath(sourcePath)
      try {
        const read = await window.electronAPI.resolveAndReadFile(sourcePath, {
          sessionId,
          candidateBasePaths: parentPath ? [parentPath] : undefined,
        })
        if (!read) {
          staleDraftFiles.push(f.filename)
          continue
        }
        const data = await fileToBase64(new File([read.content], f.filename, { type: f.mediaType }))
        draftFilesToSave.push({ sourceFile: f, filename: f.filename, data })
      } catch (error) {
        console.error('[AgentView] 读取剪贴板草稿失败:', error)
        staleDraftFiles.push(f.filename)
      }
    }
    if (staleDraftFiles.length > 0) {
      toast.error('附件数据已失效', {
        description: `请移除后重新粘贴：${staleDraftFiles.join('、')}`,
      })
      return null
    }

    // 新上传的文件 + 剪贴板草稿一并保存到 session 目录
    const inMemoryFilesToSave = newFiles.map((f) => ({
      sourceFile: f,
      filename: f.filename,
      data: window.__pendingAgentFileData?.get(f.id) || '',
    }))
    const missingDataFiles = inMemoryFilesToSave.filter((f) => !f.data).map((f) => f.filename)
    if (missingDataFiles.length > 0) {
      toast.error('附件数据已失效', {
        description: `请移除后重新添加文件：${missingDataFiles.join('、')}`,
      })
      return null
    }

    const filesToSave = [...inMemoryFilesToSave, ...draftFilesToSave]
    if (filesToSave.length > 0) {
      try {
        const saved = await window.electronAPI.saveFilesToAgentSession({
          workspaceSlug: workspace.slug,
          sessionId,
          files: filesToSave.map(({ filename, data }) => ({ filename, data })),
        })
        saved.forEach((savedFile, index) => {
          const sourceFile = filesToSave[index]?.sourceFile
          if (!sourceFile) return
          allRefs.push({ ...savedFile, sourceFile })
        })
      } catch (error) {
        console.error('[AgentView] 保存附件到 session 失败:', error)
        toast.error('附件保存失败', {
          description: '请确认当前工作区可用，或新建 Agent 会话后重新上传。',
        })
        return null
      }
    }

    if (allRefs.length === 0) {
      toast.error('附件没有成功加入消息', {
        description: '请重新上传文件，或切换到有效工作区后再试。',
      })
      return null
    }

    const refs = allRefs.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')

    for (const f of files) {
      if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl)
      window.__pendingAgentFileData?.delete(f.id)
    }
    setPendingFiles([])

    return {
      referenceBlock: `<attached_files>\n${refs}\n</attached_files>\n\n`,
      attachments: allRefs.map((ref) => ({
        filename: ref.filename,
        mediaType: ref.sourceFile.mediaType,
        size: ref.sourceFile.size,
        targetPath: ref.targetPath,
      })),
      additionalDirectories: Array.from(queuedAdditionalDirectories),
    }
  }, [currentWorkspaceId, sessionId, setPendingFiles, workspaces])

  const restoreQueuedAttachmentsToPending = React.useCallback((attachments?: AgentQueuedAttachment[]): void => {
    if (!attachments || attachments.length === 0) return
    setPendingFiles((prev) => [
      ...prev,
      ...attachments.map((attachment) => ({
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        size: attachment.size,
        sourcePath: attachment.targetPath,
      })),
    ])
  }, [setPendingFiles])

  /** 将 File 对象列表添加为待发送附件 */
  const addFilesAsAttachments = React.useCallback(async (files: File[], sourcePaths?: Map<File, string>): Promise<void> => {
    // 收集已有的 pending 文件名，用于去重
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)

    const pathBackedFiles: string[] = []
    const rejectedLargeFiles: string[] = []

    for (const file of files) {
      try {
        if (file.size > MAX_ATTACHMENT_SIZE) {
          const sourcePath = sourcePaths?.get(file)
          if (!sourcePath) {
            rejectedLargeFiles.push(file.name)
            continue
          }
          await attachSessionFile(sourcePath)

          const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          const uniqueFilename = makeUniqueFilename(file.name, usedNames)
          usedNames.push(uniqueFilename)

          const pending: AgentPendingFile = {
            id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filename: uniqueFilename,
            mediaType: file.type || 'application/octet-stream',
            size: file.size,
            previewUrl,
            sourcePath,
          }

          setPendingFiles((prev) => [...prev, pending])
          pathBackedFiles.push(uniqueFilename)
          continue
        }

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

    if (pathBackedFiles.length > 0) {
      toast.success(`已将大文件作为附加文件引用：${formatFileNames(pathBackedFiles)}`)
    }
    if (rejectedLargeFiles.length > 0) {
      toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(rejectedLargeFiles)}`)
    }
  }, [attachSessionFile, makeUniqueFilename, setPendingFiles])

  const addLargeDialogFilesAsReferences = React.useCallback(async (files: FileDialogLargeFile[]): Promise<void> => {
    if (files.length === 0) return
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)
    const added: string[] = []
    const rejected: string[] = []

    for (const file of files) {
      try {
        await attachSessionFile(file.path)
        const uniqueFilename = makeUniqueFilename(file.filename, usedNames)
        usedNames.push(uniqueFilename)

        const pending: AgentPendingFile = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
          mediaType: file.mediaType,
          size: file.size,
          sourcePath: file.path,
        }

        setPendingFiles((prev) => [...prev, pending])
        added.push(uniqueFilename)
      } catch (error) {
        console.error('[AgentView] 附加大文件失败:', error)
        rejected.push(file.filename)
      }
    }

    if (added.length > 0) {
      toast.success(`已将大文件作为附加文件引用：${formatFileNames(added)}`)
    }
    if (rejected.length > 0) {
      toast.error(`以下文件附加失败，已跳过：${formatFileNames(rejected)}`)
    }
  }, [attachSessionFile, makeUniqueFilename, setPendingFiles])

  /** 打开文件选择对话框 */
  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      const largeFiles = result.largeFiles ?? []
      const skippedFiles = result.skippedFiles ?? []
      if (result.files.length === 0 && largeFiles.length === 0 && skippedFiles.length === 0) return

      const oversized: string[] = []

      for (const fileInfo of result.files) {
        if (fileInfo.size > MAX_ATTACHMENT_SIZE) {
          oversized.push(fileInfo.filename)
          continue
        }
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

      if (oversized.length > 0) {
        toast.error(`以下文件超过 100MB 且无法取得本地路径，已跳过：${formatFileNames(oversized)}`)
      }
      await addLargeDialogFilesAsReferences(largeFiles)
      if (skippedFiles.length > 0) {
        toast.warning(`以下文件无法读取，已跳过：${formatFileNames(skippedFiles.map((f) => f.filename))}`)
      }
    } catch (error) {
      console.error('[AgentView] 文件选择对话框失败:', error)
    }
  }, [addLargeDialogFilesAsReferences, setPendingFiles])

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

  /** 图片附件编辑完成：用编辑后的图替换该附件（统一转为内存图片走 __pendingAgentFileData） */
  const handleAttachmentEditComplete = React.useCallback((fileId: string, editedDataUrl: string): void => {
    const base64 = editedDataUrl.split(',')[1]
    if (!base64) return
    if (!window.__pendingAgentFileData) {
      window.__pendingAgentFileData = new Map<string, string>()
    }
    window.__pendingAgentFileData.set(fileId, base64)
    setPendingFiles((prev) => prev.map((f) => {
      if (f.id !== fileId) return f
      if (f.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(f.previewUrl)
      }
      return {
        ...f,
        previewUrl: editedDataUrl,
        filename: f.filename.replace(/(\.[^.]+)?$/, '') + '_edited.png',
        mediaType: 'image/png',
        size: Math.round(base64.length * 0.75),
        // 编辑后统一当作内存图片：清除文件引用，发送时从 __pendingAgentFileData 读取最新数据
        sourcePath: undefined,
        isClipboardDraft: undefined,
      }
    }))
  }, [setPendingFiles])

  const openClipboardPreviewFile = React.useCallback((filePath: string): void => {
    const parentPath = getFileParentPath(filePath)
    openPreview(sessionId, {
      filePath,
      previewOnly: true,
      readOnly: false,
      basePaths: parentPath ? [parentPath] : undefined,
    })
  }, [sessionId, openPreview])

  /** 点击 clipboard 附件时，在当前会话的临时预览标签页中显示内容 */
  const handleClipboardPreview = React.useCallback(async (file: AgentPendingFile) => {
    if (file.sourcePath) {
      openClipboardPreviewFile(file.sourcePath)
      return
    }

    const base64 = window.__pendingAgentFileData?.get(file.id)
    if (!base64) return

    try {
      // atob 解码得到二进制字符串，需用 TextDecoder 正确还原 UTF-8 文本
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const text = new TextDecoder('utf-8').decode(bytes)
      const tmpPath = await window.electronAPI.writeClipboardPreview(file.filename, text)
      setPendingFiles((prev) => prev.map((item) => (
        item.id === file.id ? { ...item, sourcePath: tmpPath, isClipboardDraft: true } : item
      )))
      window.__pendingAgentFileData?.delete(file.id)
      openClipboardPreviewFile(tmpPath)
    } catch (error) {
      console.error('[AgentView] clipboard 预览写入失败:', error)
    }
  }, [openClipboardPreviewFile, setPendingFiles])

  const addClipboardTextDraft = React.useCallback(async (text: string): Promise<AgentPendingFile> => {
    const draft = createClipboardTextDraft(text, pendingFilesRef.current.map((f) => f.filename))
    const tmpPath = await window.electronAPI.writeClipboardPreview(draft.filename, text)
    const pending = createClipboardPendingFile(
      draft,
      tmpPath,
      `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    setPendingFiles((prev) => {
      const next = [...prev, pending]
      pendingFilesRef.current = next
      return next
    })
    return pending
  }, [setPendingFiles])

  /** 粘贴文件处理 */
  const handlePasteFiles = React.useCallback((files: File[]): void => {
    addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  /** 粘贴超长文本时转为待发送附件，避免把大段内容直接塞进输入框 */
  const handlePasteLongText = React.useCallback((text: string): void => {
    addClipboardTextDraft(text)
      .then((file) => {
        toast.success('已将超长文本转为附件', {
          description: `${file.filename}，点击附件可预览编辑。`,
        })
      })
      .catch((error) => {
        console.error('[AgentView] 超长文本转附件失败:', error)
        toast.error('超长文本转附件失败')
      })
  }, [addClipboardTextDraft])

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

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // 通过 preload 的 webUtils.getPathForFile 获取真实路径
    const pathMap = new Map<string, File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try {
        const p = window.electronAPI.getPathForFile(f)
        if (p) {
          paths.push(p)
          pathMap.set(p, f)
        }
      } catch { /* 无法获取路径时忽略 */ }
    }

    if (paths.length > 0) {
      try {
        // 通过主进程检测目录 vs 文件
        const { directories, files: filePaths } = await window.electronAPI.checkPathsType(paths)

        // 拖拽的文件夹直接附加
        for (const dirPath of directories) {
          try {
            const updated = await window.electronAPI.attachDirectory({
              sessionId,
              directoryPath: dirPath,
            })
            setAttachedDirsMap((prev) => {
              const map = new Map(prev)
              map.set(sessionId, updated)
              return map
            })
            const dirName = dirPath.split('/').pop() || dirPath
            toast.success(`已附加目录: ${dirName}`)
          } catch (error) {
            console.error('[AgentView] 拖拽附加文件夹失败:', error)
          }
        }

        // 普通文件作为附件
        const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
        if (regularFiles.length > 0) {
          const fileSourcePaths = new Map<File, string>()
          for (const path of filePaths) {
            const file = pathMap.get(path)
            if (file) fileSourcePaths.set(file, path)
          }
          addFilesAsAttachments(regularFiles, fileSourcePaths)
        }
      } catch (error) {
        console.error('[AgentView] 路径检测失败，回退处理:', error)
        addFilesAsAttachments(droppedFiles)
      }
    } else {
      // 无路径信息：回退，所有项按普通文件处理
      addFilesAsAttachments(droppedFiles)
    }
  }, [sessionId, addFilesAsAttachments, setAttachedDirsMap])

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
    setAgentSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, channelId: option.channelId, modelId: option.modelId }
        : session
    )))

    // 模型切换时：清除旧的 contextWindow，让 result 重新提供真实值
    setStreamingStates((prev) => {
      const state = prev.get(sessionId)
      if (!state) return prev
      const map = new Map(prev)
      map.set(sessionId, { ...state, contextWindow: undefined })
      return map
    })

    const updatedChannelIds = nextAgentChannelIdsAfterModelSelect(
      agentChannelIds,
      option.channelId,
      sessionAgentRuntime,
    )
    if (updatedChannelIds !== agentChannelIds) {
      setAgentChannelIds(updatedChannelIds)
    }

    // 同时更新全局默认值（新会话继承）
    setDefaultChannelId(option.channelId)
    setDefaultModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
      agentChannelIds: updatedChannelIds,
    }).catch(console.error)

    window.electronAPI.updateAgentSessionModel(sessionId, option.channelId, option.modelId)
      .then((updated) => {
        setAgentSessions((prev) => prev.map((session) => (
          session.id === updated.id ? updated : session
        )))
      })
      .catch(console.error)
  }, [sessionId, setSessionChannelMap, setSessionModelMap, setDefaultChannelId, setDefaultModelId, agentChannelIds, sessionAgentRuntime, setAgentChannelIds, setAgentSessions])

  const handleAgentRuntimeChange = React.useCallback(async (runtime: AgentRuntime): Promise<void> => {
    if (runtime === sessionAgentRuntime) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-mode="agent"] .ProseMirror')?.focus())
      return
    }
    if (streaming || backgroundWaiting) {
      toast.info('Agent 运行中，完成后再切换内核')
      return
    }

    const previousDefaultRuntime = agentRuntime
    const previousSessionMeta = sessionMeta
    setAgentRuntime(runtime)
    if (sessionMeta) {
      setAgentSessions((prev) => prev.map((item) =>
        item.id === sessionId
          ? { ...item, agentRuntime: runtime, sdkSessionId: undefined, updatedAt: Date.now() }
          : item
      ))
    }

    try {
      const updated = await window.electronAPI.updateSessionAgentRuntime(sessionId, runtime)
      setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? updated : item))
      window.electronAPI.updateSettings({ agentRuntime: runtime }).catch((error) => {
        console.error('[AgentView] 保存 Agent Runtime 默认值失败:', error)
      })
    } catch (error) {
      console.error('[AgentView] 切换 Agent Runtime 失败:', error)
      setAgentRuntime(previousDefaultRuntime)
      if (previousSessionMeta) {
        setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? previousSessionMeta : item))
      }
      toast.error('Agent Runtime 切换失败', { description: getErrorMessage(error) })
    } finally {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-mode="agent"] .ProseMirror')?.focus())
    }
  }, [
    agentRuntime,
    backgroundWaiting,
    sessionAgentRuntime,
    sessionId,
    sessionMeta,
    setAgentRuntime,
    setAgentSessions,
    streaming,
  ])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const computedSelectedModel = React.useMemo(() => {
    if (!agentChannelId || !agentModelId) return null
    return { channelId: agentChannelId, modelId: agentModelId }
  }, [agentChannelId, agentModelId])

  // 防止瞬态 null 传递给 ModelSelector（防御 overflow remount 时 stableModelInfoRef 丢失）
  const stableSelectedModelRef = React.useRef(computedSelectedModel)
  if (computedSelectedModel) stableSelectedModelRef.current = computedSelectedModel
  const externalSelectedModel = computedSelectedModel ?? stableSelectedModelRef.current

  /** 发送消息 */
  const handleSend = React.useCallback(async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? inputContent).trim()
    // 如果输入为空但有建议，使用建议内容
    const effectiveText = text || suggestion || ''
    const pendingFilesSnapshot = pendingFilesRef.current
    if (!messagesLoaded || (!effectiveText && pendingFilesSnapshot.length === 0) || !agentChannelId || !hasAvailableModel) return
    if (!streaming && messagesRefreshingRef.current) {
      toast.info('上一轮消息正在同步', {
        description: '请稍等片刻再发送；队列会在同步完成后继续。',
      })
      return
    }
    const additionalDirectoriesForRun = createBaseAdditionalDirectories()

    if (streaming) {
      // Agent 正在输出时，用户消息默认进入 Proma 托管队列，不打断当前 turn。
      const attachmentContext = pendingFilesSnapshot.length > 0
        ? await preparePendingFilesForSend(pendingFilesSnapshot, additionalDirectoriesForRun)
        : null
      if (pendingFilesSnapshot.length > 0 && !attachmentContext) return

      const quotedSelection = consumeQuotedSelection()
      setQueuedMessages((prev) => [
        ...prev,
        createAgentQueuedMessage(effectiveText, crypto.randomUUID(), Date.now(), quotedSelection, attachmentContext
          ? {
              fileReferenceBlock: attachmentContext.referenceBlock,
              attachments: attachmentContext.attachments,
              additionalDirectories: attachmentContext.additionalDirectories,
            }
          : undefined),
      ])
      if (overrideText === undefined) {
        setInputContent('')
        setInputHtmlContent('')
      }
      setPromptSuggestions((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })

      return
    }

    if (backgroundWaiting) {
      // 软空闲态没有活跃输出，直接注入，无需中断。
      const attachmentContext = pendingFilesSnapshot.length > 0
        ? await preparePendingFilesForSend(pendingFilesSnapshot, additionalDirectoriesForRun)
        : null
      if (pendingFilesSnapshot.length > 0 && !attachmentContext) return

      const quotedSelection = consumeQuotedSelection()
      const message = createAgentQueuedMessage(effectiveText, crypto.randomUUID(), Date.now(), quotedSelection, attachmentContext
        ? {
            fileReferenceBlock: attachmentContext.referenceBlock,
            attachments: attachmentContext.attachments,
            additionalDirectories: attachmentContext.additionalDirectories,
          }
        : undefined)
      if (overrideText === undefined) {
        setInputContent('')
        setInputHtmlContent('')
      }
      setPromptSuggestions((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      sendPlainTextAgentMessage(message).catch((error) => {
        console.error('[AgentView] 追加消息失败:', error)
        toast.error('追加消息失败', { description: String(error) })
        // 回滚：恢复输入框内容和建议，避免用户输入丢失
        setInputContent(effectiveText)
        setInputHtmlContent('')
        setPromptSuggestions((prev) => {
          const map = new Map(prev)
          if (suggestion) {
            map.set(sessionId, suggestion)
          } else {
            map.delete(sessionId)
          }
          return map
        })
        const failedQuotedSelection = message.quotedSelection
        if (failedQuotedSelection) {
          setQuotedSelectionMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, failedQuotedSelection)
            return map
          })
        }
        restoreQueuedAttachmentsToPending(message.attachments)
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
    const attachmentContext = pendingFilesSnapshot.length > 0
      ? await preparePendingFilesForSend(pendingFilesSnapshot, additionalDirectoriesForRun)
      : null
    if (pendingFilesSnapshot.length > 0 && !attachmentContext) return
    let fileReferences = attachmentContext?.referenceBlock ?? ''

    // 构建引用选中文本：内联 XML 拼入 prompt，对话框不展示（parseAttachedFiles 剥离）
    const quotedSelection = consumeQuotedSelection()
    if (quotedSelection) {
      fileReferences = fileReferences + buildQuotedSelectionBlock(quotedSelection)
    }

    // 2. 构建最终消息
    const finalMessage = fileReferences + effectiveText
    const mentions = parseQueuedMessageMentions(effectiveText)

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

    // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传，确保竞态保护使用同一个值）
    const streamStartedAt = Date.now()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const existing = prev.get(sessionId)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
        inputTokens: existing?.inputTokens,
        contextWindow: resolveRunContextWindow(agentModelId || undefined, agentChannelProvider, existing?.contextWindow),
      })
      return map
    })

    // 乐观更新：SDKMessage 格式的用户消息（Phase 4）
    const tempUserSDKMsg: SDKMessage = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: finalMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: Date.now(),
    } as unknown as SDKMessage
    appendOptimisticPersistedMessage(tempUserSDKMsg)

    const input: AgentSendInput = {
      sessionId,
      userMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      agentRuntime: sessionAgentRuntime,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      permissionModeOverride: permissionMode,
      ...(additionalDirectoriesForRun.size > 0 && { additionalDirectories: Array.from(additionalDirectoriesForRun) }),
      ...(mentions.mentionedSkills.length > 0 && { mentionedSkills: mentions.mentionedSkills }),
      ...(mentions.mentionedMcpServers.length > 0 && { mentionedMcpServers: mentions.mentionedMcpServers }),
      ...(mentions.mentionedSessionIds.length > 0 && { mentionedSessionIds: mentions.mentionedSessionIds }),
    }

    // 清空输入框（仅当发送的是用户自己输入的内容，而非推荐建议时）
    // 用 === undefined 与上方 `overrideText ?? inputContent` 的取值语义保持一致，
    // 避免未来出现 handleSend('') 时两条路径行为割裂
    if (overrideText === undefined) {
      setInputContent('')
      setInputHtmlContent('')
    }

    window.electronAPI.sendAgentMessage(input).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      setStreamingStates((prev) => {
        const current = prev.get(sessionId)
        if (!current) return prev
        const map = new Map(prev)
        map.set(sessionId, { ...current, running: false })
        return map
      })
    })
  }, [inputContent, createBaseAdditionalDirectories, preparePendingFilesForSend, restoreQueuedAttachmentsToPending, sessionId, agentChannelId, agentModelId, sessionAgentRuntime, agentChannelProvider, currentWorkspaceId, streaming, backgroundWaiting, suggestion, hasAvailableModel, store, consumeQuotedSelection, setStreamingStates, setAgentStreamErrors, setPromptSuggestions, setInputContent, setLiveMessagesMap, permissionMode, messagesLoaded, setQueuedMessages, setQuotedSelectionMap, sendPlainTextAgentMessage])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      const next = new Set(prev)
      next.add(sessionId)
      return next
    })

    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities),
      })
      return map
    })

    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }, [sessionId, setStreamingStates, store])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback((): void => {
    if (!agentChannelId || streaming) return

    const streamStartedAt = Date.now()
    const localUuid = crypto.randomUUID()

    // 1. 立即注入合成用户消息（/compact 气泡立刻可见，与普通发送路径一致）
    const syntheticMsg: import('@proma/shared').SDKMessage = {
      type: 'user',
      uuid: localUuid,
      message: {
        content: [{ type: 'text', text: '/compact' }],
      },
      parent_tool_use_id: null,
      _createdAt: streamStartedAt,
    } as unknown as import('@proma/shared').SDKMessage

    store.set(liveMessagesMapAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(sessionId) ?? []
      map.set(sessionId, [...current, syntheticMsg])
      return map
    })

    // 2. 初始化流式状态 + 乐观设 isCompacting=true（SDK compacting 事件之前就显示"正在压缩..."分隔符）
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(sessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      }
      map.set(sessionId, { ...current, running: true, startedAt: streamStartedAt, isCompacting: true, compactInFlight: true })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      agentRuntime: sessionAgentRuntime,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      permissionModeOverride: permissionMode,
    }).catch((error) => {
      console.error('[AgentView] /compact 发送失败:', error)
      // 回滚：移除合成用户消息 + 清除 isCompacting flag
      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = (map.get(sessionId) ?? []).filter(
          (m) => (m as unknown as { uuid?: string }).uuid !== localUuid,
        )
        map.set(sessionId, current)
        return map
      })
      setStreamingStates((prev) => {
        const map = new Map(prev)
        const current = prev.get(sessionId)
        if (!current) return prev
        map.set(sessionId, { ...current, isCompacting: false, compactInFlight: false })
        return map
      })
    })
  }, [sessionId, agentChannelId, agentModelId, sessionAgentRuntime, currentWorkspaceId, streaming, setStreamingStates, store, permissionMode])

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
    const lastUserMessage = [...persistedSDKMessages]
      .reverse()
      .map(getUserTextFromSDKMessage)
      .find((text): text is string => text !== null)
    if (!lastUserMessage) return

    // 清除错误状态
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传）
    const streamStartedAt = Date.now()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const existing = prev.get(sessionId)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
        inputTokens: existing?.inputTokens,
        contextWindow: resolveRunContextWindow(agentModelId || undefined, agentChannelProvider, existing?.contextWindow),
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: lastUserMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      agentRuntime: sessionAgentRuntime,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      permissionModeOverride: permissionMode,
    }).catch(console.error)
  }, [persistedSDKMessages, sessionId, agentChannelId, agentModelId, sessionAgentRuntime, agentChannelProvider, currentWorkspaceId, streaming, setAgentStreamErrors, setStreamingStates, permissionMode])

  /** 在新对话继续：创建新会话 + 切换 tab + 使用 &session 引用旧会话 */
  const handleRetryInNewSession = React.useCallback(async (): Promise<void> => {
    if (!agentChannelId) return

    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined, agentChannelId, currentWorkspaceId || undefined, agentModelId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])

      // 切换到新会话 tab
      openSession('agent', meta.id, meta.title)

      // 发送引用旧会话的默认提示词，并通过 mentionedSessionIds 触发结构化会话引用注入
      const prompt = `请读取 &session:${sessionId} 的历史，然后从上个会话停止的位置继续。`
      const streamStartedAt = Date.now()

      // 初始化新会话流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(meta.id, {
          running: true,
          content: '',
          toolActivities: [],
          model: agentModelId || undefined,
          startedAt: streamStartedAt,
        })
        return map
      })

      window.electronAPI.sendAgentMessage({
        sessionId: meta.id,
        userMessage: prompt,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        agentRuntime: sessionAgentRuntime,
        workspaceId: currentWorkspaceId || undefined,
        mentionedSessionIds: [sessionId],
        startedAt: streamStartedAt,
        permissionModeOverride: permissionMode,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, agentChannelId, agentModelId, sessionAgentRuntime, currentWorkspaceId, openSession, setAgentSessions, setStreamingStates, permissionMode])

  /** 分叉会话：从指定消息处创建新会话并自动切换 */
  const handleFork = React.useCallback(async (upToMessageUuid: string): Promise<void> => {
    if (agentModelId && agentChannelId && sessionMetaChannelId && agentChannelId !== sessionMetaChannelId) {
      toast.error('分叉会话失败', {
        description: '分叉只能使用源会话同一渠道下的模型，请切回当前会话渠道后再试。',
      })
      return
    }
    const forkModelId = agentChannelId === sessionMetaChannelId ? agentModelId || undefined : undefined

    try {
      const meta = await window.electronAPI.forkAgentSession({
        sessionId,
        upToMessageUuid,
        modelId: forkModelId,
      })
      setAgentSessions((prev) => [meta, ...prev])

      // 切换到新会话 tab
      openSession('agent', meta.id, meta.title)

      toast.success('已创建分叉会话', {
        description: meta.title,
      })
    } catch (error) {
      console.error('[AgentView] 分叉会话失败:', error)
      const rawMsg = error instanceof Error ? error.message : '未知错误'
      // SDK 偶尔会因为 sidechain/消息归属问题抛 "not found in session"，
      // 这里给出更可操作的中文提示，而不是把 SDK 内部英文报错直接透传给用户
      const friendlyDesc = /not found in session/i.test(rawMsg)
        ? '该消息无法作为分叉起点（可能属于子代理执行过程或已被清理）。请选择主对话中的其他消息再试。'
        : rawMsg
      toast.error('分叉会话失败', {
        description: friendlyDesc,
      })
    }
  }, [sessionId, agentChannelId, agentModelId, sessionMetaChannelId, openSession, setAgentSessions])

  /** 快照回退：同一会话内回退到指定消息点，恢复文件 + 截断对话 */
  const [rewindTargetUuid, setRewindTargetUuid] = React.useState<string | null>(null)

  const handleRewindRequest = React.useCallback((assistantMessageUuid: string): void => {
    setRewindTargetUuid(assistantMessageUuid)
  }, [])

  const handleRewindConfirm = React.useCallback(async (): Promise<void> => {
    if (!rewindTargetUuid) return
    const targetUuid = rewindTargetUuid
    setRewindTargetUuid(null)

    try {
      const result = await window.electronAPI.rewindSession({
        sessionId,
        assistantMessageUuid: targetUuid,
      })

      // 刷新消息列表
      store.set(agentMessageRefreshAtom, (prev) => {
        const map = new Map(prev)
        map.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
        return map
      })

      // 刷新预览面板的 diff（文件已被回退，当前显示的内容已过期）
      store.set(agentDiffRefreshVersionAtom, (prev) => {
        const m = new Map(prev); m.set(sessionId, (prev.get(sessionId) ?? 0) + 1); return m
      })

      if (result.fileRewind?.canRewind) {
        const fileCount = result.fileRewind.filesChanged?.length ?? 0
        toast.success('已回退到此处', {
          description: fileCount > 0 ? `${fileCount} 个文件已恢复` : '文件无变化',
        })
      } else if (result.fileRewind?.error) {
        toast.warning('已回退对话', {
          description: `文件恢复不可用：${result.fileRewind.error}`,
        })
      } else {
        toast.success('已回退到此处')
      }
    } catch (error) {
      console.error('[AgentView] 回退失败:', error)
      toast.error('回退失败', {
        description: error instanceof Error ? error.message : '未知错误',
      })
    }
  }, [rewindTargetUuid, sessionId, store])

  // 监听快捷键系统分发的 stop-generation 事件
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

  const allAskUserRequests = useAtomValue(allPendingAskUserRequestsAtom)
  const allPermissionRequests = useAtomValue(allPendingPermissionRequestsAtom)
  const allExitPlanRequests = useAtomValue(allPendingExitPlanRequestsAtom)
  const hasBannerOverlay =
    (allAskUserRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allExitPlanRequests.get(sessionId)?.length ?? 0) > 0
  const hasBlockingRequests = hasBannerOverlay || (allPermissionRequests.get(sessionId)?.length ?? 0) > 0
  const canSendQueuedNow = messagesLoaded && (streaming || !messagesRefreshing) && !!agentChannelId && hasAvailableModel && !hasBlockingRequests
  const autoSendingQueuedRef = React.useRef(false)
  const queuedSendInFlightRef = React.useRef(false)
  const sendingQueuedMessageIdsRef = React.useRef<Set<string>>(new Set())

  const handleSendQueuedNow = React.useCallback((messageId: string): void => {
    if (!canSendQueuedNow) return
    if (!streaming && messagesRefreshingRef.current) return
    if (queuedSendInFlightRef.current || sendingQueuedMessageIdsRef.current.has(messageId)) return
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return

    queuedSendInFlightRef.current = true
    sendingQueuedMessageIdsRef.current.add(messageId)
    setQueuedMessages((prev) => removeQueuedMessage(prev, messageId))
    sendPlainTextAgentMessage(message)
      .catch((error) => {
        console.error('[AgentView] 队列消息发送失败:', error)
        toast.error('队列消息发送失败', { description: String(error) })
        setQueuedMessages((prev) => restoreQueuedMessageToFront(prev, message))
      })
      .finally(() => {
        sendingQueuedMessageIdsRef.current.delete(messageId)
        queuedSendInFlightRef.current = false
      })
  }, [canSendQueuedNow, queuedMessages, sendPlainTextAgentMessage, setQueuedMessages, streaming])

  const handleRecallQueuedMessage = React.useCallback((messageId: string): void => {
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return

    setQueuedMessages((prev) => removeQueuedMessage(prev, messageId))
    const recalledQuotedSelection = message.quotedSelection
    if (recalledQuotedSelection) {
      setQuotedSelectionMap((prev) => {
        const map = new Map(prev)
        map.set(sessionId, recalledQuotedSelection)
        return map
      })
    }
    restoreQueuedAttachmentsToPending(message.attachments)

    const hasDraft = inputContent.trim().length > 0
    const nextDraft = hasDraft
      ? `${inputContent.trimEnd()}\n\n${message.text}`
      : message.text
    setInputContent(nextDraft)

    // 已有草稿时，用「原草稿 HTML + 队列文本段落 HTML」合并，保留原草稿的 mention 等富文本节点；
    // 空草稿时留空 HTML，交给编辑器按纯文本重建（与正常输入渲染一致）。
    if (hasDraft) {
      const draftHtml = inputHtmlContent.trim().length > 0
        ? inputHtmlContent
        : queuedTextToParagraphHtml(inputContent)
      setInputHtmlContent(`${draftHtml}${queuedTextToParagraphHtml(message.text)}`)
    } else {
      setInputHtmlContent('')
    }
  }, [inputContent, inputHtmlContent, queuedMessages, restoreQueuedAttachmentsToPending, sessionId, setInputContent, setInputHtmlContent, setQueuedMessages, setQuotedSelectionMap])

  const handleRemoveQueuedMessage = React.useCallback((messageId: string): void => {
    setQueuedMessages((prev) => removeQueuedMessage(prev, messageId))
  }, [setQueuedMessages])

  const handleMoveQueuedMessage = React.useCallback((
    sourceId: string,
    targetId: string,
    placement: QueueDropPlacement,
  ): void => {
    setQueuedMessages((prev) => moveQueuedMessage(prev, sourceId, targetId, placement))
  }, [setQueuedMessages])

  React.useEffect(() => {
    if (autoSendingQueuedRef.current) return
    if (queuedSendInFlightRef.current) return
    if (queuedMessages.length === 0) return
    if (messagesRefreshingRef.current) return
    if (!canSendQueuedNow || streaming || stoppedByUser) return

    const message = queuedMessages[0]
    if (!message) return
    if (sendingQueuedMessageIdsRef.current.has(message.id)) return

    autoSendingQueuedRef.current = true
    queuedSendInFlightRef.current = true
    sendingQueuedMessageIdsRef.current.add(message.id)
    setQueuedMessages((prev) => removeQueuedMessage(prev, message.id))
    sendPlainTextAgentMessage(message)
      .catch((error) => {
        console.error('[AgentView] 自动发送队列消息失败:', error)
        toast.error('自动发送队列消息失败', { description: String(error) })
        setQueuedMessages((prev) => restoreQueuedMessageToFront(prev, message))
      })
      .finally(() => {
        sendingQueuedMessageIdsRef.current.delete(message.id)
        queuedSendInFlightRef.current = false
        autoSendingQueuedRef.current = false
      })
  }, [canSendQueuedNow, queuedMessages, sendPlainTextAgentMessage, setQueuedMessages, stoppedByUser, streaming])

  // ===== 预览面板状态（toggle 快捷键，分屏布局在 MainArea） =====
  const setPreviewOpenMap = useSetAtom(previewPanelOpenMapAtom)
  const [processGroupsKeepExpanded, setProcessGroupsKeepExpanded] = useAtom(agentProcessGroupsKeepExpandedAtom)

  const togglePreviewPanel = React.useCallback(() => {
    setPreviewOpenMap((prev) => {
      const m = new Map(prev)
      const current = m.get(sessionId) ?? false
      m.set(sessionId, !current)
      return m
    })
  }, [sessionId, setPreviewOpenMap])

  React.useEffect(() => {
    return registerShortcut('toggle-preview-panel', togglePreviewPanel)
  }, [togglePreviewPanel])

  const hasTextInput = inputContent.trim().length > 0
  const canSend = messagesLoaded && (streaming || !messagesRefreshing) && (hasTextInput || pendingFiles.length > 0 || !!suggestion) && agentChannelId !== null && hasAvailableModel && (!streaming || hasTextInput)

  const inputToolbarItems = React.useMemo<ToolbarItem[]>(() => [
    {
      key: 'model',
      node: (
        <ModelSelector
          filterChannelIds={sessionAgentRuntime === 'pi' ? undefined : agentChannelIds}
          externalSelectedModel={externalSelectedModel}
          onModelSelect={handleModelSelect}
          useSharedOpenState
        />
      ),
    },
    {
      key: 'runtime',
      node: (
        <AgentRuntimeSelector
          runtime={sessionAgentRuntime}
          disabled={streaming || backgroundWaiting}
          onChange={handleAgentRuntimeChange}
        />
      ),
    },
    { key: 'permission-mode', node: <PermissionModeSelector sessionId={sessionId} /> },
    {
      key: 'thinking',
      node: (
        <AgentThinkingPopover
          agentThinking={agentThinking}
          onToggle={() => {
            const next = agentThinking?.type === 'adaptive'
              ? { type: 'disabled' as const }
              : { type: 'adaptive' as const }
            setAgentThinking(next)
            window.electronAPI.updateSettings({ agentThinking: next })
          }}
        />
      ),
    },
    { key: 'speech', node: <SpeechButton className={inputToolbarButtonClass} /> },
    {
      key: 'attach-file',
      node: (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={inputToolbarButtonClass}
              onClick={handleOpenFileDialog}
            >
              <Paperclip className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>添加附件</p>
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'attach-folder',
      node: (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={inputToolbarButtonClass}
              onClick={handleAttachFolder}
            >
              <FolderPlus className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>附加文件夹</p>
          </TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'context-usage',
      node: (
        <ContextUsageBadge
          inputTokens={contextStatus.inputTokens}
          outputTokens={contextStatus.outputTokens}
          cacheReadTokens={contextStatus.cacheReadTokens}
          cacheCreationTokens={contextStatus.cacheCreationTokens}
          contextWindow={contextStatus.contextWindow}
          usageUpdatedAt={contextStatus.usageUpdatedAt}
          isCompacting={contextStatus.isCompacting}
          isProcessing={streaming}
          sessionId={sessionId}
          channelId={planQuotaChannelId}
          channelUpdatedAt={planQuotaChannelUpdatedAt}
          onCompact={handleCompact}
        />
      ),
    },
    {
      key: 'display-options',
      node: (
        <DisplayOptionsPopover
          processGroupsKeepExpanded={processGroupsKeepExpanded}
          onProcessGroupsKeepExpandedChange={setProcessGroupsKeepExpanded}
        />
      ),
    },
  ], [
    agentChannelIds,
    agentChannelId,
    planQuotaChannelId,
    planQuotaChannelUpdatedAt,
    agentModelId,
    handleModelSelect,
    sessionAgentRuntime,
    backgroundWaiting,
    handleAgentRuntimeChange,
    sessionId,
    agentThinking,
    setAgentThinking,
    handleOpenFileDialog,
    handleAttachFolder,
    contextStatus.inputTokens,
    contextStatus.outputTokens,
    contextStatus.cacheReadTokens,
    contextStatus.cacheCreationTokens,
    contextStatus.contextWindow,
    contextStatus.isCompacting,
    streaming,
    handleCompact,
    processGroupsKeepExpanded,
    setProcessGroupsKeepExpanded,
  ])

  const inputTrailingNode = streaming && !hasTextInput ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={inputToolbarDangerButtonClass}
          onClick={handleStop}
        >
          <Square className="size-[16px]" fill="currentColor" strokeWidth={0} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>停止 Agent ({getAcceleratorDisplay(getActiveAccelerator('stop-generation'))})</p>
      </TooltipContent>
    </Tooltip>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        canSend ? inputToolbarSendButtonClass : inputToolbarDisabledButtonClass
      )}
      onClick={() => handleSend()}
      disabled={!canSend}
    >
      <CornerDownLeft className="size-[22px]" />
    </Button>
  )

  // 同批图片附件 — 用于大图预览时左右翻页（提取到 useMemo 避免每次渲染重建）
  const pendingImageFiles = React.useMemo(
    () => pendingFiles.filter((f) => f.mediaType.startsWith('image/') && !!f.previewUrl),
    [pendingFiles]
  )
  const imageSiblingsForPending = React.useMemo(
    () => pendingImageFiles.map((f) => ({
      previewUrl: f.previewUrl as string,
      filename: f.filename,
      onEditComplete: (editedDataUrl: string) => handleAttachmentEditComplete(f.id, editedDataUrl),
    })),
    [pendingImageFiles, handleAttachmentEditComplete]
  )

  return (
    <>
    <AgentSessionProvider sessionId={sessionId}>
      <div className="flex h-full min-h-0 flex-1 min-w-0 max-w-[min(72rem,100%)] flex-col overflow-hidden mx-auto">
        {/* Agent Header */}
        <AgentHeader sessionId={sessionId} />

        {/* 消息区域 */}
        <AgentMessages
          sessionId={sessionId}
          sessionModelId={agentModelId || undefined}
          messagesLoaded={messagesLoaded}
          persistedSDKMessages={persistedSDKMessages}
          streaming={streaming}
          streamState={streamState}
          liveMessages={liveMessages}
          sessionPath={sessionPath}
          attachedDirs={allAttachedDirs}
          stoppedByUser={stoppedByUser}
          onRetry={handleRetry}
          onRetryInNewSession={handleRetryInNewSession}
          onFork={handleFork}
          onRewind={handleRewindRequest}
          onCompact={handleCompact}
        />

        {/* 权限请求横幅 */}
        <PermissionBanner sessionId={sessionId} />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner sessionId={sessionId} />


        {/* ExitPlanMode 计划审批横幅 */}
        <ExitPlanModeBanner sessionId={sessionId} />

        {/* 输入区域 — 交互横幅显示时隐藏，由横幅替代 */}
        {!hasBannerOverlay && (
        <div className="px-2.5 pb-2.5 md:px-[18px] md:pb-[18px]" data-input-mode="agent">
          <div
            className={cn(
              'rounded-[17px] border-[0.5px] border-border bg-background/70 backdrop-blur-sm transition-all duration-200',
              (isPlanMode || isPermissionPlanMode) && !isDragOver && 'plan-mode-border',
              isDragOver && 'border-[2px] border-dashed border-[#2ecc71] bg-[#2ecc71]/[0.03]'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {(isPlanMode || isPermissionPlanMode) && !isDragOver && <PlanModeDashedBorder />}
            {/* 无 Agent 渠道或无可用模型提示 */}
            {(!agentChannelId || !hasAvailableModel) && (
              <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Settings size={14} />
                <span>{!agentChannelId ? '请在设置中选择 Agent 供应商' : '暂无可用模型，请在设置中启用 Agent 渠道并配置模型'}</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => setSettingsOpen(true)}
                >
                  前往设置
                </button>
              </div>
            )}

            {/* 附件 + 引用选中文本 Chip（同排并排） */}
            {(pendingFiles.length > 0 || currentQuotedSelection) && (
              <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1.5">
                {pendingFiles.map((file) => (
                    <AttachmentPreviewItem
                      key={file.id}
                      filename={file.filename}
                      mediaType={file.mediaType}
                      previewUrl={file.previewUrl}
                      onRemove={() => handleRemoveFile(file.id)}
                      onClick={file.filename.startsWith('clipboard-') ? () => handleClipboardPreview(file) : undefined}
                      onEditComplete={(editedDataUrl) => handleAttachmentEditComplete(file.id, editedDataUrl)}
                      imageSiblings={imageSiblingsForPending}
                      siblingIndex={pendingImageFiles.findIndex((f) => f.id === file.id)}
                    />
                  ))}
                {currentQuotedSelection && (
                  <QuotedSelectionChip
                    text={currentQuotedSelection.text}
                    filePath={currentQuotedSelection.filePath}
                    sourceLabel={currentQuotedSelection.sourceLabel}
                    onRemove={handleRemoveQuotedSelection}
                  />
                )}
              </div>
            )}

            <AgentMessageQueue
              items={queuedMessages}
              canSendNow={canSendQueuedNow}
              onSendNow={handleSendQueuedNow}
              onRecall={handleRecallQueuedMessage}
              onRemove={handleRemoveQueuedMessage}
              onMove={handleMoveQueuedMessage}
            />

            {/* Agent 建议提示 */}
            {suggestion && !streaming && (
              <div className="px-3 pt-2.5 pb-1.5">
                <button
                  type="button"
                  className="group flex items-start gap-2 w-full rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.06]"
                  onClick={() => handleSend(suggestion)}
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
              onPasteLongText={handlePasteLongText}
              longTextPasteThreshold={longTextPasteAsAttachmentEnabled ? LONG_TEXT_ATTACHMENT_THRESHOLD : undefined}
              placeholder={
                agentChannelId && hasAvailableModel
                  ? sendWithCmdEnter
                    ? '输入消息... (⌘/Ctrl+Enter 发送，Enter 换行，@ 引用文件，/ 调用 Skill，# 调用 MCP，& 引用会话)'
                    : '输入消息... (Enter 发送，Shift+Enter 换行，@ 引用文件，/ 调用 Skill，# 调用 MCP，& 引用会话)'
                  : !agentChannelId
                    ? '请先在设置中选择 Agent 供应商'
                    : '暂无可用模型，请先在设置中启用渠道'
              }
              disabled={!agentChannelId || !hasAvailableModel}
              autoFocusTrigger={sessionId}
              collapsible
              enableMentions
              workspacePath={sessionPath}
              workspaceId={currentWorkspaceId}
              workspaceSlug={workspaceSlug}
              sessionId={sessionId}
              attachedDirs={workspaceMentionPaths}
              sessionAttachedDirs={sessionMentionPaths}
              htmlValue={inputHtmlContent}
              onHtmlChange={setInputHtmlContent}
              sendWithCmdEnter={sendWithCmdEnter}
            />

            {/* Footer 工具栏 — 容器变窄时尾部按钮自动折叠进「更多」Popover */}
            <InputToolbarOverflow items={inputToolbarItems} trailing={inputTrailingNode} />
          </div>
        </div>
        )}
      </div>
    </AgentSessionProvider>

    {/* 回退确认弹窗 */}
    <AlertDialog
      open={rewindTargetUuid !== null}
      onOpenChange={(v) => { if (!v) setRewindTargetUuid(null) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认回退</AlertDialogTitle>
          <AlertDialogDescription>
            回退将截断该消息之后的所有对话，并恢复文件到该时刻的状态。此操作不可撤销，确定要回退吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRewindConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            回退
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
