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
import { Bot, Loader2, AlertTriangle, FileText, FileImage, Download, Split } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { ContentBlock } from './ContentBlock'
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
import { formatMessageTime } from '@/components/chat/ChatMessageItem'
import { getModelLogo, resolveModelDisplayName } from '@/lib/model-logo'
import { userProfileAtom } from '@/atoms/user-profile'
import { channelsAtom } from '@/atoms/chat-atoms'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKContentBlock,
  SDKResultMessage,
  AgentEventUsage,
} from '@proma/shared'

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

// ===== system 消息：正在压缩指示器 =====

function CompactingIndicator(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 my-2 px-1 text-[12px] text-muted-foreground/70">
      <Loader2 className="size-3 animate-spin" />
      <span>正在压缩上下文...</span>
    </div>
  )
}

// ===== 辅助：从 SDKMessage 提取元数据 =====

interface MessageMeta {
  createdAt?: number
}

function extractMeta(message: SDKMessage): MessageMeta {
  const msg = message as Record<string, unknown>
  return {
    createdAt: typeof msg._createdAt === 'number' ? msg._createdAt : undefined,
  }
}

/** 从 turn 消息列表中提取 result 消息的耗时和用量数据 */
function extractTurnUsage(turnMessages: SDKMessage[]): { durationMs?: number; usage?: AgentEventUsage } {
  for (const msg of turnMessages) {
    if (msg.type !== 'result') continue
    const resultMsg = msg as SDKResultMessage
    const raw = msg as Record<string, unknown>
    const durationMs = typeof raw._durationMs === 'number' ? raw._durationMs : undefined
    const u = resultMsg.usage
    if (!u) return { durationMs }
    const contextWindow = resultMsg.modelUsage
      ? Object.values(resultMsg.modelUsage)[0]?.contextWindow
      : undefined
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

// ===== 辅助：从 user 消息中提取纯文本内容 =====

function extractUserText(message: SDKUserMessage): string | null {
  const content = message.message?.content
  if (!Array.isArray(content)) return null

  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push((block as { text: string }).text)
    }
  }

  return texts.length > 0 ? texts.join('\n') : null
}

// ===== 辅助：判断 user 消息是否为真正的人类用户输入（非工具结果/子代理提示） =====

function isUserInputMessage(message: SDKUserMessage): boolean {
  if (message.parent_tool_use_id) return false
  // 包含 tool_result 块的消息是工具结果，不是用户输入
  const content = message.message?.content
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return false
  return extractUserText(message) !== null
}

// ===== 助手头像 =====

