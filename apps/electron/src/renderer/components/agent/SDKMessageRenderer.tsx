/**
 * SDKMessageRenderer — 渲染 SDKMessage 对象
 *
 * 支持两种渲染模式：
 * 1. 单条消息：SDKMessageRenderer（用于实时流式消息）
 * 2. Turn 分组：AssistantTurnRenderer（用于持久化消息，一个 turn 一个 header）
 *
 * Turn 分组规则：
 * - 用户消息后到下一条用户消息之间的所有 assistant 消息组成一个 turn
 * - user(tool_result) 消息属于当前 turn（不中断分组）
 * - system 消息独立渲染
 */

import * as React from 'react'
import { Bot, Loader2, AlertTriangle, FileText, FileImage, Download, Split, Undo2, RotateCw, Plus, Minimize2, Wrench, Settings, Cpu, ExternalLink, Quote, Clock } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { ContentBlock } from './ContentBlock'
import { TaskProgressCard } from './TaskProgressCard'
import { TurnFileChangesSummary } from './TurnFileChangesSummary'
import { ProcessBlockGroup, buildAssistantTurnRenderItems, buildCompletedToolResultIds } from './ProcessBlockGroup'
import { extractToolResultText, parseTaskCreateResult, TASK_TOOL_NAMES } from './task-progress'
import { normalizeThinkTagsInContentBlocks } from './thinking-tag-parser'
// 会话转录的纯逻辑(Turn 分组 / 快照去重 / 预览)已下沉到 @proma/session-core 作为唯一真源。
// 这里 import 供本文件内部使用，并 re-export 以保持既有 `from './SDKMessageRenderer'` 导入方零改动。
import {
  groupIntoTurns,
  getGroupPreview,
  extractUserText,
  extractMeta,
  isUserInputMessage,
  stripScheduledRunMarker,
  type MessageGroup,
  type AssistantTurn,
} from '@proma/session-core'
export { groupIntoTurns, getGroupPreview, extractUserText } from '@proma/session-core'
export type { MessageGroup, AssistantTurn } from '@proma/session-core'
import { DurationBadge } from './AgentMessages'
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
  UserMessageContent,
} from '@/components/ai-elements/message'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { CopyButton } from '@/components/chat/CopyButton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { getModelLogo, resolveModelDisplayName, resolveModelProvider } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import { channelsAtom, modelSelectorOpenAtom } from '@/atoms/chat-atoms'
import { agentProcessGroupsKeepExpandedAtom, agentSessionPendingFilesAtom } from '@/atoms/agent-atoms'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import { automationsAtom, automationFormAtom, automationToDraft } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { environmentCheckDialogOpenAtom } from '@/atoms/environment'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { getFileParentPath } from '@/lib/file-utils'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKContentBlock,
  SDKResultMessage,
  AgentEventUsage,
  SDKToolUseBlock,
  SDKToolResultBlock,
  RecoveryAction,
} from '@proma/shared'
import type { AgentPendingFile } from '@proma/shared'
import {
  getSDKCompactStatus,
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_TITLE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  isThinkingSignatureError,
} from '@proma/shared'
import type { ToolActivity } from '@/atoms/agent-atoms'

// ===== SDKMessageRenderer Props =====

export interface SDKMessageRendererProps {
  /** 要渲染的消息 */
  message: SDKMessage
  /** 所有消息（用于 ContentBlock 内查找工具结果） */
  allMessages: SDKMessage[]
  /** 相对路径解析基准 */
  basePath?: string
  /** 是否显示消息头部（模型 icon + 名称），默认 true */
  showHeader?: boolean
  /** 用户在前端选择的模型 ID（优先用于显示名称） */
  sessionModelId?: string
}

// ===== system 消息：上下文压缩分割线 =====

