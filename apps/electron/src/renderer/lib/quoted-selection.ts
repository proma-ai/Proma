import type { QuotedSelection, QuotedSelectionSourceType } from '@/atoms/preview-atoms'

export interface ParsedQuotedSelectionRef {
  path: string
  filename: string
  sourceType: QuotedSelectionSourceType
  label?: string
  /** 可恢复定位的 Agent 历史引用元数据。 */
  quote?: QuotedSelection
}

export const SELECTION_ACTION_POPOVER_SELECTOR = '[data-selection-action-popover]'

const QUOTED_FILE_REGEX = /<quoted_file[^>]*>[\s\S]*?<\/quoted_file>(?:\r?\n)*/g
const QUOTED_CONTEXT_REGEX = /<quoted_context[^>]*>[\s\S]*?<\/quoted_context>(?:\r?\n)*/g
const AGENT_HISTORY_QUOTE_MENTION_PREFIX = '&quote:'
const AGENT_HISTORY_QUOTE_MENTION_REGEX = /&quote:[A-Za-z0-9%_.!~*'()-]+/g

type AgentHistoryMessageRole = Exclude<QuotedSelection['messageRole'], undefined>

interface AgentHistoryQuoteMarkerPayload {
  version: 1
  text: string
  sourceLabel: string
  messageId: string
  messageRole?: AgentHistoryMessageRole
  selectionStart?: number
  selectionEnd?: number
  turn?: number
}

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function sanitizeQuotedText(value: string): string {
  return value
    .replace(/<\/quoted_file>/gi, '</quoted_file_>')
    .replace(/<\/quoted_context>/gi, '</quoted_context_>')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isAgentHistoryMessageRole(value: unknown): value is AgentHistoryMessageRole {
  return value === 'user' || value === 'assistant' || value === 'system'
}

type NavigableAgentHistoryQuote = QuotedSelection & {
  sourceType: 'agent-history'
  messageId: string
  selectionStart: number
  selectionEnd: number
  turn: number
}

function isNavigableAgentHistoryQuote(quote: QuotedSelection): quote is NavigableAgentHistoryQuote {
  return quote.sourceType === 'agent-history'
    && isNonEmptyString(quote.text)
    && isNonEmptyString(quote.messageId)
    && isNonNegativeInteger(quote.selectionStart)
    && isNonNegativeInteger(quote.selectionEnd)
    && quote.selectionEnd > quote.selectionStart
    && isPositiveInteger(quote.turn)
}

function parseAgentHistoryQuotePayload(payload: string): QuotedSelection | null {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(payload))
    if (!value || typeof value !== 'object') return null

    const record = value as Record<string, unknown>
    const text = record.text
    const sourceLabel = record.sourceLabel
    const messageId = record.messageId
    const selectionStart = record.selectionStart
    const selectionEnd = record.selectionEnd
    const turn = record.turn
    const messageRole = record.messageRole
    const hasPositionFields = record.selectionStart !== undefined
      || record.selectionEnd !== undefined
      || record.turn !== undefined
    const hasValidPosition = isNonNegativeInteger(selectionStart)
      && isNonNegativeInteger(selectionEnd)
      && selectionEnd > selectionStart
      && isPositiveInteger(turn)

    if (
      record.version !== 1
      || !isNonEmptyString(text)
      || !isNonEmptyString(sourceLabel)
      || !isNonEmptyString(messageId)
      || (hasPositionFields && !hasValidPosition)
      || (messageRole !== undefined && !isAgentHistoryMessageRole(messageRole))
    ) {
      return null
    }

    return {
      text,
      filePath: sourceLabel,
      sourceType: 'agent-history',
      sourceLabel,
      messageId,
      ...(messageRole !== undefined && { messageRole }),
      ...(hasValidPosition && { selectionStart, selectionEnd, turn }),
      capturedAt: 0,
    }
  } catch {
    return null
  }
}

/** 构建内联 Agent 历史引用 chip 的固定展示文案。 */
export function buildAgentHistoryQuoteLabel(quote: Pick<QuotedSelection, 'text' | 'turn'>): string {
  const preview = Array.from(quote.text.replace(/\s+/g, ' ').trim()).slice(0, 25).join('')
  const prefix = isPositiveInteger(quote.turn) ? `第${quote.turn}轮` : '历史引用'
  return `${prefix}：${preview}`
}