function AssistantLogo({ model }: { model?: string }): React.ReactElement {
  if (model) {
    return (
      <img
        src={getModelLogo(model)}
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

// ===== Turn 分组类型 =====

export interface AssistantTurn {
  type: 'assistant-turn'
  /** 当前 turn 内所有 assistant 消息 */
  assistantMessages: SDKAssistantMessage[]
  /** 当前 turn 内所有消息（含 tool_result user 消息，供工具结果查找） */
  turnMessages: SDKMessage[]
  /** 模型名称（取首条 assistant 消息的 model） */
  model?: string
  /** 创建时间（取首条 assistant 消息的时间） */
  createdAt?: number
}

export type MessageGroup =
  | { type: 'user'; message: SDKUserMessage }
  | { type: 'system'; message: SDKSystemMessage }
  | AssistantTurn

/**
 * 将 SDKMessage 列表分组为可渲染的 Turn
 *
 * 规则：
 * 1. user（真正用户输入）→ 单独的 user group
 * 2. assistant + user(tool_result) + assistant... → 合并为一个 assistant-turn
 * 3. system（compact_boundary / compacting）→ 独立渲染，其他归入当前 turn
 * 4. 其他类型（result, tool_progress 等）→ 归入当前 assistant-turn
 * 5. 后处理：合并相邻同模型的 assistant-turn（处理子代理切换模型导致的碎片化）
 */
export function groupIntoTurns(messages: SDKMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentTurn: AssistantTurn | null = null

  const flushTurn = (): void => {
    if (currentTurn && currentTurn.assistantMessages.length > 0) {
      groups.push(currentTurn)
    }
    currentTurn = null
  }

  for (const msg of messages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      if (isUserInputMessage(userMsg)) {
        // 真正的用户输入 → 结束当前 turn，开始新段落
        flushTurn()
        groups.push({ type: 'user', message: userMsg })
      } else {
        // tool_result 消息 → 归入当前 turn
        if (currentTurn) {
          currentTurn.turnMessages.push(msg)
        }
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      // 跳过重放消息
      if (aMsg.isReplay) continue

      if (!currentTurn) {
        // 开始新 turn
        const meta = extractMeta(msg)
        currentTurn = {
          type: 'assistant-turn',
          assistantMessages: [aMsg],
          turnMessages: [msg],
          model: aMsg.message?.model,
          createdAt: meta.createdAt,
        }
      } else {
        // 继续当前 turn
        currentTurn.assistantMessages.push(aMsg)
        currentTurn.turnMessages.push(msg)
      }
    } else if (msg.type === 'system') {
      const sysMsg = msg as SDKSystemMessage
      // 仅需要独立渲染的 system 消息才中断 turn（compact_boundary / compacting）
      // 其他 system 消息（如 init、task_started、task_progress）归入当前 turn，不中断分组
      if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'compacting') {
        flushTurn()
        groups.push({ type: 'system', message: sysMsg })
      } else if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    } else {
      // result, tool_progress 等 → 归入当前 turn
      if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    }
  }

  flushTurn()
  return mergeAdjacentSameModelTurns(groups)
}

/**
 * 后处理：合并相邻同模型的 assistant-turn
 *
 * 当子代理（如 haiku）执行多个工具调用时，中间的 user(tool_result) 消息
 * 可能导致 turn 被拆分为多个碎片。此函数将同模型的相邻 assistant-turn 合并，
 * 同时吸收它们之间的非用户输入 group（如被误判为用户输入的子代理内部消息）。
 */
function mergeAdjacentSameModelTurns(groups: MessageGroup[]): MessageGroup[] {
  if (groups.length <= 1) return groups

  const result: MessageGroup[] = []

  for (const group of groups) {
    if (group.type !== 'assistant-turn') {
      result.push(group)
      continue
    }

    // 向前查找可合并的同模型 assistant-turn（跳过非 user-input 的中间 group）
    let mergeTargetIdx = -1
    for (let i = result.length - 1; i >= 0; i--) {
      const prev = result[i]!
      if (prev.type === 'user') break // 真正的用户输入阻断合并
      if (prev.type === 'assistant-turn') {
        if (prev.model === group.model) {
          mergeTargetIdx = i
        }
        break // 遇到第一个 assistant-turn 就停止（不跨越不同模型的 turn）
      }
      // system 或其他 group：继续向前查找
    }

    if (mergeTargetIdx >= 0) {
      const target = result[mergeTargetIdx] as AssistantTurn
      target.assistantMessages.push(...group.assistantMessages)
      target.turnMessages.push(...group.turnMessages)
    } else {
      result.push(group)
    }
  }

  return result
}

// ===== AssistantTurnRenderer — 渲染一个完整的 assistant turn =====

export interface AssistantTurnRendererProps {
  turn: AssistantTurn
  /** 所有消息（全局，供工具结果查找跨 turn 的结果） */
  allMessages: SDKMessage[]
  basePath?: string
  /** 分叉回调（传入最后一条 assistant 消息的 uuid） */
  onFork?: (upToMessageUuid: string) => void
  /** 是否正在流式输出中（隐藏操作栏） */
  isStreaming?: boolean
}

export function AssistantTurnRenderer({ turn, allMessages, basePath, onFork, isStreaming }: AssistantTurnRendererProps): React.ReactElement | null {
  const channels = useAtomValue(channelsAtom)
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
        enrichedBlocks.push({ block, parentToolUseId: aMsg.parent_tool_use_id })
      }
    }
  }

  // 如果只有错误消息
  if (enrichedBlocks.length === 0 && hasError && errorContent) {
    return <ErrorMessage message={errorContent} />
  }

  // 如果没有任何内容
  if (enrichedBlocks.length === 0 && !hasError) return null

  // 从 turnMessages 中提取 result 消息的耗时和用量
  const { durationMs, usage } = extractTurnUsage(turn.turnMessages)

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

  return (
    <Message from="assistant">
      <MessageHeader
        model={turn.model ? resolveModelDisplayName(turn.model, channels) : undefined}
        time={turn.createdAt ? formatMessageTime(turn.createdAt) : undefined}
        logo={<AssistantLogo model={turn.model} />}
      />
      <MessageContent>
        <div className={cn('space-y-2')}>
          {topLevelBlocks.map((block, i) => {
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
                animate
                index={i}
                dimmed={hasTextContent && block.type !== 'text'}
                childBlocks={childBlocks}
              />
            )
          })}
        </div>
        {/* 如果有错误但也有内容块，在末尾显示错误 */}
        {hasError && errorContent && topLevelBlocks.length > 0 && (
          <div className="mt-3 text-sm text-destructive">
            {errorContent.error?.message ?? '未知错误'}
          </div>
        )}
      </MessageContent>
      {/* 操作栏：左侧耗时标签 + 右侧操作按钮（流式输出中隐藏） */}
      {!isStreaming && (() => {
        const textContent = topLevelBlocks
          .filter((b) => b.type === 'text' && 'text' in b)
          .map((b) => (b as { text: string }).text)
          .join('\n\n')
        const lastUuid = turn.assistantMessages.length > 0
          ? turn.assistantMessages[turn.assistantMessages.length - 1]?.uuid
          : undefined
        const hasActions = !!(textContent || (onFork && lastUuid))
        const hasDuration = durationMs != null
        if (!hasDuration && !hasActions) return null
        return (
          <MessageActions className="pl-[46px] mt-0.5 min-h-[28px] justify-start animate-in fade-in duration-200">
            {hasDuration && <DurationBadge durationMs={durationMs!} usage={usage} />}
            {textContent && <CopyButton content={textContent} />}
            {onFork && lastUuid && (
              <MessageAction tooltip="从此处分叉" onClick={() => onFork(lastUuid)}>
                <Split className="size-3.5" />
              </MessageAction>
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

    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks) || blocks.length === 0) return null

    const model = aMsg.message?.model
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
                animate
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

    if (subtype === 'compact_boundary') {
      return <CompactBoundaryDivider />
    }

    if (subtype === 'compacting') {
      return <CompactingIndicator />
    }

    return null
  }

  return null
}

// ===== 附件解析 =====

/** 解析的附件引用 */
interface AttachedFileRef {
  filename: string
  path: string
}

/** 解析消息中的 <attached_files> 块，返回文件列表和剩余文本 */
function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

/** 判断文件是否为图片类型 */
function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

/** 图片附件缩略图 */
function AttachedImageThumb({ file }: { file: AttachedFileRef }): React.ReactElement {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)

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
        className="max-w-[300px] max-h-[200px] rounded-lg object-contain"
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        title="保存图片"
      >
        <Download className="size-4" />
      </button>
    </div>
  )
}