function CompactBoundaryDivider(): React.ReactElement {
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 text-[11px] text-muted-foreground/60 px-2 py-0.5 rounded-full border border-border/30 bg-muted/20">
        上下文已压缩
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

function formatSystemToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

function PermissionDeniedNotice({ message }: { message: SDKSystemMessage }): React.ReactElement {
  const toolName = typeof message.tool_name === 'string' ? formatSystemToolName(message.tool_name) : undefined
  const denialMessage = typeof message.message === 'string' ? message.message : undefined
  const reason = typeof message.decision_reason === 'string' ? message.decision_reason : undefined

  return (
    <div className="my-3 pl-[46px] pr-1">
      <div className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-foreground/80">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">权限检查已拒绝操作</span>
            {toolName && (
              <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {toolName}
              </span>
            )}
          </div>
          {denialMessage && (
            <p className="break-words text-muted-foreground">{denialMessage}</p>
          )}
          {reason && reason !== denialMessage && (
            <p className="break-words text-muted-foreground/70">{reason}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== system 消息：正在压缩指示器（与 CompactBoundaryDivider 同款横线样式，pill 内带 spinner） =====

export function CompactingIndicator(): React.ReactElement {
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70 px-2 py-0.5 rounded-full border border-border/30 bg-muted/20">
        <Loader2 className="size-3 animate-spin" />
        正在压缩...
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

function CompactStatusNotice({ message, active = false }: { message: SDKSystemMessage; active?: boolean }): React.ReactElement | null {
  const compactStatus = getSDKCompactStatus(message)
  if (compactStatus === 'success') return <CompactBoundaryDivider />
  if (compactStatus === 'compacting') {
    if (active) return <CompactingIndicator />
    return (
      <div className="flex items-center gap-3 my-4 px-1">
        <div className="flex-1 h-px bg-border/40" />
        <span className="shrink-0 text-[11px] text-muted-foreground/60 px-2 py-0.5 rounded-full border border-border/30 bg-muted/20">
          开始压缩上下文
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
    )
  }
  if (compactStatus === 'failed') {
    const error = typeof message.compact_error === 'string' ? message.compact_error : undefined
    return (
      <div className="my-3 pl-[46px] pr-1">
        <div className="flex items-start gap-2.5 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-foreground/80">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-1">
            <div className="font-medium text-foreground">上下文压缩失败</div>
            {error && <p className="break-words text-muted-foreground">{error}</p>}
          </div>
        </div>
      </div>
    )
  }
  return null
}

// extractMeta / MessageMeta 已迁移至 @proma/session-core

/** 从 turn 消息列表中提取 result 消息的耗时和用量数据 */
function extractTurnUsage(turnMessages: SDKMessage[]): { durationMs?: number; usage?: AgentEventUsage } {
  for (const msg of turnMessages) {
    if (msg.type !== 'result') continue
    const resultMsg = msg as SDKResultMessage
    const raw = msg as Record<string, unknown>
    const durationMs = typeof raw._durationMs === 'number' ? raw._durationMs : undefined
    const u = resultMsg.usage
    if (!u) return { durationMs }
    // 多 entry 场景（Task 子 Agent 等）：取最大 contextWindow
    let contextWindow: number | undefined
    if (resultMsg.modelUsage) {
      for (const info of Object.values(resultMsg.modelUsage)) {
        if (info?.contextWindow && (contextWindow === undefined || info.contextWindow > contextWindow)) {
          contextWindow = info.contextWindow
        }
      }
    }
    return {
      durationMs,
      usage: {
        inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens,
        costUsd: resultMsg.total_cost_usd,
        contextWindow,
      },
    }
  }
  return {}
}

// extractUserText 已迁移至 @proma/session-core

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractStructuredToolResultText(message: SDKUserMessage): string | undefined {
  const raw = message as unknown as Record<string, unknown>
  const result = raw.toolUseResult ?? raw.tool_use_result
  if (!isRecord(result)) return undefined
  try {
    return JSON.stringify(result)
  } catch {
    return undefined
  }
}

function extractToolResultForTask(message: SDKUserMessage, resultBlock: SDKToolResultBlock): string | undefined {
  return extractStructuredToolResultText(message) ?? extractToolResultText(resultBlock.content)
}

// isUserInputMessage 已迁移至 @proma/session-core

// ===== 助手头像 =====

function AssistantLogo({ model }: { model?: string }): React.ReactElement {
  const channels = useAtomValue(channelsAtom)
  if (model) {
    return (
      <img
        src={getModelLogo(model, resolveModelProvider(model, channels))}
        alt={model}
        className="size-[35px] rounded-[25%] object-cover"
      />
    )
  }
  return (
    <div className="size-[35px] rounded-[25%] bg-primary/10 flex items-center justify-center">
      <Bot size={18} className="text-primary" />
    </div>
  )
}

// AssistantTurn / MessageGroup 类型已迁移至 @proma/session-core

// groupIntoTurns / mergeAdjacentSameModelTurns 已迁移至 @proma/session-core

function buildTaskProgressData(
  topLevelBlocks: SDKContentBlock[],
  turnMessages: SDKMessage[],
): {
  taskActivities: ToolActivity[]
  firstTaskIndex: number
} {
  const taskBlocks: SDKToolUseBlock[] = []
  let firstTaskIndex = -1

  for (let i = 0; i < topLevelBlocks.length; i++) {
    const block = topLevelBlocks[i]!
    if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
      if (firstTaskIndex === -1) firstTaskIndex = i
      taskBlocks.push(block as SDKToolUseBlock)
    }
  }

  const toolResultMap = new Map<string, string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const blocks = userMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const rb = b as SDKToolResultBlock
        const text = extractToolResultForTask(userMsg, rb)
        if (text) toolResultMap.set(rb.tool_use_id, text)
      }
    }
  }

  const taskActivities: ToolActivity[] = taskBlocks.map((tb) => ({
    toolUseId: tb.id,
    toolName: tb.name,
    input: tb.input as Record<string, unknown>,
    result: toolResultMap.get(tb.id),
    done: true,
  }))

  return { taskActivities, firstTaskIndex }
}

/**
 * 扫描全部消息，构建跨 turn 的「历史 TaskCreate id → subject」映射。
 *
 * 早期把这部分逻辑放在 buildTaskProgressData 里，每个 AssistantTurnRenderer 渲染都要
 * 跑一次 → O(T × M)；流式期间 allMessages 引用每帧变化，useMemo 缓存失效，长会话
 * 雪崩。提升到 AgentMessages 顶层后只算一次，O(M)。
 */
export function buildHistoricalTaskSubjects(allMessages: SDKMessage[]): Map<string, string> {
  const historicalTaskSubjects = new Map<string, string>()
  const globalResultMap = new Map<string, string>()
  const pendingTaskCreates: SDKToolUseBlock[] = []

  for (const msg of allMessages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      const blocks = userMsg.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const rb = b as SDKToolResultBlock
          const text = extractToolResultForTask(userMsg, rb)
          if (text) globalResultMap.set(rb.tool_use_id, text)
        }
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      const blocks = aMsg.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'tool_use' && (b as SDKToolUseBlock).name === 'TaskCreate') {
          pendingTaskCreates.push(b as SDKToolUseBlock)
        }
      }
    }
  }

  for (const tb of pendingTaskCreates) {
    const input = tb.input as Record<string, unknown>
    const subject = typeof input.subject === 'string'
      ? input.subject
      : typeof input.description === 'string'
        ? input.description
        : undefined
    if (!subject) continue
    const resultText = globalResultMap.get(tb.id)
    const parsedResult = parseTaskCreateResult(resultText)
    if (parsedResult?.id) historicalTaskSubjects.set(parsedResult.id, parsedResult.subject ?? subject)
  }

  return historicalTaskSubjects
}

