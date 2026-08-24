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
import { CornerDownLeft, Square, Settings, X, Copy, Check, Brain, Sparkles, ListTodo, Paperclip } from 'lucide-react'
import { AgentMessages, type AgentHistoryQuoteNavigationRequest } from './AgentMessages'
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
import { RichTextInput, type RichTextInputHandle } from '@/components/ai-elements/rich-text-input'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import { InputToolbarOverflow, type ToolbarItem } from '@/components/ai-elements/InputToolbarOverflow'
import {
  inputToolbarActiveButtonClass,
  inputToolbarButtonClass,
  inputToolbarDangerButtonClass,
  inputToolbarDisabledButtonClass,
  inputToolbarSendButtonClass,
} from '@/components/ai-elements/input-toolbar-styles'
import { preventHoverPopoverFocusRestore } from '@/components/ai-elements/input-toolbar-popover-focus'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
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
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { registerShortcut } from '@/lib/shortcut-registry'
import { supportsChannelPlanQuota } from '@/lib/channel-plan-quota'
import { previewFileMapAtom, previewPanelOpenMapAtom, quotedSelectionMapAtom, currentQuotedSelectionAtom } from '@/atoms/preview-atoms'
import type { QuotedSelection } from '@/atoms/preview-atoms'
import {
  agentStreamingStatesAtom,
  agentSessionStreamingStateAtomFamily,
  agentSessionInputStreamStateAtomFamily,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtomFamily,
  agentMessageQueueAtomFamily,
  agentWorkspacesAtom,
  agentStreamErrorsAtom,
  agentSessionDraftsAtom,
  agentSessionDraftSyncVersionsAtom,
  agentSessionDraftSyncVersionAtomFamily,
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
  agentEffortAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  sessionPersistedPermissionModeAtom,
  agentSessionPathMapAtom,
  allPendingAskUserRequestsAtom,
  allPendingPermissionRequestsAtom,
  allPendingExitPlanRequestsAtom,
  agentDiffPanelTabAtom,
} from '@/atoms/agent-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { longTextPasteAsAttachmentEnabledAtom } from '@/atoms/ui-preferences'
import { channelsAtom, modelSelectorOpenAtom } from '@/atoms/chat-atoms'
import { todoPlanningGroupsAtom } from '@/atoms/planning-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'
import type { AgentDeferredQueueMessageInput, AgentSendInput, AgentPendingFile, AgentThinkingLevel, FileDialogLargeFile, FileDialogResult, ModelOption, ReasoningCapability, SDKMessage, SDKUserMessage } from '@proma/shared'
import { inferContextWindow, inferReasoningTransport, isCodexFastModeSupportedModel, MAX_ATTACHMENT_SIZE, normalizeReasoningCapabilityLevel, normalizeReasoningLevel, resolveReasoningCapability, resolveReasoningProfile } from '@proma/shared'
import { fileToBase64, formatFileNames, getFileParentPath } from '@/lib/file-utils'
import { getFilePanelDragData, INSERT_FILE_MENTION_EVENT, type FilePanelDragItem } from '@/lib/file-panel-drag'
import { buildQuotedSelectionBlock, expandAgentHistoryQuoteMentions } from '@/lib/quoted-selection'
import { createClipboardPendingFile, createClipboardTextDraft, makeUniqueAttachmentName } from '@/lib/clipboard-text-attachment'
import { copyTextToClipboard } from '@/lib/clipboard'
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

/** 稳定的空 string 数组引用，避免无附件会话的 memo 链每次渲染失效。 */
const EMPTY_STRING_ARRAY: string[] = []
const LONG_TEXT_ATTACHMENT_THRESHOLD = 2000

function endOfToday(): number {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

interface OptimisticSDKUserMessage extends SDKUserMessage {
  _createdAt: number
}

interface PreparedAgentAttachment {
  referenceBlock: string
  attachments: AgentQueuedAttachment[]
  additionalDirectories: string[]
}

type AgentScopedRichTextInputProps = Omit<
  React.ComponentProps<typeof RichTextInput>,
  'value' | 'onChange' | 'draftScopeKey' | 'draftSyncVersion' | 'htmlValue' | 'onHtmlChange' | 'sessionId'
> & {
  sessionId: string
}

/**
 * 将高频草稿订阅限制在编辑器边界内。
 *
 * TipTap 停顿同步 Markdown/HTML 时只重渲染这个轻量包装器，避免 3000 行 AgentView
 * 连同消息历史和输入工具栏一起重新执行。外部清空/队列回填仍通过版本号强制覆盖编辑器。
 */
const AgentScopedRichTextInput = React.forwardRef<RichTextInputHandle, AgentScopedRichTextInputProps>(
  function AgentScopedRichTextInput({ sessionId, ...props }, ref): React.ReactElement {
    const value = useAtomValue(agentSessionDraftAtomFamily(sessionId))
    const htmlValue = useAtomValue(agentSessionDraftHtmlAtomFamily(sessionId))
    const draftSyncVersion = useAtomValue(agentSessionDraftSyncVersionAtomFamily(sessionId))
    const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
    const setDraftHtmlMap = useSetAtom(agentSessionDraftHtmlAtom)

    const handleChange = React.useCallback((nextValue: string): void => {
      setDraftsMap((previous) => {
        const currentValue = previous.get(sessionId) ?? ''
        const normalizedValue = nextValue.trim() === '' ? '' : nextValue
        if (currentValue === normalizedValue) return previous
        const next = new Map(previous)
        if (normalizedValue === '') next.delete(sessionId)
        else next.set(sessionId, normalizedValue)
        return next
      })
    }, [sessionId, setDraftsMap])

    const handleHtmlChange = React.useCallback((nextHtml: string): void => {
      setDraftHtmlMap((previous) => {
        const normalizedHtml = !nextHtml || nextHtml === '<p></p>' ? '' : nextHtml
        const currentHtml = previous.get(sessionId) ?? ''
        if (currentHtml === normalizedHtml) return previous
        const next = new Map(previous)
        if (normalizedHtml === '') next.delete(sessionId)
        else next.set(sessionId, normalizedHtml)
        return next
      })
    }, [sessionId, setDraftHtmlMap])

    return (
      <RichTextInput
        {...props}
        ref={ref}
        value={value}
        onChange={handleChange}
        draftScopeKey={sessionId}
        draftSyncVersion={draftSyncVersion}
        htmlValue={htmlValue}
        onHtmlChange={handleHtmlChange}
        sessionId={sessionId}
      />
    )
  },
)

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
  previous: number | undefined,
): number | undefined {
  return inferContextWindow(modelId) ?? previous
}

