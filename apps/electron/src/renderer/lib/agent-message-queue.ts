import type { SDKMessage } from '@proma/shared'
import type { QuotedSelection } from '@/atoms/preview-atoms'
import {
  buildAgentHistoryQuoteLabel,
  expandAgentHistoryQuoteMentions,
  parseAgentHistoryQuoteMention,
} from './quoted-selection'

export type QueueDropPlacement = 'before' | 'after'

export interface AgentQueuedAttachment {
  filename: string
  mediaType: string
  size: number
  targetPath: string
}

export interface AgentQueuedMessage {
  id: string
  text: string
  createdAt: number
  quotedSelection?: QuotedSelection
  fileReferenceBlock?: string
  attachments?: AgentQueuedAttachment[]
  additionalDirectories?: string[]
}

/**
 * 队列的自动消费必须由常驻调度器执行，不能依赖某个 AgentView 是否仍挂载。
 * 保留停止、后台等待和交互阻塞状态，避免在不安全的时机意外开启新一轮 run。
 */
export function shouldAutoDispatchQueuedMessage(options: {
  queueLength: number
  running: boolean
  backgroundWaiting: boolean
  stoppedByUser: boolean
  hasBlockingRequests: boolean
  hasChannel: boolean
  hasAvailableModel: boolean
}): boolean {
  return options.queueLength > 0 &&
    !options.running &&
    !options.backgroundWaiting &&
    !options.stoppedByUser &&
    !options.hasBlockingRequests &&
    options.hasChannel &&
    options.hasAvailableModel
}

export function createAgentQueuedMessage(
  text: string,
  id: string,
  createdAt: number,
  quotedSelection?: QuotedSelection | null,
  options?: {
    fileReferenceBlock?: string
    attachments?: AgentQueuedAttachment[]
    additionalDirectories?: string[]
  },
): AgentQueuedMessage {
  const message: AgentQueuedMessage = {
    id,
    text: text.trim(),
    createdAt,
  }
  if (quotedSelection) message.quotedSelection = quotedSelection
  if (options?.fileReferenceBlock) message.fileReferenceBlock = options.fileReferenceBlock
  if (options?.attachments && options.attachments.length > 0) message.attachments = options.attachments
  if (options?.additionalDirectories && options.additionalDirectories.length > 0) message.additionalDirectories = options.additionalDirectories
  return message
}

export function upsertAgentLiveMessageByUuid(
  messages: SDKMessage[],
  incoming: SDKMessage,
): SDKMessage[] {
  const incomingUuid = (incoming as unknown as Record<string, unknown>).uuid
  if (typeof incomingUuid !== 'string' || incomingUuid.length === 0) {
    return [...messages, incoming]
  }

  const existingIndex = messages.findIndex((message) => (
    (message as unknown as Record<string, unknown>).uuid === incomingUuid
  ))
  if (existingIndex === -1) return [...messages, incoming]

  const existing = messages[existingIndex]!
  const merged = {
    ...(existing as unknown as Record<string, unknown>),
    ...(incoming as unknown as Record<string, unknown>),
  } as unknown as SDKMessage
  const next = [...messages]
  next[existingIndex] = merged
  return next
}

export function removeQueuedMessage(
  queue: AgentQueuedMessage[],
  messageId: string,
): AgentQueuedMessage[] {
  return queue.filter((item) => item.id !== messageId)
}

export function restoreQueuedMessageToFront(
  queue: AgentQueuedMessage[],
  message: AgentQueuedMessage,
): AgentQueuedMessage[] {
  if (queue.some((item) => item.id === message.id)) return queue
  return [message, ...queue]
}

export function moveQueuedMessage(
  queue: AgentQueuedMessage[],
  sourceId: string,
  targetId: string,
  placement: QueueDropPlacement,
): AgentQueuedMessage[] {
  if (sourceId === targetId) return queue

  const source = queue.find((item) => item.id === sourceId)
  if (!source) return queue

  const withoutSource = queue.filter((item) => item.id !== sourceId)
  const targetIndex = withoutSource.findIndex((item) => item.id === targetId)
  if (targetIndex === -1) return queue

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex
  return [
    ...withoutSource.slice(0, insertIndex),
    source,
    ...withoutSource.slice(insertIndex),
  ]
}