// ===== AssistantTurnRenderer — 渲染一个完整的 assistant turn =====

export interface AssistantTurnRendererProps {
  turn: AssistantTurn
  /** 所有消息（全局，供工具结果查找跨 turn 的结果） */
  allMessages: SDKMessage[]
  /** 跨 turn 历史 TaskCreate id → subject 映射（由父组件 useMemo 算一次后传入） */
  historicalTaskSubjects: Map<string, string>
  basePath?: string
  /** 分叉回调（传入最后一条 assistant 消息的 uuid） */
  onFork?: (upToMessageUuid: string) => void
  /** 回退回调（传入 assistant message uuid） */
  onRewind?: (assistantMessageUuid: string) => void
  /** 错误重试回调（仅当 turn 含错误消息时使用） */
  onRetry?: () => void
  /** 在新会话中重试回调（仅当 turn 含错误消息时使用） */
  onRetryInNewSession?: () => void
  /** 压缩上下文回调（仅 prompt_too_long 错误使用） */
  onCompact?: () => void
  /** 是否正在流式输出中（隐藏操作栏） */
  isStreaming?: boolean
  /** 是否被用户中断 */
  stoppedByUser?: boolean
  /** 用户在前端选择的模型 ID（优先用于显示名称） */
  sessionModelId?: string
}

