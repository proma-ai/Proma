/** 标题生成 Prompt */
export const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。\n\n用户消息：'

/** 短消息阈值：低于此长度直接使用原文作为标题 */
export const SHORT_MESSAGE_THRESHOLD = 4

/** 最大标题长度 */
export const MAX_TITLE_LENGTH = 20

const TITLE_PUNCTUATION = /^["'“”‘’「《]+|["'“”‘’」》]+$/g
const MARKDOWN_PREFIX = /^(?:[#>*\-\d.)]\s*)+/
const WHITESPACE = /\s+/g

/** 清理模型返回的标题。 */
export function sanitizeGeneratedTitle(title: string): string | null {
  const cleaned = title.trim().replace(TITLE_PUNCTUATION, '').trim()
  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}

/** Codex OAuth 会话的标题来源。无 Proma Cloud 凭据时不能调用标题模型。 */
export function resolveCodexTitleSource(hasPromaAuthToken: boolean): 'proma' | 'fallback' {
  return hasPromaAuthToken ? 'proma' : 'fallback'
}

/**
 * 无法调用标题模型时，基于首条用户消息生成一个稳定兜底标题。
 */
export function createFallbackTitle(userMessage: string): string | null {
  const firstLine = userMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?? userMessage.trim()

  const cleaned = firstLine
    .replace(MARKDOWN_PREFIX, '')
    .replace(WHITESPACE, ' ')
    .trim()

  return cleaned.slice(0, MAX_TITLE_LENGTH) || null
}