/** 将可定位的 Agent 历史选区编码为 TipTap 草稿和队列使用的内联 marker。 */
export function serializeAgentHistoryQuoteMention(quote: QuotedSelection): string | null {
  if (!isNavigableAgentHistoryQuote(quote)) return null

  const payload: AgentHistoryQuoteMarkerPayload = {
    version: 1,
    text: quote.text,
    sourceLabel: quote.sourceLabel?.trim() || quote.filePath,
    messageId: quote.messageId,
    ...(isAgentHistoryMessageRole(quote.messageRole) && { messageRole: quote.messageRole }),
    selectionStart: quote.selectionStart,
    selectionEnd: quote.selectionEnd,
    turn: quote.turn,
  }

  return `${AGENT_HISTORY_QUOTE_MENTION_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`
}

/** 为已发送消息生成展示用历史引用 marker，允许缺少旧版本的定位字段。 */
export function serializeAgentHistoryQuoteDisplayMention(quote: QuotedSelection): string | null {
  if (quote.sourceType !== 'agent-history' || !isNonEmptyString(quote.text) || !isNonEmptyString(quote.messageId)) {
    return null
  }

  const payload: AgentHistoryQuoteMarkerPayload = {
    version: 1,
    text: quote.text,
    sourceLabel: quote.sourceLabel?.trim() || quote.filePath,
    messageId: quote.messageId,
    ...(isAgentHistoryMessageRole(quote.messageRole) && { messageRole: quote.messageRole }),
    ...(isNonNegativeInteger(quote.selectionStart)
      && isNonNegativeInteger(quote.selectionEnd)
      && quote.selectionEnd > quote.selectionStart
      && isPositiveInteger(quote.turn)
      && { selectionStart: quote.selectionStart, selectionEnd: quote.selectionEnd, turn: quote.turn }),
  }

  return `${AGENT_HISTORY_QUOTE_MENTION_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`
}

/** 将历史引用 marker 替换为可复制的 chip 文案，避免把内部 payload 暴露给剪贴板。 */
export function replaceAgentHistoryQuoteMentionsWithLabels(text: string): string {
  return text.replace(AGENT_HISTORY_QUOTE_MENTION_REGEX, (marker) => {
    const quote = parseAgentHistoryQuoteMention(marker)
    return quote ? buildAgentHistoryQuoteLabel(quote) : marker
  })
}

/** 解码单个内联 Agent 历史引用 marker；无效输入保持为普通文本。 */
export function parseAgentHistoryQuoteMention(marker: string): QuotedSelection | null {
  if (!marker.startsWith(AGENT_HISTORY_QUOTE_MENTION_PREFIX)) return null
  const payload = marker.slice(AGENT_HISTORY_QUOTE_MENTION_PREFIX.length)
  if (!payload || /\s/.test(payload)) return null
  return parseAgentHistoryQuotePayload(payload)
}

/** 在真正发送给 Agent 前，将草稿内联 marker 替换为既有 XML 上下文块。 */
export function expandAgentHistoryQuoteMentions(text: string): string {
  return text.replace(AGENT_HISTORY_QUOTE_MENTION_REGEX, (marker) => {
    const quote = parseAgentHistoryQuoteMention(marker)
    if (!quote) return marker
    return buildQuotedSelectionBlock(quote)
  })
}

export function buildQuotedSelectionBlock(quotedSelection: QuotedSelection): string {
  const safeText = sanitizeQuotedText(quotedSelection.text)

  if (quotedSelection.sourceType && quotedSelection.sourceType !== 'file') {
    const safeSource = escapeXmlAttribute(quotedSelection.sourceType)
    const safeLabel = escapeXmlAttribute(quotedSelection.sourceLabel ?? quotedSelection.filePath)
    const safeMessageId = escapeXmlAttribute(quotedSelection.messageId ?? '')
    const safeRole = escapeXmlAttribute(quotedSelection.messageRole ?? '')
    const historyMetadata = quotedSelection.sourceType === 'agent-history'
      && isNonNegativeInteger(quotedSelection.selectionStart)
      && isNonNegativeInteger(quotedSelection.selectionEnd)
      && isPositiveInteger(quotedSelection.turn)
      ? ` turn="${quotedSelection.turn}" selection_start="${quotedSelection.selectionStart}" selection_end="${quotedSelection.selectionEnd}"`
      : ''
    return `<quoted_context source="${safeSource}" label="${safeLabel}" message_id="${safeMessageId}" role="${safeRole}"${historyMetadata}>\n${safeText}\n</quoted_context>\n\n`
  }

  const safePath = escapeXmlAttribute(quotedSelection.filePath)
  return `<quoted_file path="${safePath}">\n${safeText}\n</quoted_file>\n\n`
}