export function AssistantTurnRenderer({ turn, allMessages, historicalTaskSubjects, basePath, onFork, onRewind, onRetry, onRetryInNewSession, onCompact, isStreaming, stoppedByUser, sessionModelId }: AssistantTurnRendererProps): React.ReactElement | null {
  const channels = useAtomValue(channelsAtom)
  const processGroupsKeepExpanded = useAtomValue(agentProcessGroupsKeepExpandedAtom)
  // 收集所有 assistant 消息的内容块，保留 parent_tool_use_id 关联
  interface EnrichedBlock {
    block: SDKContentBlock
    parentToolUseId?: string | null
  }

  const enrichedBlocks: EnrichedBlock[] = []
  let hasError = false
  let errorContent: SDKAssistantMessage | null = null

  for (const aMsg of turn.assistantMessages) {
    if (aMsg.error) {
      hasError = true
      errorContent = aMsg
      continue
    }
    const blocks = aMsg.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        for (const normalizedBlock of normalizeThinkTagsInContentBlocks([block])) {
          enrichedBlocks.push({ block: normalizedBlock, parentToolUseId: aMsg.parent_tool_use_id })
        }
      }
    }
  }

  // 从 turnMessages 中提取 result 消息的耗时和用量
  const { durationMs, usage } = extractTurnUsage(turn.turnMessages)

  // 只在用户点击停止时显示中断徽章。
  // aborted_streaming / aborted_tools 是流式追加消息时的软中断，语义是继续补充信息。
  const showStoppedBadge = !!stoppedByUser

  // 构建 Agent/Task tool_use → 子代理内容块映射
  const agentToolIds = new Set<string>()
  for (const eb of enrichedBlocks) {
    if (eb.block.type === 'tool_use') {
      const tu = eb.block as { name: string; id: string }
      if (tu.name === 'Agent' || tu.name === 'Task') {
        agentToolIds.add(tu.id)
      }
    }
  }

  const childBlocksMap = new Map<string, SDKContentBlock[]>()
  const topLevelBlocks: SDKContentBlock[] = []

  for (const eb of enrichedBlocks) {
    if (eb.parentToolUseId && agentToolIds.has(eb.parentToolUseId)) {
      const children = childBlocksMap.get(eb.parentToolUseId) ?? []
      children.push(eb.block)
      childBlocksMap.set(eb.parentToolUseId, children)
    } else {
      topLevelBlocks.push(eb.block)
    }
  }

  // 检测是否有主要内容（text 块），用于决定 tool/thinking 是否 dimmed
  const hasTextContent = topLevelBlocks.some(
    (b) => b.type === 'text' && 'text' in b && !!(b as { text: string }).text
  )

  // Task 聚合数据（useMemo 防止每次渲染重算）
  const { taskActivities, firstTaskIndex } = React.useMemo(() => {
    return buildTaskProgressData(topLevelBlocks, turn.turnMessages)
  }, [topLevelBlocks, turn.turnMessages])
  const completedToolResultIds = React.useMemo(() => {
    return buildCompletedToolResultIds(turn.turnMessages)
  }, [turn.turnMessages])
  const renderItems = React.useMemo(() => {
    return buildAssistantTurnRenderItems(topLevelBlocks, {
      isStreaming,
      completedToolResultIds,
    })
  }, [topLevelBlocks, isStreaming, completedToolResultIds])

  // 如果只有错误消息
  if (enrichedBlocks.length === 0 && hasError && errorContent) {
    return (
      <ErrorMessage
        message={errorContent}
        onRetry={onRetry}
        onRetryInNewSession={onRetryInNewSession}
        onCompact={onCompact}
      />
    )
  }

  // 如果没有任何内容
  if (enrichedBlocks.length === 0 && !hasError) return null

  const renderTopLevelBlock = (block: SDKContentBlock, i: number): React.ReactNode => {
    // Task 工具块：聚合为卡片，此处用索引定位首个任务工具
    if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
      if (i === firstTaskIndex) {
        return (
          <TaskProgressCard
            key="task-progress-card"
            activities={taskActivities}
            streamEnded={!isStreaming}
            historicalTaskSubjects={historicalTaskSubjects}
          />
        )
      }
      return null
    }

    const isAgentTool = block.type === 'tool_use'
      && ((block as { name: string }).name === 'Agent' || (block as { name: string }).name === 'Task')
    const childBlocks = isAgentTool
      ? childBlocksMap.get((block as { id: string }).id)
      : undefined

    return (
      <ContentBlock
        key={i}
        block={block}
        allMessages={allMessages}
        basePath={basePath}
        animate={!!isStreaming}
        index={i}
        dimmed={hasTextContent && block.type !== 'text'}
        childBlocks={childBlocks}
        isStreaming={isStreaming}
      />
    )
  }

  const renderProcessGroupBlock = (block: SDKContentBlock, i: number): React.ReactNode => {
    return renderTopLevelBlock(block, i)
  }

  return (
    <Message from="assistant">
      <MessageHeader
        model={turn.model ? resolveModelDisplayName(turn.model, channels) : undefined}
        time={turn.createdAt ? formatMessageTime(turn.createdAt) : undefined}
        logo={<AssistantLogo model={turn.model} />}
      />
      <MessageContent>
        <div className={cn('space-y-2')}>
          {renderItems.map((item, itemIndex) => {
            if (item.type === 'block') {
              return renderTopLevelBlock(item.item.block, item.item.index)
            }

            const groupBlocks = item.items.map((groupItem) => groupItem.block)
            const firstIndex = item.items[0]?.index ?? 0
            return (
              <ProcessBlockGroup
                key={`process-${firstIndex}`}
                blocks={groupBlocks}
                isStreaming={isStreaming}
                keepExpandedAfterComplete={processGroupsKeepExpanded}
                isMessageTail={itemIndex === renderItems.length - 1}
              >
                {item.items.map((groupItem) => renderProcessGroupBlock(groupItem.block, groupItem.index))}
              </ProcessBlockGroup>
            )
          })}
        </div>
        {/* 如果有错误但也有内容块，在末尾显示错误 */}
        {hasError && errorContent && topLevelBlocks.length > 0 && (
          <div className="mt-3 text-sm text-destructive">
            {isThinkingSignatureError(errorContent.error?.message)
              ? `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}`
              : (errorContent.error?.message ?? '未知错误')}
          </div>
        )}
      </MessageContent>
      {/* 文件改动汇总：流式结束后展示本轮所有 Edit/Write/MultiEdit/NotebookEdit 文件 */}
      {!isStreaming && (
        <TurnFileChangesSummary turnMessages={turn.turnMessages} basePath={basePath} />
      )}
      {/* 操作栏：流式输出完成后显示操作按钮 */}
      {!isStreaming && (() => {
        const textContent = topLevelBlocks
          .filter((b) => b.type === 'text' && 'text' in b)
          .map((b) => (b as { text: string }).text)
          .join('\n\n')
        // 仅取主线 assistant 消息的 uuid 作为 fork/rewind 截断点。
        // SDK forkSession 内部会过滤掉 sidechain（parent_tool_use_id 非空的子代理消息），
        // 若把子代理 uuid 传过去会触发 "Message <uuid> not found in session" 错误。
        const mainlineAssistants = turn.assistantMessages.filter((m) => !m.parent_tool_use_id)
        const lastUuid = mainlineAssistants.length > 0
          ? mainlineAssistants[mainlineAssistants.length - 1]?.uuid
          : undefined
        const hasActions = !!(textContent || (onFork && lastUuid) || (onRewind && lastUuid))
        const hasDuration = durationMs != null
        if (!hasDuration && !hasActions && !showStoppedBadge) return null
        return (
          <MessageActions className="pl-[46px] mt-0.5 min-h-[28px] justify-start">
            {hasDuration && <DurationBadge durationMs={durationMs!} usage={usage} />}
            {textContent && <CopyButton content={textContent} />}
            {onFork && lastUuid && (
              <MessageAction tooltip="按当前模型从此处分叉" onClick={() => onFork(lastUuid)}>
                <Split className="size-3.5" />
              </MessageAction>
            )}
            {onRewind && lastUuid && (
              <MessageAction tooltip="回退到此处" onClick={() => onRewind(lastUuid)}>
                <Undo2 className="size-3.5" />
              </MessageAction>
            )}
            {showStoppedBadge && (
              <Badge variant="outline" className="text-xs text-muted-foreground/70 border-muted-foreground/30 shrink-0">
                已被用户中断
              </Badge>
            )}
          </MessageActions>
        )
      })()}
    </Message>
  )
}