/** 文件附件芯片 */
function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </div>
  )
}

// ===== 用户输入消息渲染 =====

function UserInputMessage({ message }: { message: SDKUserMessage }): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const rawText = extractUserText(message) ?? ''
  const { files: attachedFiles, text } = parseAttachedFiles(rawText)
  const imageFiles = attachedFiles.filter((f) => isImageFile(f.filename))
  const nonImageFiles = attachedFiles.filter((f) => !isImageFile(f.filename))
  const meta = extractMeta(message as unknown as SDKMessage)

  return (
    <Message from="user">
      <div className="flex items-start gap-2.5 mb-2.5">
        <UserAvatar avatar={userProfile.avatar} size={35} />
        <div className="flex flex-col justify-between h-[35px]">
          <span className="text-sm font-semibold text-foreground/60 leading-none">{userProfile.userName}</span>
          {meta.createdAt && (
            <span className="text-[10px] text-foreground/[0.38] leading-none">{formatMessageTime(meta.createdAt)}</span>
          )}
        </div>
      </div>
      <MessageContent>
        {/* 图片缩略图 */}
        {imageFiles.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-2">
            {imageFiles.map((file) => (
              <AttachedImageThumb key={file.path} file={file} />
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

function ErrorMessage({ message }: { message: SDKAssistantMessage }): React.ReactElement {
  const meta = extractMeta(message as unknown as SDKMessage)
  const errorText = message.error?.message ?? '未知错误'

  const msgAny = message as unknown as Record<string, unknown>
  const errorTitle = typeof msgAny._errorTitle === 'string' ? msgAny._errorTitle : undefined

  const contentText = message.message?.content
    ?.filter((b) => b.type === 'text' && 'text' in b)
    .map((b) => (b as { text: string }).text)
    .join('\n') ?? errorText

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
        {errorTitle && (
          <div className="text-sm font-medium text-destructive mb-1">{errorTitle}</div>
        )}
        <div className="text-destructive">
          <MessageResponse>{contentText}</MessageResponse>
        </div>
      </MessageContent>
      <MessageActions className="pl-[46px] mt-0.5">
        <CopyButton content={contentText} />
      </MessageActions>
    </Message>
  )
}

// ===== MessageGroup 渲染器（统一入口，同时支持 turn 和单条消息） =====

export interface MessageGroupRendererProps {
  group: MessageGroup
  allMessages: SDKMessage[]
  basePath?: string
  onFork?: (upToMessageUuid: string) => void
  /** 是否正在流式输出中（隐藏操作栏） */
  isStreaming?: boolean
}

/**
 * WeakMap 缓存：为没有 uuid 的 group 生成稳定的 fallback ID
 */
const groupIdCache = new WeakMap<MessageGroup, string>()
let fallbackIdCounter = 0

/**
 * 从 MessageGroup 中提取稳定的 ID，用于 data-message-id 和迷你地图
 */
export function getGroupId(group: MessageGroup): string {
  if (group.type === 'user') {
    if (group.message.uuid) return group.message.uuid
    // 没有 uuid：使用缓存的稳定 ID
    if (!groupIdCache.has(group)) {
      groupIdCache.set(group, `user-${++fallbackIdCounter}`)
    }
    return groupIdCache.get(group)!
  }
  if (group.type === 'system') {
    return `system-${group.message.subtype ?? 'unknown'}`
  }
  // assistant-turn：取首条 assistant 消息的 uuid
  const first = group.assistantMessages[0]
  if (first?.uuid) return first.uuid
  // 没有 uuid：使用缓存的稳定 ID
  if (!groupIdCache.has(group)) {
    groupIdCache.set(group, `turn-${++fallbackIdCounter}`)
  }
  return groupIdCache.get(group)!
}

/**
 * 从 MessageGroup 中提取纯文本预览，供迷你地图使用
 */
export function getGroupPreview(group: MessageGroup): string {
  if (group.type === 'user') {
    return (extractUserText(group.message) ?? '').replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '').slice(0, 200)
  }
  if (group.type === 'system') {
    if (group.message.subtype === 'compact_boundary') return '上下文已压缩'
    if (group.message.subtype === 'compacting') return '正在压缩上下文...'
    return ''
  }
  // assistant-turn：收集所有 text 块
  const texts: string[] = []
  for (const aMsg of group.assistantMessages) {
    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type === 'text' && 'text' in block) {
        texts.push((block as { text: string }).text)
      }
    }
  }
  return texts.join(' ').slice(0, 200)
}

export function MessageGroupRenderer({ group, allMessages, basePath, onFork, isStreaming }: MessageGroupRendererProps): React.ReactElement | null {
  const groupId = getGroupId(group)

  if (group.type === 'user') {
    return (
      <div data-message-id={groupId}>
        <UserInputMessage message={group.message} />
      </div>
    )
  }

  if (group.type === 'system') {
    const subtype = group.message.subtype
    if (subtype === 'compact_boundary') return <div data-message-id={groupId}><CompactBoundaryDivider /></div>
    if (subtype === 'compacting') return <div data-message-id={groupId}><CompactingIndicator /></div>
    return null
  }

  // assistant-turn
  return (
    <div data-message-id={groupId}>
      <AssistantTurnRenderer
        turn={group}
        allMessages={allMessages}
        basePath={basePath}
        onFork={onFork}
        isStreaming={isStreaming}
      />
    </div>
  )
}