export interface ParsedQueuedMessageMentions {
  cleanedText: string
  mentionedSkills: string[]
  mentionedMcpServers: string[]
  mentionedSessionIds: string[]
  mentionedTodoIds: string[]
  mentionedCalendarEventIds: string[]
}

export interface QueuedMessageSendPayload {
  rawText: string
  sdkText: string
  mentions: ParsedQueuedMessageMentions
}

/** 队列预览专用片段：保留原始消息用于发送，同时把引用协议渲染为可读芯片。 */
export type QueuedMessageReferenceType = 'file' | 'skill' | 'mcp' | 'session' | 'todo' | 'calendar_event' | 'quote'

export type QueuedMessageDisplayPart =
  | { type: 'text'; value: string }
  | {
      type: 'reference'
      referenceType: QueuedMessageReferenceType
      id: string
      label: string
    }

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderQueuedParagraphHtml(text: string): string {
  const quoteMarkerPattern = /&quote:[A-Za-z0-9%_.!~*'()-]+/g
  let html = ''
  let lastIndex = 0

  for (const match of text.matchAll(quoteMarkerPattern)) {
    if (match.index > lastIndex) {
      html += escapeHtml(text.slice(lastIndex, match.index))
    }

    const marker = match[0]
    const quote = parseAgentHistoryQuoteMention(marker)
    if (!quote) {
      html += escapeHtml(marker)
    } else {
      const payload = marker.slice('&quote:'.length)
      const id = `${quote.messageId ?? ''}:${quote.selectionStart ?? ''}:${quote.selectionEnd ?? ''}`
      const label = buildAgentHistoryQuoteLabel(quote)
      html += `<span data-type="mention" data-id="${escapeHtmlAttribute(id)}" data-label="${escapeHtmlAttribute(label)}" data-mention-suggestion-char="&" data-mention-quote="${escapeHtmlAttribute(payload)}">${escapeHtml(label)}</span>`
    }
    lastIndex = match.index + marker.length
  }

  html += escapeHtml(text.slice(lastIndex))
  return html.replace(/\n/g, '<br>')
}

/**
 * 把纯文本队列消息转成与 RichTextInput 段落渲染一致的 HTML：
 * 双换行分段落，单换行转 <br>，并转义 HTML 特殊字符避免破坏结构。
 * 用于撤回时保留已有草稿的富文本节点（mention 等），同时让队列文本按正常段落显示。
 */
export function queuedTextToParagraphHtml(text: string): string {
  const normalized = text.trim()
  if (!normalized) return ''
  return normalized
    .split(/\n\n+/)
    .map((para) => `<p>${renderQueuedParagraphHtml(para)}</p>`)
    .join('')
}

const REF_PATTERN = /\/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?/g
const DISPLAY_REFERENCE_PATTERN = /&quote:(?<quote>[A-Za-z0-9%_.!~*'()-]+)|@file:(?<file>\S+)|\/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)(?<sessionLabel>\S+))?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)(?<todoLabel>\S+))?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)(?<calendarEventLabel>\S+))?/g

function decodeReferenceLabel(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 将排队消息中的文件、Skill、MCP、会话、历史引用和规划协议转换为展示片段。
 * `item.text` 仍完整保留，发送时继续通过 parseQueuedMessageMentions 提取原始 ID。
 */
export function getQueuedMessageDisplayParts(text: string): QueuedMessageDisplayPart[] {
  const parts: QueuedMessageDisplayPart[] = []
  let lastIndex = 0

  for (const match of text.matchAll(DISPLAY_REFERENCE_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    const groups = match.groups ?? {}
    if (groups.quote) {
      const quote = parseAgentHistoryQuoteMention(`&quote:${groups.quote}`)
      if (quote) {
        parts.push({
          type: 'reference',
          referenceType: 'quote',
          id: `${quote.messageId ?? ''}:${quote.selectionStart ?? ''}:${quote.selectionEnd ?? ''}`,
          label: buildAgentHistoryQuoteLabel(quote),
        })
      } else {
        parts.push({ type: 'text', value: match[0] })
      }
      lastIndex = match.index + match[0].length
      continue
    }

    let referenceType: QueuedMessageReferenceType
    let id: string
    let rawLabel: string | undefined

    if (groups.file) {
      referenceType = 'file'
      id = groups.file
    } else if (groups.skill) {
      referenceType = 'skill'
      id = groups.skill
    } else if (groups.mcp) {
      referenceType = 'mcp'
      id = groups.mcp
    } else if (groups.session) {
      referenceType = 'session'
      id = groups.session
      rawLabel = groups.sessionLabel
    } else if (groups.todo) {
      referenceType = 'todo'
      id = groups.todo
      rawLabel = groups.todoLabel
    } else if (groups.calendarEvent) {
      referenceType = 'calendar_event'
      id = groups.calendarEvent
      rawLabel = groups.calendarEventLabel
    } else {
      continue
    }

    const decodedId = decodeReferenceLabel(id)
    const label = rawLabel
      ? decodeReferenceLabel(rawLabel)
      : referenceType === 'file'
        ? (decodedId.split(/[\\/]/).pop() || decodedId)
        : referenceType === 'session'
          ? `会话 ${id.slice(0, 8)}`
          : referenceType === 'todo'
            ? `Todo ${id.slice(0, 8)}`
            : referenceType === 'calendar_event'
              ? `日程 ${id.slice(0, 8)}`
              : decodedId

    parts.push({ type: 'reference', referenceType, id, label })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }]
}

export function parseQueuedMessageMentions(text: string): ParsedQueuedMessageMentions {
  const mentionedSkills: string[] = []
  const mentionedMcpServers: string[] = []
  const mentionedSessionIds: string[] = []
  const mentionedTodoIds: string[] = []
  const mentionedCalendarEventIds: string[] = []

  for (const match of text.matchAll(REF_PATTERN)) {
    const { skill, mcp, session, todo, calendarEvent } = match.groups ?? {}
    if (skill) mentionedSkills.push(skill)
    else if (mcp) mentionedMcpServers.push(mcp)
    else if (session) mentionedSessionIds.push(session)
    else if (todo) mentionedTodoIds.push(todo)
    else if (calendarEvent) mentionedCalendarEventIds.push(calendarEvent)
  }

  return {
    cleanedText: text
      .replace(REF_PATTERN, '')
      // @file: 路径在 htmlToMarkdown 序列化时已 encodeURIComponent（路径可能含空格），
      // 这里还原为真实路径，保证 Agent 侧读取的是可访问的完整路径；
      // 仅当含百分号编码时解码，避免破坏旧的未编码路径。
      .replace(/@file:([^\s]+)/g, (full, encodedPath: string) =>
        /%[0-9A-Fa-f]{2}/.test(encodedPath)
          ? `@file:${decodeReferenceLabel(encodedPath)}`
          : full
      )
      .trim(),
    mentionedSkills,
    mentionedMcpServers,
    mentionedSessionIds,
    mentionedTodoIds,
    mentionedCalendarEventIds,
  }
}

export function buildQueuedMessageSendPayload(
  message: AgentQueuedMessage,
  quotedSelectionBlock = '',
): QueuedMessageSendPayload {
  const text = message.text.trim()
  const mentions = parseQueuedMessageMentions(text)
  const contextBlocks = [
    message.fileReferenceBlock?.trim(),
    quotedSelectionBlock.trim(),
  ].filter((block): block is string => Boolean(block))
  const prefix = contextBlocks.length > 0
    ? `${contextBlocks.join('\n\n')}\n\n`
    : ''

  return {
    rawText: `${prefix}${expandAgentHistoryQuoteMentions(text)}`.trim(),
    sdkText: `${prefix}${expandAgentHistoryQuoteMentions(mentions.cleanedText)}`.trim(),
    mentions,
  }
}