// ===== SDKMessageRenderer 主组件（用于实时消息逐条渲染） =====

export function SDKMessageRenderer({
  message,
  allMessages,
  basePath,
  showHeader = true,
  sessionModelId,
}: SDKMessageRendererProps): React.ReactElement | null {
  const channels = useAtomValue(channelsAtom)
  const msgType = message.type

  // assistant 消息：遍历内容块渲染
  if (msgType === 'assistant') {
    const aMsg = message as SDKAssistantMessage

    // 跳过重放消息
    if (aMsg.isReplay) return null

    // 错误消息
    if (aMsg.error) {
      return <ErrorMessage message={aMsg} />
    }

    const rawBlocks = aMsg.message?.content
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return null
    const blocks = normalizeThinkTagsInContentBlocks(rawBlocks)
    if (blocks.length === 0) return null

    const model = aMsg._channelModelId || aMsg.message?.model || sessionModelId
    const meta = extractMeta(message)

    // 检测是否有主要内容（text 块）
    const hasTextContent = blocks.some(
      (b) => b.type === 'text' && 'text' in b && !!(b as { text: string }).text
    )

    return (
      <Message from="assistant">
        {showHeader && (
          <MessageHeader
            model={model ? resolveModelDisplayName(model, channels) : undefined}
            time={meta.createdAt ? formatMessageTime(meta.createdAt) : undefined}
            logo={<AssistantLogo model={model} />}
          />
        )}
        <MessageContent>
          <div className={cn('space-y-2')}>
            {blocks.map((block, i) => (
              <ContentBlock
                key={i}
                block={block}
                allMessages={allMessages}
                basePath={basePath}
                index={i}
                dimmed={hasTextContent && block.type !== 'text'}
              />
            ))}
          </div>
        </MessageContent>
      </Message>
    )
  }

  // user 消息
  if (msgType === 'user') {
    const uMsg = message as SDKUserMessage
    if (isUserInputMessage(uMsg)) {
      return <UserInputMessage message={uMsg} />
    }
    return null
  }

  // system 消息
  if (msgType === 'system') {
    const sysMsg = message as SDKSystemMessage
    const subtype = sysMsg.subtype
    const compactStatus = getSDKCompactStatus(sysMsg)

    if (compactStatus) return <CompactStatusNotice message={sysMsg} />
    if (subtype === 'permission_denied') {
      return <PermissionDeniedNotice message={sysMsg} />
    }

    return null
  }

  return null
}

// ===== 附件解析 =====

/** 解析的附件引用 */
export interface AttachedFileRef {
  filename: string
  path: string
}

/** 解析的引用文件 */
export interface QuotedFileRef {
  /** 源文件路径 */
  path: string
  /** 源文件名 */
  filename: string
}

/** 解析消息中的 <attached_files> 块和 <quoted_file> 块，返回文件列表、引用列表和剩余文本 */
export function parseAttachedFiles(content: string): { files: AttachedFileRef[]; quotes: QuotedFileRef[]; text: string } {
  const quoteRegex = /<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g
  const quotes: QuotedFileRef[] = []
  let quoteMatch: RegExpExecArray | null
  while ((quoteMatch = quoteRegex.exec(content)) !== null) {
    const pathMatch = quoteMatch[0].match(/path="([^"]*)"/)
    if (pathMatch) {
      // 反解 XML 实体：&amp; 必须最后做，否则会被先一步解出的 & 误伤
      const filePath = pathMatch[1]!
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
      quotes.push({ path: filePath, filename: filePath.split('/').pop() ?? filePath })
    }
  }

  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) {
    const cleanText = content.replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '').trim()
    return { files: [], quotes, text: cleanText }
  }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  let text = content.replace(regex, '')
  text = text.replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
  text = text.trim()
  return { files, quotes, text }
}

/** 判断文件是否为图片类型 */
export function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

/** 图片附件缩略图，点击可预览大图 */
function AttachedImageThumb({ file, onEditComplete }: { file: AttachedFileRef; onEditComplete?: (editedDataUrl: string) => void }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  React.useEffect(() => {
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    }
    const mediaType = mimeMap[ext] ?? 'image/png'

    window.electronAPI
      .readAttachment(file.path)
      .then((base64) => setImageSrc(`data:${mediaType};base64,${base64}`))
      .catch((err) => console.error('[AttachedImageThumb] 读取附件失败:', err))
  }, [file.path, file.filename])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(file.path, file.filename)
  }, [file.path, file.filename])

  if (!imageSrc) {
    return <div className="w-[200px] h-[140px] rounded-lg bg-muted/30 animate-pulse shrink-0" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={file.filename}
        className="max-w-[300px] max-h-[200px] rounded-lg object-contain cursor-pointer"
        onClick={() => setLightboxOpen(true)}
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
      <ImageLightbox
        src={imageSrc}
        alt={file.filename}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onSave={handleSave}
        onEditComplete={onEditComplete}
      />
    </div>
  )
}