function normalizeContextSourceType(value: string | undefined): QuotedSelectionSourceType {
  if (value === 'scratch-pad') return 'scratch-pad'
  return 'agent-history'
}

export interface ParseQuotedSelectionRefsOptions {
  /** 将 Agent 历史引用保留为展示用 inline mention marker。 */
  inlineAgentHistoryQuotes?: boolean
}

export function parseQuotedSelectionRefs(
  content: string,
  options: ParseQuotedSelectionRefsOptions = {},
): { quotes: ParsedQuotedSelectionRef[]; text: string } {
  const quotes: ParsedQuotedSelectionRef[] = []

  let quoteMatch: RegExpExecArray | null
  QUOTED_FILE_REGEX.lastIndex = 0
  while ((quoteMatch = QUOTED_FILE_REGEX.exec(content)) !== null) {
    const pathMatch = quoteMatch[0].match(/path="([^"]*)"/)
    if (!pathMatch) continue
    const filePath = decodeXmlAttribute(pathMatch[1]!)
    quotes.push({
      path: filePath,
      filename: filePath.split('/').pop() ?? filePath,
      sourceType: 'file',
    })
  }

  const contextQuotes: Array<QuotedSelection | undefined> = []
  QUOTED_CONTEXT_REGEX.lastIndex = 0
  while ((quoteMatch = QUOTED_CONTEXT_REGEX.exec(content)) !== null) {
    const labelMatch = quoteMatch[0].match(/label="([^"]*)"/)
    const sourceMatch = quoteMatch[0].match(/source="([^"]*)"/)
    const messageIdMatch = quoteMatch[0].match(/message_id="([^"]*)"/)
    const roleMatch = quoteMatch[0].match(/role="([^"]*)"/)
    const label = labelMatch ? decodeXmlAttribute(labelMatch[1]!) : 'Agent 历史'
    const sourceType = normalizeContextSourceType(sourceMatch ? decodeXmlAttribute(sourceMatch[1]!) : 'agent-history')
    const quoteBodyMatch = quoteMatch[0].match(/>\r?\n([\s\S]*?)\r?\n<\/quoted_context>/)
    const turnMatch = quoteMatch[0].match(/\bturn="(\d+)"/)
    const selectionStartMatch = quoteMatch[0].match(/\bselection_start="(\d+)"/)
    const selectionEndMatch = quoteMatch[0].match(/\bselection_end="(\d+)"/)
    const turn = turnMatch ? Number(turnMatch[1]) : undefined
    const selectionStart = selectionStartMatch ? Number(selectionStartMatch[1]) : undefined
    const selectionEnd = selectionEndMatch ? Number(selectionEndMatch[1]) : undefined
    const messageId = messageIdMatch ? decodeXmlAttribute(messageIdMatch[1]!) : ''
    const role = roleMatch ? decodeXmlAttribute(roleMatch[1]!) : undefined
    const quote = sourceType === 'agent-history'
      && isNonEmptyString(messageId)
      && quoteBodyMatch
      ? {
          text: quoteBodyMatch[1]!,
          filePath: label,
          sourceType: 'agent-history' as const,
          sourceLabel: label,
          messageId,
          ...(isAgentHistoryMessageRole(role) && { messageRole: role }),
          ...(isPositiveInteger(turn)
            && isNonNegativeInteger(selectionStart)
            && isNonNegativeInteger(selectionEnd)
            && selectionEnd > selectionStart
            ? { selectionStart, selectionEnd, turn }
            : {}),
          capturedAt: 0,
        }
      : undefined
    contextQuotes.push(quote)
    quotes.push({
      path: label,
      filename: label,
      sourceType,
      label,
      ...(quote && { quote }),
    })
  }

  let contextQuoteIndex = 0
  const text = content
    .replace(QUOTED_FILE_REGEX, '')
    .replace(QUOTED_CONTEXT_REGEX, () => {
      const quote = contextQuotes[contextQuoteIndex++]
      if (!options.inlineAgentHistoryQuotes || !quote) return ''
      return serializeAgentHistoryQuoteDisplayMention(quote) ?? ''
    })
    .trim()

  return { quotes, text }
}
