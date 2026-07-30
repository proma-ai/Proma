import type { QuotedSelection } from '@/atoms/preview-atoms'

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
export type QueuedMessageReferenceType = 'file' | 'skill' | 'mcp' | 'session' | 'todo' | 'calendar_event'

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
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}


const REF_PATTERN = /\/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)\S+)?/g
const DISPLAY_REFERENCE_PATTERN = /@file:(?<file>\S+)|\/skill:(?<skill>\S+)|#mcp:(?<mcp>\S+)|&session:(?<session>[A-Za-z0-9-]+)(?:(?:~|::)(?<sessionLabel>\S+))?|&todo:(?<todo>[A-Za-z0-9-]+)(?:(?:~|::)(?<todoLabel>\S+))?|&calendar_event:(?<calendarEvent>[A-Za-z0-9-]+)(?:(?:~|::)(?<calendarEventLabel>\S+))?/g

function decodeReferenceLabel(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 将排队消息中的文件、Skill、MCP、会话和规划协议转换为展示片段。
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
    cleanedText: text.replace(REF_PATTERN, '').trim(),
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
    rawText: `${prefix}${text}`.trim(),
    sdkText: `${prefix}${mentions.cleanedText}`.trim(),
    mentions,
  }
}