/** 文件附件芯片 */
function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const openPreview = useOpenPreview()

  const handleOpenPreview = React.useCallback((): void => {
    if (!activeSessionId) return
    const parentPath = getFileParentPath(file.path)
    openPreview(activeSessionId, {
      filePath: file.path,
      previewOnly: true,
      readOnly: true,
      basePaths: parentPath ? [parentPath] : undefined,
    })
  }, [activeSessionId, file.path, openPreview])

  return (
    <button
      type="button"
      onClick={handleOpenPreview}
      disabled={!activeSessionId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-muted-foreground',
        'transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-muted/60 disabled:hover:text-muted-foreground'
      )}
      title={file.path}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </button>
  )
}

/** 引用文件 Chip（显示在用户消息中，表示该消息引用了某个文件的选中内容） */
function QuoteChip({ quote }: { quote: QuotedFileRef }): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-primary/8 border border-primary/20 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Quote className="size-3.5 shrink-0 text-primary/60" />
      <span className="truncate max-w-[200px]">{quote.filename}</span>
    </div>
  )
}

// ===== 用户输入消息渲染 =====


const SCHEDULED_RUN_MARKER = '<!--PROMA_SCHEDULED_RUN-->'

// stripScheduledRunMarker 已迁移至 @proma/session-core（本文件从该包 import 使用）

function ScheduledRunBadge(): React.ReactElement {
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const automations = useAtomValue(automationsAtom)
  const setForm = useSetAtom(automationFormAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const session = sessions.find((s) => s.id === activeSessionId)
  const automation = session?.sourceAutomationId && !session.sourceDelegationId
    ? automations.find((a) => a.id === session.sourceAutomationId)
    : undefined

  const handleClick = (): void => {
    if (!automation) return
    setActiveView('automations')
    setForm({
      open: true,
      draft: automationToDraft(automation),
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors"
      title="来自 Proma 定时任务，点击查看设置"
    >
      <Clock className="size-3" />
      <span>来自 Proma 定时任务</span>
    </button>
  )
}

function UserInputMessage({ message }: { message: SDKUserMessage }): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const rawText = extractUserText(message) ?? ''
  const isScheduledRun = rawText.includes(SCHEDULED_RUN_MARKER)
  const { files: attachedFiles, quotes, text } = parseAttachedFiles(stripScheduledRunMarker(rawText))
  const imageFiles = attachedFiles.filter((f) => isImageFile(f.filename))
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const setSessionPendingFiles = useSetAtom(agentSessionPendingFilesAtom)
  const nonImageFiles = attachedFiles.filter((f) => !isImageFile(f.filename))
  const meta = extractMeta(message as unknown as SDKMessage)

  const handleImageEditComplete = React.useCallback((editedDataUrl: string): void => {
    const base64 = editedDataUrl.split(',')[1]
    if (!base64 || !activeSessionId) return

    const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const pending: AgentPendingFile = {
      id,
      filename: `edited_image_${Date.now()}.png`,
      mediaType: 'image/png',
      size: Math.round(base64.length * 0.75),
      previewUrl: editedDataUrl,
    }

    if (!window.__pendingAgentFileData) {
      window.__pendingAgentFileData = new Map()
    }
    window.__pendingAgentFileData.set(id, base64)

    setSessionPendingFiles((prev) => {
      const sessionFiles = prev.get(activeSessionId) ?? []
      const map = new Map(prev)
      map.set(activeSessionId, [...sessionFiles, pending])
      return map
    })
  }, [activeSessionId, setSessionPendingFiles])

  return (
    <Message from="user">
      <div className="flex items-start gap-2.5 mb-2.5">
        <UserAvatar avatar={userProfile.avatar} size={35} />
        <div className="flex flex-col justify-between h-[35px]">
          <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
          {(meta.createdAt || isScheduledRun) && (
            <span className="flex items-center gap-2 leading-none">
              {meta.createdAt && (
                <span className="message-time text-[10px] text-foreground/[0.38]">{formatMessageTime(meta.createdAt)}</span>
              )}
              {isScheduledRun && (
                <ScheduledRunBadge />
              )}
            </span>
          )}
        </div>
      </div>
      <MessageContent>
        {/* 引用文件 Chip */}
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {quotes.map((q, i) => (
              <QuoteChip key={`${q.path}:${i}`} quote={q} />
            ))}
          </div>
        )}
        {/* 图片缩略图 */}
        {imageFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-2">
            {imageFiles.map((file) => (
              <AttachedImageThumb key={file.path} file={file} onEditComplete={handleImageEditComplete} />
            ))}
          </div>
        )}
        {/* 非图片文件芯片 */}
        {nonImageFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {nonImageFiles.map((file) => (
              <AttachedFileChip key={file.path} file={file} />
            ))}
          </div>
        )}
        {text && <UserMessageContent>{text}</UserMessageContent>}
      </MessageContent>
      {text && (
        <MessageActions className="pl-[46px] mt-0.5">
          <CopyButton content={text} />
        </MessageActions>
      )}
    </Message>
  )
}

// ===== 错误消息渲染 =====

interface ErrorMessageProps {
  message: SDKAssistantMessage
  /** 重试回调（在当前会话内重试） */
  onRetry?: () => void
  /** 在新会话中重试回调（创建新会话并引用当前会话继续） */
  onRetryInNewSession?: () => void
  /** 压缩上下文回调（仅 prompt_too_long 错误使用） */
  onCompact?: () => void
}