interface SDKMessageRecord {
  type?: string
  uuid?: string
  parent_tool_use_id?: string | null
  isSynthetic?: boolean
  error?: unknown
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

function removeRetriedErrorSDKMessage(messages: SDKMessage[], errorUuid: string | undefined): SDKMessage[] {
  if (!errorUuid) return messages
  const next = messages.filter((message) => {
    const record = message as unknown as SDKMessageRecord
    return !(record.type === 'assistant' && record.uuid === errorUuid && record.error !== undefined && record.error !== null)
  })
  return next.length === messages.length ? messages : next
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ===== 思考模式 Hover Popover =====

const OPENAI_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly AgentThinkingLevel[]
const OPENAI_STANDARD_THINKING_LEVELS = OPENAI_THINKING_LEVELS.slice(0, -1)
type OpenAIThinkingLevel = AgentThinkingLevel
const OPENAI_THINKING_LABELS: Record<OpenAIThinkingLevel, string> = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

function normalizeOpenAIThinkingLevel(
  level: AgentThinkingLevel | undefined,
  levels: readonly OpenAIThinkingLevel[],
): OpenAIThinkingLevel {
  if (level === 'minimal') return 'low'
  // max 会话设置在切到非 GPT-5.6 时由主进程降级为 xhigh；UI 同步展示有效档位。
  if (level === 'max' && !levels.includes('max')) return 'xhigh'
  return levels.includes(level as OpenAIThinkingLevel) ? level as OpenAIThinkingLevel : 'off'
}

interface CodexThinkingConfig {
  thinkingLevel: AgentThinkingLevel
  levels: readonly OpenAIThinkingLevel[]
  onThinkingLevelChange: (level: AgentThinkingLevel) => void
}

interface AgentThinkingPopoverProps {
  agentThinking: import('@proma/shared').ThinkingConfig | undefined
  onToggle: () => void
  codexConfig?: CodexThinkingConfig
}

function AgentThinkingPopover({ agentThinking, onToggle, codexConfig }: AgentThinkingPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const hoverTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const popoverReceivedFocusRef = React.useRef(false)
  const isCodex = Boolean(codexConfig)
  const thinkingLevels = codexConfig?.levels ?? OPENAI_STANDARD_THINKING_LEVELS
  const normalizedLevel = normalizeOpenAIThinkingLevel(
    codexConfig?.thinkingLevel,
    thinkingLevels,
  )
  const supportsThinkingToggle = thinkingLevels.includes('off')
  const isEnabled = isCodex ? !supportsThinkingToggle || normalizedLevel !== 'off' : agentThinking?.type === 'adaptive'
  const sliderPosition = thinkingLevels.indexOf(normalizedLevel)

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

  const handleButtonClick = (): void => {
    if (codexConfig) {
      if (!supportsThinkingToggle) return
      codexConfig.onThinkingLevelChange(isEnabled ? 'off' : 'high')
      return
    }
    onToggle()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(inputToolbarButtonClass, isEnabled && inputToolbarActiveButtonClass)}
          onClick={handleButtonClick}
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
        className="w-64 p-3"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => {
          popoverReceivedFocusRef.current = true
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(event) => {
          preventHoverPopoverFocusRestore(event, popoverReceivedFocusRef.current)
          popoverReceivedFocusRef.current = false
        }}
      >
        <div className="flex flex-col gap-3">
          {codexConfig ? (
            <>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-foreground/80">思考深度</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {OPENAI_THINKING_LABELS[normalizedLevel]}
                  </span>
                </div>
                <Slider
                  value={[sliderPosition]}
                  onValueChange={([position]) => codexConfig.onThinkingLevelChange(thinkingLevels[position!]!)}
                  min={0}
                  max={thinkingLevels.length - 1}
                  step={1}
                  aria-label="思考深度"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  {thinkingLevels.map((level) => <span key={level}>{OPENAI_THINKING_LABELS[level]}</span>)}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-foreground/70">思考模式</span>
              <Switch
                checked={isEnabled}
                onCheckedChange={onToggle}
                className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const store = useStore()
  const initialCachedMessages = store.get(agentSDKMessagesCacheAtom).get(sessionId)
  const [persistedSDKMessages, setPersistedSDKMessages] = React.useState<SDKMessage[]>(
    () => initialCachedMessages ?? [],
  )
  const persistedSDKMessagesRef = React.useRef<SDKMessage[]>([])
  persistedSDKMessagesRef.current = persistedSDKMessages
  const messagesRequestIdRef = React.useRef(0)
  const messagesMutationVersionRef = React.useRef(0)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  // 只订阅输入区/工具栏需要的低频流状态。
  const streamViewState = useAtomValue(agentSessionInputStreamStateAtomFamily(sessionId))
  const streaming = streamViewState.running
  // 软空闲态：本轮主体已结束、UI 可输入，但 SDK 通道仍开着等后台任务唤醒。
  // 此时服务端 activeSessions 仍保留，新消息须走注入通道而非新建 run。
  const backgroundWaiting = streamViewState.backgroundWaiting ?? false
  const stoppedByUserSessions = useAtomValue(stoppedByUserSessionsAtom)
  // 点击停止后，底层 Pi query 仍需一个很短的收尾窗口。该窗口内不可发起/排队新消息，
  // 否则旧 run 与新 run 会交错，导致同一用户消息被重复展示或持久化。
  const [isStopping, setIsStopping] = React.useState(false)
  const sendWithCmdEnter = useAtomValue(sendWithCmdEnterAtom)
  const longTextPasteAsAttachmentEnabled = useAtomValue(longTextPasteAsAttachmentEnabledAtom)
  const stoppedByUser = stoppedByUserSessions.has(sessionId)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  // Per-session 渠道/模型配置（优先读 session map，回退到全局默认值）
  const sessionChannelMap = useAtomValue(agentSessionChannelMapAtom)
  const sessionModelMap = useAtomValue(agentSessionModelMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const [defaultChannelId, setDefaultChannelId] = useAtom(agentChannelIdAtom)
  const [defaultModelId, setDefaultModelId] = useAtom(agentModelIdAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const planningGroups = useAtomValue(todoPlanningGroupsAtom)
  const [todoDialogOpen, setTodoDialogOpen] = React.useState(false)
  const [todoDraftTitle, setTodoDraftTitle] = React.useState('')
  const [todoSourceText, setTodoSourceText] = React.useState('')
  const [todoGroupId, setTodoGroupId] = React.useState('__none__')
  const [creatingTodo, setCreatingTodo] = React.useState(false)
  React.useEffect(() => window.electronAPI.onPlanningAgentOperation((operation) => {
    if (operation.sessionId !== sessionId) return
    const target = operation.target === 'todo' ? 'Todo' : '日程'
    const action = operation.action === 'created' ? '创建' : operation.action === 'updated' ? '更新' : '删除'
    toast.success(`已${action}${target}`, { description: `「${operation.title}」` })
  }), [sessionId])
  const sessionMeta = React.useMemo(
    () => sessions.find((s) => s.id === sessionId),
    [sessions, sessionId],
  )
  const sessionMetaChannelId = sessionMeta?.channelId
  const sessionMetaModelId = sessionMeta?.modelId
  const hasSessionMeta = Boolean(sessionMeta)
  const isLegacyTranscript = sessionMeta?.legacyTranscript?.continuationRequired === true
  const agentChannelId = sessionMetaChannelId ?? sessionChannelMap.get(sessionId) ?? defaultChannelId
  const agentModelId = sessionMetaModelId ?? sessionModelMap.get(sessionId) ?? defaultModelId
  const [agentThinking, setAgentThinking] = useAtom(agentThinkingAtom)
  const agentEffort = useAtomValue(agentEffortAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setModelSelectorOpen = useSetAtom(modelSelectorOpenAtom)
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
  const setWorkspaces = useSetAtom(agentWorkspacesAtom)
  const [restoreProjectRootDialogOpen, setRestoreProjectRootDialogOpen] = React.useState(false)
  const [restoringProjectRoot, setRestoringProjectRoot] = React.useState(false)
  // 保持 channelId 稳定：初始化前使用上次有效值，避免工具栏抖动
  const stableChannelIdRef = React.useRef(agentChannelId)
  if (agentChannelId) stableChannelIdRef.current = agentChannelId
  const stableChannelId = agentChannelId ?? stableChannelIdRef.current

  // 已有会话首次打开时，从会话元数据初始化 per-session map。
  // setter 内的 `prev.has(sessionId)` 守卫保证幂等，外层不再订阅 Map atom，
  // 避免 setter 写入 → atom 引用变化 → effect 重跑的自循环（React #185）。
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
  const attachedDirs = attachedDirsMap.get(sessionId) ?? EMPTY_STRING_ARRAY
  const setAttachedFilesMap = useSetAtom(agentAttachedFilesMapAtom)
  const attachedFilesMap = useAtomValue(agentAttachedFilesMapAtom)
  const attachedFiles = attachedFilesMap.get(sessionId) ?? EMPTY_STRING_ARRAY
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId
    ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? EMPTY_STRING_ARRAY)
    : EMPTY_STRING_ARRAY
  const setWsAttachedFilesMap = useSetAtom(workspaceAttachedFilesMapAtom)
  const wsAttachedFilesMap = useAtomValue(workspaceAttachedFilesMapAtom)
  const wsAttachedFiles = currentWorkspaceId
    ? (wsAttachedFilesMap.get(currentWorkspaceId) ?? EMPTY_STRING_ARRAY)
    : EMPTY_STRING_ARRAY

  // AgentView 只保留低频外部草稿写入；编辑器本地同步由 AgentScopedRichTextInput 订阅，
  // 避免每次停顿保存草稿时重渲染整个 Agent 页面。
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const setDraftSyncVersions = useSetAtom(agentSessionDraftSyncVersionsAtom)
  const setDraftHtmlMap = useSetAtom(agentSessionDraftHtmlAtom)
  const setInputContent = React.useCallback((value: string) => {
    setDraftSyncVersions((previous) => {
      const next = new Map(previous)
      next.set(sessionId, (next.get(sessionId) ?? 0) + 1)
      return next
    })
    setDraftsMap((previous) => {
      const currentValue = previous.get(sessionId) ?? ''
      const normalizedValue = value.trim() === '' ? '' : value
      if (currentValue === normalizedValue) return previous
      const next = new Map(previous)
      if (normalizedValue === '') next.delete(sessionId)
      else next.set(sessionId, normalizedValue)
      return next
    })
  }, [sessionId, setDraftSyncVersions, setDraftsMap])
  const setInputHtmlContent = React.useCallback((html: string) => {
    setDraftHtmlMap((previous) => {
      const normalizedHtml = !html || html === '<p></p>' ? '' : html
      const currentHtml = previous.get(sessionId) ?? ''
      if (currentHtml === normalizedHtml) return previous
      const next = new Map(previous)
      if (normalizedHtml === '') next.delete(sessionId)
      else next.set(sessionId, normalizedHtml)
      return next
    })
  }, [sessionId, setDraftHtmlMap])

  const createTodoForCurrentSession = React.useCallback(async (title: string, groupId: string, sourceText?: string): Promise<boolean> => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      toast.error('Todo 标题不能为空')
      return false
    }
    if (normalizedTitle.length > 500) {
      toast.error('Todo 标题不能超过 500 字')
      return false
    }

    try {
      await window.electronAPI.createTodo({
        title: normalizedTitle,
        notes: sourceText?.trim() && sourceText.trim() !== normalizedTitle ? sourceText.trim() : undefined,
        dueAt: endOfToday(),
        groupId: groupId === '__none__' ? undefined : groupId,
        sessionId,
        workspaceId: currentWorkspaceId ?? undefined,
      })
      toast.success('已添加 Todo', { description: '已关联当前 Agent 会话' })
      return true
    } catch (error) {
      console.error('[AgentView] 创建 Todo 失败:', error)
      toast.error('创建 Todo 失败', { description: String(error) })
      return false
    }
  }, [currentWorkspaceId, sessionId])

  const handleOpenReplyTodoDialog = React.useCallback((text: string): void => {
    const sourceText = text.trim()
    const firstLine = sourceText.split('\n').map((line) => line.trim()).find(Boolean) ?? sourceText
    setTodoSourceText(sourceText)
    setTodoDraftTitle(firstLine.replace(/^#{1,6}\s+/, '').slice(0, 500))
    setTodoGroupId('__none__')
    setTodoDialogOpen(true)
  }, [])
  const handleOpenRestoreProjectRootDialog = React.useCallback(() => {
    setRestoreProjectRootDialogOpen(true)
  }, [])

  const handleCreateReplyTodo = React.useCallback(async (): Promise<void> => {
    setCreatingTodo(true)
    try {
      if (await createTodoForCurrentSession(todoDraftTitle, todoGroupId, todoSourceText)) {
        setTodoDialogOpen(false)
      }
    } finally {
      setCreatingTodo(false)
    }
  }, [createTodoForCurrentSession, todoDraftTitle, todoGroupId, todoSourceText])

  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  // RichTextInput 命令接口 ref（右侧文件面板拖入时插入 @file 引用）
  const richTextInputRef = React.useRef<RichTextInputHandle>(null)
  const historyQuoteNavigationRequestIdRef = React.useRef(0)
  const [historyQuoteNavigation, setHistoryQuoteNavigation] = React.useState<AgentHistoryQuoteNavigationRequest | null>(null)
  const handleAddHistoryQuote = React.useCallback((quote: QuotedSelection): boolean => {
    return richTextInputRef.current?.insertAgentHistoryQuoteMention(quote) ?? false
  }, [])
  const handleAgentHistoryQuoteClick = React.useCallback((quote: QuotedSelection): void => {
    if (
      quote.sourceType !== 'agent-history'
      || !quote.messageId
      || quote.selectionStart == null
      || quote.selectionEnd == null
      || quote.selectionEnd <= quote.selectionStart
    ) {
      return
    }
    historyQuoteNavigationRequestIdRef.current += 1
    setHistoryQuoteNavigation({
      sessionId,
      quote,
      requestId: historyQuoteNavigationRequestIdRef.current,
    })
  }, [sessionId])
  React.useEffect(() => {
    setHistoryQuoteNavigation(null)
  }, [sessionId])
  // 父组件同步生成的 ID，同时提供给 RichTextInput 与 SpeechButton，避免工具栏 memo 捕获空值。
  const agentVoiceInputId = React.useId()
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
  const isCodexFastModeAvailable = hasSessionMeta
    && agentChannelProvider === 'openai-codex'
    && isCodexFastModeSupportedModel(agentModelId ?? undefined)
  const codexFastModeEnabled = isCodexFastModeAvailable && sessionMeta?.codexFastMode === true
  const reasoningProfile = hasSessionMeta
    ? resolveReasoningProfile({
      modelId: agentModelId ?? undefined,
      transport: inferReasoningTransport(agentChannelProvider),
    })
    : undefined
  const reasoningCapabilityKey = `${agentChannelId ?? ''}:${agentModelId ?? ''}`
  const [piReasoningCapability, setPiReasoningCapability] = React.useState<{
    key: string
    capability: ReasoningCapability | undefined
  }>({ key: '', capability: undefined })
  React.useEffect(() => {
    if (!hasSessionMeta || !agentChannelId || !agentModelId) {
      setPiReasoningCapability({ key: reasoningCapabilityKey, capability: undefined })
      return
    }

    let cancelled = false
    void window.electronAPI.getPiReasoningCapability(agentChannelId, agentModelId)
      .then((capability) => {
        if (!cancelled) setPiReasoningCapability({ key: reasoningCapabilityKey, capability })
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[AgentView] 读取 Pi reasoning capability 失败:', error)
          setPiReasoningCapability({ key: reasoningCapabilityKey, capability: undefined })
        }
      })
    return () => { cancelled = true }
  }, [agentChannelId, agentModelId, hasSessionMeta, reasoningCapabilityKey])

  const effectiveReasoningCapability = piReasoningCapability.key === reasoningCapabilityKey
    ? piReasoningCapability.capability ?? resolveReasoningCapability({ profile: reasoningProfile })
    : resolveReasoningCapability({ profile: reasoningProfile })
  const isSessionThinkingAvailable = Boolean(effectiveReasoningCapability)
  const openAIThinkingLevels = effectiveReasoningCapability?.levels ?? OPENAI_STANDARD_THINKING_LEVELS
  const fallbackOpenAIThinkingLevel: AgentThinkingLevel = agentEffort === 'max'
    ? 'xhigh'
    : agentEffort ?? (agentThinking?.type === 'adaptive' ? 'high' : 'off')
  const persistedReasoningLevel = sessionMeta?.reasoningLevel ?? sessionMeta?.openAIThinkingLevel
  const normalizedReasoningLevel = reasoningProfile
    ? normalizeReasoningLevel(reasoningProfile, persistedReasoningLevel ?? fallbackOpenAIThinkingLevel)
    : normalizeReasoningCapabilityLevel(effectiveReasoningCapability, persistedReasoningLevel ?? fallbackOpenAIThinkingLevel)
  const openAIThinkingLevel = normalizedReasoningLevel ?? (persistedReasoningLevel ?? fallbackOpenAIThinkingLevel)

  // Pi runtime supports all protocols, so any enabled channel with an enabled model is available.
  const hasAvailableModel = React.useMemo(
    () => globalChannels.some((channel) => channel.enabled && channel.models.some((model) => model.enabled)),
    [globalChannels],
  )
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
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? null
  const projectRootPath = currentWorkspace?.projectRootPath ?? null
  React.useEffect(() => {
    let disposed = false

    // 同一项目重新关联本地根时 slug 保持不变，必须立即废弃旧路径与旧请求结果。
    setWorkspaceFilesPath(null)
    if (!workspaceSlug) return

    window.electronAPI
      .getWorkspaceFilesPath(workspaceSlug)
      .then((path) => {
        if (!disposed) setWorkspaceFilesPath(path)
      })
      .catch(() => {
        if (!disposed) setWorkspaceFilesPath(null)
      })

    return () => {
      disposed = true
    }
  }, [workspaceSlug, projectRootPath])

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
    // 本地乐观消息优先于正在进行中的旧 IPC 快照。
    messagesMutationVersionRef.current += 1
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

  const clearStoppedByUser = React.useCallback(() => {
    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, store])

  const sendPlainTextAgentMessage = React.useCallback(async (
    message: AgentQueuedMessage,
  ): Promise<void> => {
    const quotedSelectionBlock = message.quotedSelection
      ? buildQuotedSelectionBlock(message.quotedSelection)
      : ''
    const payload = buildQueuedMessageSendPayload(message, quotedSelectionBlock)
    if (!payload.rawText || !agentChannelId || !hasAvailableModel) return

    clearStoppedByUser()
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // “立即发送”与后台续轮都由主进程用实时状态路由：活跃通道可用则注入，
    // 否则保留到 deferred queue。这里的 streaming 只表达用户是否要求打断，不决定路由。
    const result = await window.electronAPI.submitOrEnqueueAgentMessage({
      queueMessageId: message.id,
      sessionId,
      userMessage: payload.sdkText,
      rawUserMessage: payload.rawText,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      additionalDirectories: message.additionalDirectories,
      permissionModeOverride: permissionMode,
      dispatch: 'now',
      interrupt: streaming,
      mentionedSkills: payload.mentions.mentionedSkills,
      mentionedMcpServers: payload.mentions.mentionedMcpServers,
      mentionedSessionIds: payload.mentions.mentionedSessionIds,
      mentionedTodoIds: payload.mentions.mentionedTodoIds,
      mentionedCalendarEventIds: payload.mentions.mentionedCalendarEventIds,
    })
    if (result.disposition === 'injected') {
      appendLiveUserMessage(createUserSDKMessage(payload.rawText, message.id, Date.now()))
      setQueuedMessages((prev) => removeQueuedMessage(prev, message.id))
      return
    }

    // 活跃通道已结束或不存在时，主进程已接管消息；恢复/保留队列投影，等待 started 事件消费。
    setQueuedMessages((prev) => prev.some((item) => item.id === message.id) ? prev : [...prev, message])
  }, [
    agentChannelId,
    agentModelId,
    appendLiveUserMessage,
    clearStoppedByUser,
    currentWorkspaceId,
    hasAvailableModel,
    permissionMode,
    sessionId,
    setAgentStreamErrors,
    setQueuedMessages,
    streaming,
  ])

  // 消息首次加载状态直接由同步缓存决定；缓存命中时首个 render 就显示历史，IPC 只做后台校准。
  const [messagesLoaded, setMessagesLoaded] = React.useState(initialCachedMessages !== undefined)
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
    const requestId = ++messagesRequestIdRef.current
    const requestMutationVersion = messagesMutationVersionRef.current
    let cancelled = false
    window.electronAPI.getAgentSessionSDKMessages(sessionId)
      .then((sdkMsgs) => {
        if (cancelled || requestId !== messagesRequestIdRef.current) return
        if (requestMutationVersion !== messagesMutationVersionRef.current) {
          // 请求期间已有本地消息变更，旧 IPC 快照不能覆盖当前内存消息。
          setMessagesLoaded(true)
          messagesRefreshingRef.current = false
          setMessagesRefreshing(false)
          return
        }
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
            // 软空闲态（后台任务等待）：必须保留 backgroundWaiting 标志（否则 handleSend 误走新建 run）。
            // 实时文本只在 liveMessages 中，完成消息刷新时随其统一清理。
            if (state.inputTokens !== undefined) {
              // 保留 usage 数据，仅清除本轮工具活动展示状态。
              map.set(sessionId, {
                running: false,
                backgroundWaiting: state.backgroundWaiting,
                inputTokens: state.inputTokens,
                outputTokens: state.outputTokens,
                cacheReadTokens: state.cacheReadTokens,
                cacheCreationTokens: state.cacheCreationTokens,
                contextWindow: state.contextWindow,
                contextUsageIsEstimated: state.contextUsageIsEstimated,
                model: state.model,
                contextCompaction: state.contextCompaction,
              })
            } else if (state.backgroundWaiting || state.contextCompaction) {
              // 无 usage 数据但处于软空闲或有待展示的压缩终态时，保留必要状态。
              map.set(sessionId, {
                running: false,
                backgroundWaiting: state.backgroundWaiting,
                contextCompaction: state.contextCompaction,
              })
            } else {
              map.delete(sessionId)
            }
            return map
          })
          setLiveMessagesMap((prev) => {
            if (!prev.has(sessionId)) return prev
            // 仍在运行中，不清除实时消息（与 streamingStates 保护逻辑一致）
            const streamingState = store.get(agentSessionStreamingStateAtomFamily(sessionId))
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

  // 从会话元数据初始化附加目录（仅冷启动水合，后续由 handleAttachContent/handleDetachDirectory 实时写入）
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
      // Agent 侧使用解码后的 SDK 文本（@file 路径还原为真实路径），
      // 展示/持久化保留编码原文（remarkMentions 解码显示）。
      sdkMessage: parseQueuedMessageMentions(pendingPrompt.message).cleanedText,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      additionalDirectories: Array.from(new Set([...attachedDirs, ...attachedFileDirectories, ...(pendingPrompt.additionalDirectories ?? [])])),
      mentionedTodoIds: pendingPrompt.mentionedTodoIds,
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
          model: snapshot.modelId,
          startedAt: streamStartedAt,
          inputTokens: existing?.inputTokens,
          contextWindow: resolveRunContextWindow(snapshot.modelId, existing?.contextWindow),
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
        userMessage: snapshot.sdkMessage,
        rawUserMessage: snapshot.message,
        channelId: snapshot.channelId,
        modelId: snapshot.modelId,
        workspaceId: snapshot.workspaceId,
        startedAt: streamStartedAt,
        permissionModeOverride: permissionMode,
        ...(snapshot.additionalDirectories && snapshot.additionalDirectories.length > 0 && {
          additionalDirectories: snapshot.additionalDirectories,
        }),
        ...(snapshot.mentionedTodoIds && snapshot.mentionedTodoIds.length > 0 && {
          mentionedTodoIds: snapshot.mentionedTodoIds,
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
  }, [messagesLoaded, pendingPrompt, sessionId, agentChannelId, agentModelId, agentChannelProvider, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates, permissionMode, attachedDirs, attachedFileDirectories])
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
        description: '当前 Agent 会话没有绑定有效项目。请在顶部选择项目，或新建 Agent 会话后重新上传。',
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
        const data = await window.electronAPI.readBinaryBase64(sourcePath, {
          sessionId,
          candidateBasePaths: parentPath ? [parentPath] : undefined,
        }, MAX_ATTACHMENT_SIZE)
        if (!data) {
          staleDraftFiles.push(f.filename)
          continue
        }
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
          description: '请确认当前项目可用，或新建 Agent 会话后重新上传。',
        })
        return null
      }
    }

    if (allRefs.length === 0) {
      toast.error('附件没有成功加入消息', {
        description: '请重新上传文件，或切换到有效项目后再试。',
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

  /** 将已选文件加入待发送附件，目录由外层走会话授权路径。 */
  const addDialogFilesAsAttachments = React.useCallback(async (result: FileDialogResult): Promise<void> => {
    const largeFiles = result.largeFiles ?? []
    const skippedFiles = result.skippedFiles ?? []
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
      toast.warning(`以下文件无法读取，已跳过：${formatFileNames(skippedFiles.map((file) => file.filename))}`)
    }
  }, [addLargeDialogFilesAsReferences, setPendingFiles])

  /** 打开混合选择器：文件作为附件，文件夹仅授权给当前会话。 */
  const handleAttachContent = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileOrFolderDialog()
      const largeFiles = result.largeFiles ?? []
      const skippedFiles = result.skippedFiles ?? []
      if (result.files.length === 0 && largeFiles.length === 0 && skippedFiles.length === 0 && result.directories.length === 0) return

      await addDialogFilesAsAttachments(result)

      const attachedDirectoryNames: string[] = []
      const failedDirectoryNames: string[] = []
      for (const directory of result.directories) {
        try {
          const updated = await window.electronAPI.attachDirectory({
            sessionId,
            directoryPath: directory.path,
          })
          setAttachedDirsMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, updated)
            return map
          })
          attachedDirectoryNames.push(directory.name)
        } catch (error) {
          console.error('[AgentView] 附加文件夹失败:', error)
          failedDirectoryNames.push(directory.name)
        }
      }

      if (attachedDirectoryNames.length > 0) {
        toast.success(`已附加目录: ${formatFileNames(attachedDirectoryNames)}`)
      }
      if (failedDirectoryNames.length > 0) {
        toast.error(`以下文件夹附加失败：${formatFileNames(failedDirectoryNames)}`)
      }
    } catch (error) {
      console.error('[AgentView] 附加内容选择失败:', error)
      toast.error('附加文件或文件夹失败')
    }
  }, [addDialogFilesAsAttachments, sessionId, setAttachedDirsMap])

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

  /** 将右侧文件面板拖入的目录附加到会话（保持 Agent 可访问）。返回是否成功。 */
  const addPanelDirectory = React.useCallback(async (dirPath: string): Promise<boolean> => {
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
      return true
    } catch (error) {
      console.error('[AgentView] 面板拖拽附加目录失败:', error)
      return false
    }
  }, [sessionId, setAttachedDirsMap])

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

    // 优先识别右侧文件面板的自定义拖拽载荷（会话文件 / 项目文件引用）
    // 文件直接插入引用；文件夹先附加到会话（Agent 可访问），附加成功后才插入引用，
    // 避免失败时留下 Agent 无法访问的无效引用。
    const panelItems = getFilePanelDragData(e.dataTransfer)
    if (panelItems && panelItems.length > 0) {
      const files = panelItems.filter((item) => !item.isDirectory)
      const dirs = panelItems.filter((item) => item.isDirectory)
      if (files.length > 0) {
        richTextInputRef.current?.insertFileMentions(files)
      }
      for (const dir of dirs) {
        const ok = await addPanelDirectory(dir.path)
        if (ok) {
          richTextInputRef.current?.insertFileMentions([dir])
        }
      }
      return
    }

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

        // 拖拽的文件夹：附加到会话 + 插入可见的文件夹引用（与右侧面板拖拽体验一致）
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
            const dirName = dirPath.split(/[\\/]/).pop() || dirPath
            // 在输入框插入文件夹引用 chip（Agent 通过附加目录可访问）
            richTextInputRef.current?.insertFileMentions([{
              path: dirPath,
              name: dirName,
              isDirectory: true,
              scope: 'project',
            }])
            toast.success(`已附加目录: ${dirName}`)
          } catch (error) {
            console.error('[AgentView] 拖拽附加文件夹失败:', error)
          }
        }

        // 普通文件：复制到会话私有目录后插入 @ 引用（方案 B）
        // 引用指向会话私有工作目录内的副本路径，Agent 通过会话私有目录即可访问，
        // 与右侧面板拖拽/键盘 @ 引用保持一致；超大文件或无项目时回退附件逻辑。
        const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
        if (regularFiles.length > 0) {
          const sourcePaths = new Map<File, string>()
          for (const path of filePaths) {
            const file = pathMap.get(path)
            if (file) sourcePaths.set(file, path)
          }

          const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
          const canSave = Boolean(workspace?.slug)
          const savedRefs: Array<{ path: string; name: string }> = []
          const fallbackFiles: File[] = []

          for (const file of regularFiles) {
            if (!canSave || file.size > MAX_ATTACHMENT_SIZE) {
              fallbackFiles.push(file)
              continue
            }
            try {
              const data = await fileToBase64(file)
              const saved = await window.electronAPI.saveFilesToAgentSession({
                workspaceSlug: workspace!.slug,
                sessionId,
                files: [{ filename: file.name, data }],
              })
              if (saved && saved.length > 0) {
                const [savedFile] = saved
                if (savedFile) {
                  savedRefs.push({ path: savedFile.targetPath, name: savedFile.filename })
                } else {
                  fallbackFiles.push(file)
                }
              } else {
                fallbackFiles.push(file)
              }
            } catch (error) {
              console.error('[AgentView] 外部文件复制到会话目录失败:', error)
              fallbackFiles.push(file)
            }
          }

          if (savedRefs.length > 0) {
            richTextInputRef.current?.insertFileMentions(savedRefs.map((r) => ({
              path: r.path,
              name: r.name,
              isDirectory: false,
              scope: 'session',
            })))
            toast.success(`已引用 ${savedRefs.length} 个文件`)
          }
          if (fallbackFiles.length > 0) {
            addFilesAsAttachments(fallbackFiles, sourcePaths)
          }
        }
      } catch (error) {
        console.error('[AgentView] 路径检测失败，回退处理:', error)
        addFilesAsAttachments(droppedFiles)
      }
    } else {
      // 无路径信息：回退，所有项按普通文件处理
      addFilesAsAttachments(droppedFiles)
    }
  }, [sessionId, addFilesAsAttachments, addPanelDirectory, setAttachedDirsMap, workspaces, currentWorkspaceId])

  /** ModelSelector 选择回调 */
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    // 运行中的 Agent query 会继续使用启动时的模型；这里只更新会话配置，供本轮结束后的下一轮使用。
    const modelSwitchDeferred = streaming || backgroundWaiting

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

    // 空闲切换时清除旧的 contextWindow，让下一轮 result 重新提供真实值。
    // 运行中不能清除：当前轮仍在使用旧模型，旧模型的用量显示应保持稳定。
    if (!modelSwitchDeferred) {
      setStreamingStates((prev) => {
        const state = prev.get(sessionId)
        if (!state) return prev
        const map = new Map(prev)
        map.set(sessionId, { ...state, contextWindow: undefined })
        return map
      })
    }

    // 同时更新全局默认值（新会话继承）
    setDefaultChannelId(option.channelId)
    setDefaultModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)

    window.electronAPI.updateAgentSessionModel(sessionId, option.channelId, option.modelId)
      .then((updated) => {
        setAgentSessions((prev) => prev.map((session) => (
          session.id === updated.id ? updated : session
        )))
      })
      .catch(console.error)

    if (modelSwitchDeferred) {
      toast.info('模型已切换，本轮结束后生效')
    }
  }, [sessionId, streaming, backgroundWaiting, setSessionChannelMap, setSessionModelMap, setDefaultChannelId, setDefaultModelId, setAgentSessions])

  const handleCodexFastModeChange = React.useCallback(async (): Promise<void> => {
    if (!isCodexFastModeAvailable || streaming || backgroundWaiting || !sessionMeta) return

    const previousSessionMeta = sessionMeta
    const nextEnabled = !codexFastModeEnabled
    setAgentSessions((prev) => prev.map((item) => (
      item.id === sessionId ? { ...item, codexFastMode: nextEnabled, updatedAt: Date.now() } : item
    )))

    try {
      const updated = await window.electronAPI.updateSessionCodexFastMode(sessionId, nextEnabled)
      setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? updated : item))
    } catch (error) {
      console.error('[AgentView] 切换 Codex Fast Mode 失败:', error)
      setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? previousSessionMeta : item))
      toast.error('快速模式切换失败', { description: getErrorMessage(error) })
    }
  }, [backgroundWaiting, codexFastModeEnabled, isCodexFastModeAvailable, sessionId, sessionMeta, setAgentSessions, streaming])

  const updateReasoningLevel = React.useCallback(async (thinkingLevel: AgentThinkingLevel): Promise<void> => {
    if (!isSessionThinkingAvailable || !sessionMeta) return

    const reasoningLevelSwitchDeferred = streaming || backgroundWaiting
    const previousSessionMeta = sessionMeta
    setAgentSessions((prev) => prev.map((item) => (
      item.id === sessionId ? { ...item, reasoningLevel: thinkingLevel, updatedAt: Date.now() } : item
    )))

    try {
      const updated = await window.electronAPI.updateSessionReasoningLevel(sessionId, thinkingLevel)
      setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? updated : item))

      try {
        await window.electronAPI.updateSettings({ defaultOpenAIThinkingLevel: thinkingLevel })
      } catch (error) {
        console.error('[AgentView] 保存 OpenAI 默认思考深度失败:', error)
        toast.error('默认思考深度保存失败', { description: getErrorMessage(error) })
      }
      if (reasoningLevelSwitchDeferred) {
        toast.info('思考强度已切换，本轮结束后生效', { id: `agent-reasoning-level-deferred-${sessionId}` })
      }
    } catch (error) {
      console.error('[AgentView] 更新 OpenAI 思考深度失败:', error)
      setAgentSessions((prev) => prev.map((item) => item.id === sessionId ? previousSessionMeta : item))
      toast.error('思考深度切换失败', { description: getErrorMessage(error) })
    }
  }, [backgroundWaiting, isSessionThinkingAvailable, sessionId, sessionMeta, setAgentSessions, streaming])

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
  const handleSend = React.useCallback(async (overrideText?: string, fromEditor = false): Promise<void> => {
    const currentDraft = store.get(agentSessionDraftsAtom).get(sessionId) ?? ''
    const text = (overrideText ?? currentDraft).trim()
    // 如果输入为空但有建议，使用建议内容
    const effectiveText = text || suggestion || ''
    const pendingFilesSnapshot = pendingFilesRef.current
    if (!messagesLoaded || (!effectiveText && pendingFilesSnapshot.length === 0) || !agentChannelId || !hasAvailableModel) return
    if (isStopping) {
      toast.info('正在停止上一轮 Agent', { description: '请等待停止完成后再发送消息。' })
      return
    }
    if (isLegacyTranscript) {
      toast.info('这是只读历史会话，请新建 Pi 会话继续')
      return
    }
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
      const message = createAgentQueuedMessage(effectiveText, crypto.randomUUID(), Date.now(), quotedSelection, attachmentContext
        ? {
            fileReferenceBlock: attachmentContext.referenceBlock,
            attachments: attachmentContext.attachments,
            additionalDirectories: attachmentContext.additionalDirectories,
          }
        : undefined)
      const quotedSelectionBlock = quotedSelection
        ? buildQuotedSelectionBlock(quotedSelection)
        : ''
      const payload = buildQueuedMessageSendPayload(message, quotedSelectionBlock)
      const queuedInput: AgentDeferredQueueMessageInput & { dispatch: 'after_current' } = {
        queueMessageId: message.id,
        sessionId,
        userMessage: payload.sdkText,
        rawUserMessage: payload.rawText,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        workspaceId: currentWorkspaceId || undefined,
        additionalDirectories: message.additionalDirectories,
        permissionModeOverride: permissionMode,
        dispatch: 'after_current',
        mentionedSkills: payload.mentions.mentionedSkills,
        mentionedMcpServers: payload.mentions.mentionedMcpServers,
        mentionedSessionIds: payload.mentions.mentionedSessionIds,
        mentionedTodoIds: payload.mentions.mentionedTodoIds,
        mentionedCalendarEventIds: payload.mentions.mentionedCalendarEventIds,
      }
      setQueuedMessages((prev) => [...prev, message])
      void window.electronAPI.submitOrEnqueueAgentMessage(queuedInput).catch((error) => {
        console.error('[AgentView] 主进程消息提交失败:', error)
        setQueuedMessages((prev) => removeQueuedMessage(prev, message.id))
        restoreQueuedAttachmentsToPending(message.attachments)
        if (quotedSelection) {
          setQuotedSelectionMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, quotedSelection)
            return map
          })
        }
        toast.error('消息加入队列失败', { description: String(error) })
      })
      // 入队后消息会出现在队列 UI 中，用户可见；不再弹 toast 打扰。
      if (overrideText === undefined || fromEditor) {
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
      if (overrideText === undefined || fromEditor) {
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
    const finalMessage = fileReferences + expandAgentHistoryQuoteMentions(effectiveText)
    const mentions = parseQueuedMessageMentions(effectiveText)
    // Agent 侧使用解码后的 SDK 文本（@file 路径还原为真实路径，Agent 可读取）；
    // 历史 quote marker 仅在此刻展开为精确上下文，草稿本身始终保持可编辑 chip。
    const sdkMessage = fileReferences + expandAgentHistoryQuoteMentions(mentions.cleanedText)

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
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
        inputTokens: existing?.inputTokens,
        contextWindow: resolveRunContextWindow(agentModelId || undefined, existing?.contextWindow),
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
      userMessage: sdkMessage,
      rawUserMessage: finalMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      permissionModeOverride: permissionMode,
      ...(additionalDirectoriesForRun.size > 0 && { additionalDirectories: Array.from(additionalDirectoriesForRun) }),
      ...(mentions.mentionedSkills.length > 0 && { mentionedSkills: mentions.mentionedSkills }),
      ...(mentions.mentionedMcpServers.length > 0 && { mentionedMcpServers: mentions.mentionedMcpServers }),
      ...(mentions.mentionedSessionIds.length > 0 && { mentionedSessionIds: mentions.mentionedSessionIds }),
      ...(mentions.mentionedTodoIds.length > 0 && { mentionedTodoIds: mentions.mentionedTodoIds }),
      ...(mentions.mentionedCalendarEventIds.length > 0 && { mentionedCalendarEventIds: mentions.mentionedCalendarEventIds }),
    }

    // 清空输入框（仅当发送的是用户自己输入的内容，而非推荐建议时）。
    // Enter 路径会显式传入已刷新的编辑器内容，因此也应清空。
    if (overrideText === undefined || fromEditor) {
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
  }, [createBaseAdditionalDirectories, preparePendingFilesForSend, restoreQueuedAttachmentsToPending, sessionId, agentChannelId, agentModelId, agentChannelProvider, currentWorkspaceId, streaming, backgroundWaiting, suggestion, hasAvailableModel, store, consumeQuotedSelection, setStreamingStates, setAgentStreamErrors, setPromptSuggestions, setInputContent, setLiveMessagesMap, permissionMode, messagesLoaded, setQueuedMessages, setQuotedSelectionMap, sendPlainTextAgentMessage, isLegacyTranscript, isStopping])

  /** 停止生成。异常流未发出终态时，允许再次下发幂等的 abort 请求。 */
  const handleStop = React.useCallback((): void => {
    if (!isStopping) {
      setIsStopping(true)
      store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
        const next = new Set(prev)
        next.add(sessionId)
        return next
      })
    }

    // 保持 running 到 STREAM_COMPLETE 到达。提前把它切成 false 会让输入框误以为
    // 已经可以开启新 run，而底层 query 尚未退出，形成重复保存的竞态。
    window.electronAPI.stopAgent(sessionId).catch((error) => {
      console.error(error)
      setIsStopping(false)
    })
  }, [isStopping, sessionId, store])

  React.useEffect(() => {
    if (!streaming) setIsStopping(false)
  }, [streaming])

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
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      }
      map.set(sessionId, {
        ...current,
        running: true,
        startedAt: streamStartedAt,
        isCompacting: true,
        compactInFlight: true,
        contextCompaction: { status: 'running' },
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      userMessage: '/compact',
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
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
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setStreamingStates, store, permissionMode])

  /** 复制错误信息到剪贴板 */
  const handleCopyError = React.useCallback(async (): Promise<void> => {
    if (!agentError) return

    try {
      await copyTextToClipboard(agentError)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    } catch (error) {
      console.error('[AgentView] 复制错误信息失败:', error)
    }
  }, [agentError])

  const handleRelinkProjectRoot = React.useCallback(async (): Promise<void> => {
    if (!currentWorkspaceId) return
    try {
      const folder = await window.electronAPI.openFolderDialog()
      if (!folder) return
      const updated = await window.electronAPI.relinkAgentWorkspaceProjectRoot(currentWorkspaceId, folder.path)
      setWorkspaces((prev) => prev.map((workspace) => (workspace.id === updated.id ? updated : workspace)))
      toast.success('本地项目根已重新关联', { description: folder.path })
    } catch (error) {
      console.error('[AgentView] 重新关联本地项目根失败:', error)
      toast.error(error instanceof Error ? error.message : '重新关联项目文件夹失败')
    }
  }, [currentWorkspaceId, setWorkspaces])

  const handleRestoreProjectRoot = React.useCallback(async (): Promise<void> => {
    if (!currentWorkspaceId) return
    try {
      setRestoringProjectRoot(true)
      const updated = await window.electronAPI.restoreAgentWorkspaceProjectRoot(currentWorkspaceId)
      setWorkspaces((prev) => prev.map((workspace) => (workspace.id === updated.id ? updated : workspace)))
      toast.success('已在原路径新建空项目文件夹', { description: updated.projectRootPath })
      setRestoreProjectRootDialogOpen(false)
    } catch (error) {
      console.error('[AgentView] 恢复本地项目根失败:', error)
      toast.error(error instanceof Error ? error.message : '恢复项目文件夹失败')
    } finally {
      setRestoringProjectRoot(false)
    }
  }, [currentWorkspaceId, setWorkspaces])

  /** 重试：在当前会话中重新发送最后一条用户消息 */
  const handleRetry = React.useCallback((retryOfErrorUuid?: string): void => {
    if (!agentChannelId || streaming) return

    // 找到最后一条用户消息
    const lastUserRawMessage = [...persistedSDKMessages]
      .reverse()
      .map(getUserTextFromSDKMessage)
      .find((text): text is string => text !== null)
    if (!lastUserRawMessage) return
    // 重试重发给 Agent 的消息：@file 路径还原为真实路径（持久化存的是编码原文）
    const lastUserMessage = parseQueuedMessageMentions(lastUserRawMessage).cleanedText

    // 与主进程按 UUID 的原子删除同步更新当前 React 状态和 LRU cache，避免旧错误
    // 在下一轮回复开始前仍被页面渲染。旧会话没有 UUID 时保留历史，由主进程幂等处理。
    const messagesAfterCleanup = removeRetriedErrorSDKMessage(persistedSDKMessages, retryOfErrorUuid)
    if (messagesAfterCleanup !== persistedSDKMessages) {
      messagesMutationVersionRef.current += 1
      persistedSDKMessagesRef.current = messagesAfterCleanup
      setPersistedSDKMessages(messagesAfterCleanup)
      setMessagesCache((prev) => setSessionMessagesCache(prev, sessionId, messagesAfterCleanup))
    }

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
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
        inputTokens: existing?.inputTokens,
        contextWindow: resolveRunContextWindow(agentModelId || undefined, existing?.contextWindow),
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      // Agent 侧使用解码后的文本（@file 真实路径）；持久化/展示保留编码原文，避免新历史记录被 \S+ 截断
      userMessage: lastUserMessage,
      rawUserMessage: lastUserRawMessage,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      permissionModeOverride: permissionMode,
      ...(retryOfErrorUuid && { retryOfErrorUuid }),
    }).catch(console.error)
  }, [persistedSDKMessages, sessionId, agentChannelId, agentModelId, agentChannelProvider, currentWorkspaceId, streaming, setAgentStreamErrors, setStreamingStates, setMessagesCache, permissionMode])

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
        workspaceId: currentWorkspaceId || undefined,
        mentionedSessionIds: [sessionId],
        startedAt: streamStartedAt,
        permissionModeOverride: permissionMode,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, openSession, setAgentSessions, setStreamingStates, permissionMode])

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

  // 监听文件面板三点菜单「引用到 Agent」事件：在输入框插入 @file 引用
  React.useEffect(() => {
    const handler = (event: Event): void => {
      const items = (event as CustomEvent<FilePanelDragItem[]>).detail
      if (!items || items.length === 0) return
      richTextInputRef.current?.insertFileMentions(items)
    }
    window.addEventListener(INSERT_FILE_MENTION_EVENT, handler)
    return () => window.removeEventListener(INSERT_FILE_MENTION_EVENT, handler)
  }, [])

  const allAskUserRequests = useAtomValue(allPendingAskUserRequestsAtom)
  const allPermissionRequests = useAtomValue(allPendingPermissionRequestsAtom)
  const allExitPlanRequests = useAtomValue(allPendingExitPlanRequestsAtom)
  const hasBannerOverlay =
    (allAskUserRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allExitPlanRequests.get(sessionId)?.length ?? 0) > 0
  const hasBlockingRequests = hasBannerOverlay || (allPermissionRequests.get(sessionId)?.length ?? 0) > 0
  const canSendQueuedNow = messagesLoaded && (streaming || !messagesRefreshing) && !!agentChannelId && hasAvailableModel && !hasBlockingRequests && !isStopping
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
    void window.electronAPI.cancelAgentQueuedMessage({ sessionId, messageId })
      .then((cancelled) => {
        if (!cancelled) {
          toast.info('消息已开始发送，无法再立即发送')
          return
        }
        setQueuedMessages((prev) => removeQueuedMessage(prev, messageId))
        return sendPlainTextAgentMessage(message).catch((error) => {
          console.error('[AgentView] 队列消息发送失败:', error)
          toast.error('队列消息发送失败', { description: String(error) })
          setQueuedMessages((prev) => restoreQueuedMessageToFront(prev, message))
        })
      })
      .catch((error) => {
        console.error('[AgentView] 取消主进程队列失败:', error)
        toast.error('队列消息操作失败', { description: String(error) })
      })
      .finally(() => {
        sendingQueuedMessageIdsRef.current.delete(messageId)
        queuedSendInFlightRef.current = false
      })
  }, [canSendQueuedNow, queuedMessages, sendPlainTextAgentMessage, setQueuedMessages, streaming])

  const handleRecallQueuedMessage = React.useCallback((messageId: string): void => {
    const message = queuedMessages.find((item) => item.id === messageId)
    if (!message) return

    void window.electronAPI.cancelAgentQueuedMessage({ sessionId, messageId })
      .then((cancelled) => {
        if (!cancelled) {
          toast.info('消息已开始发送，无法撤回')
          return
        }
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

        const currentDraft = store.get(agentSessionDraftsAtom).get(sessionId) ?? ''
        const currentDraftHtml = store.get(agentSessionDraftHtmlAtom).get(sessionId) ?? ''
        const hasDraft = currentDraft.trim().length > 0
        const nextDraft = hasDraft
          ? `${currentDraft.trimEnd()}\n\n${message.text}`
          : message.text
        setInputContent(nextDraft)

        // 已有草稿时，用「原草稿 HTML + 队列文本段落 HTML」合并，保留原草稿的 mention 等富文本节点；
        // 空草稿时留空 HTML，交给编辑器按纯文本重建（与正常输入渲染一致）。
        if (hasDraft) {
          const draftHtml = currentDraftHtml.trim().length > 0
            ? currentDraftHtml
            : queuedTextToParagraphHtml(currentDraft)
          setInputHtmlContent(`${draftHtml}${queuedTextToParagraphHtml(message.text)}`)
        } else {
          setInputHtmlContent('')
        }
      })
      .catch((error) => {
        console.warn('[AgentView] 撤回主进程队列消息失败:', error)
      })
  }, [queuedMessages, restoreQueuedAttachmentsToPending, sessionId, setInputContent, setInputHtmlContent, setQueuedMessages, setQuotedSelectionMap, store])

  const handleRemoveQueuedMessage = React.useCallback((messageId: string): void => {
    void window.electronAPI.cancelAgentQueuedMessage({ sessionId, messageId })
      .then((cancelled) => {
        if (cancelled) {
          setQueuedMessages((prev) => removeQueuedMessage(prev, messageId))
          return
        }
        toast.info('消息已开始发送，无法删除')
      })
      .catch((error) => {
        console.warn('[AgentView] 取消主进程队列失败:', error)
        toast.error('删除队列消息失败', { description: String(error) })
      })
  }, [sessionId, setQueuedMessages])

  const handleMoveQueuedMessage = React.useCallback((
    sourceId: string,
    targetId: string,
    placement: QueueDropPlacement,
  ): void => {
    void window.electronAPI.moveAgentQueuedMessage({ sessionId, sourceId, targetId, placement }).catch((error) => {
      console.warn('[AgentView] 调整主进程队列顺序失败:', error)
    })
    setQueuedMessages((prev) => moveQueuedMessage(prev, sourceId, targetId, placement))
  }, [sessionId, setQueuedMessages])

  // ===== 预览 Tab 快捷键 =====
  const setPreviewOpenMap = useSetAtom(previewPanelOpenMapAtom)
  const setSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)

  const togglePreviewPanel = React.useCallback(() => {
    const nextOpen = !(store.get(previewPanelOpenMapAtom).get(sessionId) ?? false)
    const currentPreviewFile = store.get(previewFileMapAtom).get(sessionId) ?? null
    if (nextOpen && currentPreviewFile) {
      // 统一交给 opener：会复用/激活对应的动态预览 Tab，而非写入旧的 `preview` 状态。
      openPreview(sessionId, currentPreviewFile)
      return
    }
    setPreviewOpenMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, false)
      return next
    })
    setSidePanelTabMap((tabs) => {
      const nextTabs = new Map(tabs)
      nextTabs.set(sessionId, 'files')
      return nextTabs
    })
  }, [openPreview, sessionId, setPreviewOpenMap, setSidePanelTabMap, store])

  React.useEffect(() => {
    return registerShortcut('toggle-preview-panel', togglePreviewPanel)
  }, [togglePreviewPanel])

  const [inputHasContent, setInputHasContent] = React.useState(
    () => (store.get(agentSessionDraftsAtom).get(sessionId) ?? '').trim().length > 0,
  )
  const inputHasContentRef = React.useRef(inputHasContent)
  inputHasContentRef.current = inputHasContent
  const handleInputActivity = React.useCallback((hasContent: boolean): void => {
    if (inputHasContentRef.current === hasContent) return
    inputHasContentRef.current = hasContent
    setInputHasContent(hasContent)
  }, [])
  const hasTextInput = inputHasContent
  const canSend = !isStopping && messagesLoaded && (streaming || !messagesRefreshing) && (hasTextInput || pendingFiles.length > 0 || !!suggestion) && agentChannelId !== null && hasAvailableModel && (!streaming || hasTextInput)

  const inputToolbarItems = React.useMemo<ToolbarItem[]>(() => [
    ...(isCodexFastModeAvailable ? [{
      key: 'codex-fast-mode',
      node: (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-8 min-w-10 rounded-md px-2 text-xs font-medium text-foreground/60 transition-transform hover:bg-muted/50 hover:text-foreground active:scale-[0.96]"
              onClick={handleCodexFastModeChange}
              disabled={streaming || backgroundWaiting}
              aria-pressed={codexFastModeEnabled}
            >
              {codexFastModeEnabled ? '快速' : '标准'}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{codexFastModeEnabled ? '已启用快速模式：优先响应，消耗更多额度' : '开启快速模式：优先响应，消耗更多额度'}</p>
          </TooltipContent>
        </Tooltip>
      ),
    }] : []),
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
          codexConfig={isSessionThinkingAvailable ? {
            thinkingLevel: openAIThinkingLevel,
            levels: openAIThinkingLevels,
            onThinkingLevelChange: (level) => { void updateReasoningLevel(level) },
          } : undefined}
        />
      ),
    },
    { key: 'speech', node: <SpeechButton className={inputToolbarButtonClass} voiceInputId={agentVoiceInputId} /> },
    {
      key: 'attach-content',
      node: (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={inputToolbarButtonClass}
              onClick={() => void handleAttachContent()}
              aria-label="附加文件或文件夹"
            >
              <Paperclip className="size-[17px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top"><p>附加文件或文件夹</p></TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: 'context-usage',
      node: (
        <ContextUsageBadge
          isProcessing={streaming}
          sessionId={sessionId}
          channelId={planQuotaChannelId}
          channelUpdatedAt={planQuotaChannelUpdatedAt}
          onCompact={handleCompact}
        />
      ),
    },
  ], [
    planQuotaChannelId,
    planQuotaChannelUpdatedAt,
    isCodexFastModeAvailable,
    codexFastModeEnabled,
    handleCodexFastModeChange,
    isSessionThinkingAvailable,
    openAIThinkingLevel,
    openAIThinkingLevels,
    updateReasoningLevel,
    backgroundWaiting,
    sessionId,
    agentThinking,
    setAgentThinking,
    streaming,
    handleAttachContent,
    handleCompact,
    agentVoiceInputId,
  ])

  const stopControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={inputToolbarDangerButtonClass}
          onClick={handleStop}
          aria-label={isStopping ? '再次停止 Agent' : '停止 Agent'}
        >
          <Square className="size-[16px]" fill="currentColor" strokeWidth={0} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{isStopping ? '停止未确认，再次发送中断请求' : `停止 Agent (${getAcceleratorDisplay(getActiveAccelerator('stop-generation'))})`}</p>
      </TooltipContent>
    </Tooltip>
  )

  const sendButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        canSend ? inputToolbarSendButtonClass : inputToolbarDisabledButtonClass
      )}
      onClick={() => {
        const latestContent = richTextInputRef.current?.getMarkdown()
        void handleSend(latestContent, true)
      }}
      disabled={!canSend}
    >
      <CornerDownLeft className="size-[22px]" />
    </Button>
  )

  const sendControl = streaming ? (
    <>
      {hasTextInput && sendButton}
      {stopControl}
    </>
  ) : sendButton

  const inputTrailingNode = (
    <>
      <div className="flex min-w-0 items-center gap-1 [&_.model-selector-trigger>span]:max-w-[min(18rem,42vw)]">
        <ModelSelector
          externalSelectedModel={externalSelectedModel}
          onModelSelect={handleModelSelect}
          showChannelInTrigger
          useSharedOpenState
        />
      </div>
      {sendControl}
    </>
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
      <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden">
        {/* 头部保持全宽，宽屏时让标题与右侧工作区开关贴近主区域两端；历史和输入仍限制可读宽度。 */}
        <AgentHeader sessionId={sessionId} />

        <div className="flex min-h-0 flex-1 w-full max-w-[min(72rem,100%)] flex-col overflow-hidden mx-auto">
        {/* 消息区域 */}
        <AgentMessages
          sessionId={sessionId}
          sessionModelId={agentModelId || undefined}
          messagesLoaded={messagesLoaded}
          persistedSDKMessages={persistedSDKMessages}
          sessionPath={sessionPath}
          attachedDirs={allAttachedDirs}
          stoppedByUser={stoppedByUser}
          onRetry={handleRetry}
          onRetryInNewSession={handleRetryInNewSession}
          onRelinkProjectRoot={handleRelinkProjectRoot}
          onRestoreProjectRoot={handleOpenRestoreProjectRootDialog}
          onFork={isLegacyTranscript ? undefined : handleFork}
          onRewind={isLegacyTranscript ? undefined : handleRewindRequest}
          onCreateTodo={handleOpenReplyTodoDialog}
          onCompact={handleCompact}
          onAddHistoryQuote={handleAddHistoryQuote}
          onAgentHistoryQuoteClick={handleAgentHistoryQuoteClick}
          historyQuoteNavigation={historyQuoteNavigation}
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
            {isLegacyTranscript && (
              <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
                <span>这是已退役 Claude runtime 的只读历史会话；原对话可查看，但不能继续、分叉或回退。</span>
                <Button size="sm" variant="outline" onClick={() => void handleRetryInNewSession()} disabled={!agentChannelId}>
                  以 Pi 新会话继续
                </Button>
              </div>
            )}

            {/* 尚未选择模型或暂无可用模型时的引导 */}
            {(!agentChannelId || !hasAvailableModel) && (
              <div className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                <Settings size={14} />
                <span>{!hasAvailableModel ? '暂无可用模型，请在设置中添加或启用渠道和模型' : '请选择模型以开始 Agent 对话'}</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                  onClick={() => !hasAvailableModel ? setSettingsOpen(true) : setModelSelectorOpen(true)}
                >
                  {!hasAvailableModel ? '前往设置' : '选择模型'}
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
              interruptsCurrentTurn={streaming}
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

            <AgentScopedRichTextInput
              ref={richTextInputRef}
              sessionId={sessionId}
              onInputActivity={handleInputActivity}
              draftSyncDelayMs={300}
              onSubmit={handleSend}
              onPasteFiles={handlePasteFiles}
              onPasteLongText={handlePasteLongText}
              voiceInputId={agentVoiceInputId}
              longTextPasteThreshold={longTextPasteAsAttachmentEnabled ? LONG_TEXT_ATTACHMENT_THRESHOLD : undefined}
              placeholder={
                agentChannelId && hasAvailableModel
                  ? sendWithCmdEnter
                    ? '输入消息...（@ 引用文件，/ 调用 Skill，# 使用 MCP，& 引用会话，～ 引用待办/日程；⌘/Ctrl+Enter 发送）'
                    : '输入消息...（@ 引用文件，/ 调用 Skill，# 使用 MCP，& 引用会话，～ 引用待办/日程；Enter 发送）'
                  : !agentChannelId
                    ? '请先选择模型'
                    : '暂无可用模型，请先在设置中启用渠道'
              }
              disabled={isLegacyTranscript || !agentChannelId || !hasAvailableModel}
              autoFocusTrigger={sessionId}
              collapsible
              enableMentions
              workspacePath={sessionPath}
              workspaceSlug={workspaceSlug}
              attachedDirs={workspaceMentionPaths}
              sessionAttachedDirs={sessionMentionPaths}
              sendWithCmdEnter={sendWithCmdEnter}
              onAgentHistoryQuoteClick={handleAgentHistoryQuoteClick}
            />

            {/* Footer 工具栏 — 容器变窄时尾部按钮自动折叠进「更多」Popover */}
            <InputToolbarOverflow items={inputToolbarItems} trailing={inputTrailingNode} />
          </div>
        </div>
        )}
        </div>
      </div>

    <Dialog open={todoDialogOpen} onOpenChange={setTodoDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>标记为 Todo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <label className="grid gap-2 text-sm font-medium">任务标题
            <textarea value={todoDraftTitle} onChange={(event) => setTodoDraftTitle(event.target.value)} rows={3} className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
          </label>
          <label className="grid gap-2 text-sm font-medium">Todo 分组
            <Select value={todoGroupId} onValueChange={setTodoGroupId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不分组</SelectItem>{planningGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select>
          </label>
        </div>
        <DialogFooter><Button type="button" variant="ghost" onClick={() => setTodoDialogOpen(false)}>取消</Button><Button type="button" onClick={() => void handleCreateReplyTodo()} disabled={creatingTodo || !todoDraftTitle.trim()}><ListTodo size={15} />添加 Todo</Button></DialogFooter>
      </DialogContent>
    </Dialog>

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

    <AlertDialog open={restoreProjectRootDialogOpen} onOpenChange={setRestoreProjectRootDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>在原路径新建空文件夹？</AlertDialogTitle>
          <AlertDialogDescription>
            将在该本地项目原路径创建空文件夹。此操作不会恢复被删除的文件。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoringProjectRoot}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={restoringProjectRoot} onClick={() => void handleRestoreProjectRoot()}>
            {restoringProjectRoot ? '创建中...' : '新建空文件夹'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