function ErrorMessage({ message, onRetry, onRetryInNewSession, onCompact }: ErrorMessageProps): React.ReactElement {
  const meta = extractMeta(message as unknown as SDKMessage)
  const errorText = message.error?.message ?? '未知错误'

  const msgAny = message as unknown as Record<string, unknown>
  const errorTitle = typeof msgAny._errorTitle === 'string' ? msgAny._errorTitle : undefined
  const errorCode = typeof msgAny._errorCode === 'string' ? msgAny._errorCode : undefined
  const errorDetails = Array.isArray(msgAny._errorDetails)
    ? (msgAny._errorDetails as string[])
    : undefined
  const errorActions = Array.isArray(msgAny._errorActions)
    ? (msgAny._errorActions as RecoveryAction[])
    : undefined
  const isPromptTooLong = errorCode === 'prompt_too_long'

  const setEnvDialogOpen = useSetAtom(environmentCheckDialogOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setModelSelectorOpen = useSetAtom(modelSelectorOpenAtom)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  const contentText = message.message?.content
    ?.filter((b) => b.type === 'text' && 'text' in b)
    .map((b) => (b as { text: string }).text)
    .join('\n') ?? errorText
  const isThinkingSignature = errorCode === THINKING_SIGNATURE_ERROR_CODE ||
    isThinkingSignatureError(contentText, errorText)
  const displayTitle = errorTitle ?? (isThinkingSignature ? THINKING_SIGNATURE_ERROR_TITLE : undefined)
  const displayContentText = isThinkingSignature ? THINKING_SIGNATURE_ERROR_MESSAGE : contentText
  const displayedErrorActions = (errorActions ?? []).filter((action) => {
    if (action.action === 'retry' && !onRetry) return false
    if (action.action === 'compact' && !onCompact) return false
    if (action.action === 'retry_in_new_session' && !onRetryInNewSession) return false
    return true
  })

  const handleRecoveryAction = (action: RecoveryAction) => {
    switch (action.action) {
      case 'open_environment_check':
        setEnvDialogOpen(true)
        break
      case 'open_channel_settings':
        setSettingsTab('channels')
        setSettingsOpen(true)
        break
      case 'settings':
        setSettingsOpen(true)
        break
      case 'select_model':
        setModelSelectorOpen(true)
        break
      case 'open_external':
        if (action.payload) {
          window.electronAPI.openExternal(action.payload)
        }
        break
      case 'retry':
        onRetry?.()
        break
      case 'compact':
        onCompact?.()
        break
      case 'retry_in_new_session':
        onRetryInNewSession?.()
        break
      default:
        console.warn('[ErrorMessage] 未处理的 recovery action:', action)
    }
  }

  const iconForAction = (action: RecoveryAction['action']) => {
    switch (action) {
      case 'open_environment_check':
        return <Wrench className="size-3.5 mr-1.5" />
      case 'open_channel_settings':
      case 'settings':
        return <Settings className="size-3.5 mr-1.5" />
      case 'select_model':
        return <Cpu className="size-3.5 mr-1.5" />
      case 'open_external':
        return <ExternalLink className="size-3.5 mr-1.5" />
      case 'retry':
        return <RotateCw className="size-3.5 mr-1.5" />
      case 'compact':
        return <Minimize2 className="size-3.5 mr-1.5" />
      case 'retry_in_new_session':
        return <Plus className="size-3.5 mr-1.5" />
      default:
        return null
    }
  }

  const hasStructuredActions = displayedErrorActions.length > 0
  const hasLegacyActions = !!(onRetry || onRetryInNewSession || (isPromptTooLong && onCompact))
  const hasActions = hasStructuredActions || hasLegacyActions

  return (
    <Message from="assistant">
      <MessageHeader
        model={undefined}
        time={meta.createdAt ? formatMessageTime(meta.createdAt) : undefined}
        logo={
          <div className="size-[35px] rounded-[25%] bg-destructive/10 flex items-center justify-center">
            <AlertTriangle size={18} className="text-destructive" />
          </div>
        }
      />
      <MessageContent>
        {displayTitle && (
          <div className="text-sm font-medium text-destructive mb-1">{displayTitle}</div>
        )}
        <div className="text-destructive">
          <MessageResponse>{displayContentText}</MessageResponse>
        </div>
        {errorDetails && errorDetails.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="underline-offset-2 hover:underline"
            >
              {detailsOpen ? '收起诊断详情' : '查看诊断详情'}
            </button>
            {detailsOpen && (
              <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                {errorDetails.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {hasActions && (
          <div className="flex items-center flex-wrap gap-2 mt-3">
            {hasStructuredActions &&
              displayedErrorActions.map((a, i) => (
                <Button
                  key={`${a.action}-${i}`}
                  size="sm"
                  variant={i === 0 ? 'default' : 'outline'}
                  onClick={() => handleRecoveryAction(a)}
                >
                  {iconForAction(a.action)}
                  {a.label}
                </Button>
              ))}
            {!hasStructuredActions && isPromptTooLong && onCompact && (
              <Button size="sm" onClick={onCompact}>
                <Minimize2 className="size-3.5 mr-1.5" />
                压缩上下文
              </Button>
            )}
            {!hasStructuredActions && isThinkingSignature && onRetryInNewSession && (
              <Button
                size="sm"
                onClick={onRetryInNewSession}
                title="新建对话并引用当前会话继续"
              >
                <Plus className="size-3.5 mr-1.5" />
                在新对话继续
              </Button>
            )}
            {!hasStructuredActions && onRetry && (
              <Button size="sm" variant={isPromptTooLong || isThinkingSignature ? 'outline' : 'default'} onClick={onRetry}>
                <RotateCw className="size-3.5 mr-1.5" />
                重试
              </Button>
            )}
            {!hasStructuredActions && !isThinkingSignature && onRetryInNewSession && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetryInNewSession}
                title="如遇到未知错误，可点此按钮在新会话中尝试解决"
              >
                <Plus className="size-3.5 mr-1.5" />
                在新会话中重试
              </Button>
            )}
          </div>
        )}
      </MessageContent>
      <MessageActions className="pl-[46px] mt-0.5">
        <CopyButton content={displayContentText} />
      </MessageActions>
    </Message>
  )
}

// ===== MessageGroup 渲染器（统一入口，同时支持 turn 和单条消息） =====

export interface MessageGroupRendererProps {
  group: MessageGroup
  allMessages: SDKMessage[]
  /** 跨 turn 历史 TaskCreate id → subject 映射（由父组件 useMemo 算一次后传入） */
  historicalTaskSubjects: Map<string, string>
  basePath?: string
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  /** 错误重试回调（仅当 turn 含错误消息时使用） */
  onRetry?: () => void
  /** 在新会话中重试回调（仅当 turn 含错误消息时使用） */
  onRetryInNewSession?: () => void
  /** 压缩上下文回调（仅 prompt_too_long 错误使用） */
  onCompact?: () => void
  /** 是否正在流式输出中（隐藏操作栏） */
  isStreaming?: boolean
  /** 是否被用户中断 */
  stoppedByUser?: boolean
  /** 用户在前端选择的模型 ID（优先用于显示名称） */
  sessionModelId?: string
}

/**
 * WeakMap 缓存：为没有 uuid 的消息生成稳定的 fallback ID
 * 使用 message 对象（而非 group 对象）作为 key，因为 group 在 useMemo 重算时会
 * 被重建为新对象，而 group.message 引用的底层 SDK message 对象是稳定的。
 */
const messageIdCache = new WeakMap<object, string>()
let fallbackIdCounter = 0

/**
 * 从 MessageGroup 中提取稳定的 ID，用于 data-message-id 和迷你地图
 */
export function getGroupId(group: MessageGroup): string {
  if (group.type === 'user') {
    if (group.message.uuid) return group.message.uuid
    const stableKey = (group.message as unknown as Record<string, unknown>)._promaStableKey
    if (typeof stableKey === 'string') return stableKey
    // 没有 uuid：使用基于 message 对象引用的缓存 ID（message 引用在重渲染间稳定）
    if (!messageIdCache.has(group.message)) {
      messageIdCache.set(group.message, `user-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(group.message)!
  }
  if (group.type === 'system') {
    if (!messageIdCache.has(group.message)) {
      messageIdCache.set(group.message, `system-${group.message.subtype ?? 'unknown'}-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(group.message)!
  }
  // assistant-turn：取首条 assistant 消息的 uuid
  const first = group.assistantMessages[0]
  if (first?.uuid) return first.uuid
  const stableKey = first ? (first as unknown as Record<string, unknown>)._promaStableKey : undefined
  if (typeof stableKey === 'string') return stableKey
  // 没有 uuid：使用基于首条 assistant message 对象引用的缓存 ID
  if (first) {
    if (!messageIdCache.has(first)) {
      messageIdCache.set(first, `turn-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(first)!
  }
  // 极端情况：空 turn
  return `turn-empty-${++fallbackIdCounter}`
}

// getGroupPreview 已迁移至 @proma/session-core（本文件从该包 import 并 re-export）

export function MessageGroupRenderer({ group, allMessages, historicalTaskSubjects, basePath, onFork, onRewind, onRetry, onRetryInNewSession, onCompact, isStreaming, stoppedByUser, sessionModelId }: MessageGroupRendererProps): React.ReactElement | null {
  const groupId = getGroupId(group)

  if (group.type === 'user') {
    return (
      <div data-message-id={groupId} data-message-role="user">
        <UserInputMessage message={group.message} />
      </div>
    )
  }

  if (group.type === 'system') {
    const subtype = group.message.subtype
    if (getSDKCompactStatus(group.message)) return <div data-message-id={groupId}><CompactStatusNotice message={group.message} active={isStreaming} /></div>
    if (subtype === 'permission_denied') return <div data-message-id={groupId}><PermissionDeniedNotice message={group.message} /></div>
    return null
  }

  // assistant-turn
  return (
    <div data-message-id={groupId} data-message-role="assistant">
      <AssistantTurnRenderer
        turn={group}
        allMessages={allMessages}
        historicalTaskSubjects={historicalTaskSubjects}
        basePath={basePath}
        onFork={onFork}
        onRewind={onRewind}
        onRetry={onRetry}
        onRetryInNewSession={onRetryInNewSession}
        onCompact={onCompact}
        isStreaming={isStreaming}
        stoppedByUser={stoppedByUser}
        sessionModelId={sessionModelId}
      />
    </div>
  )
}
