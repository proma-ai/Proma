import type { QuotedSelection } from '@/atoms/preview-atoms'

export const INSERT_AGENT_INPUT_QUOTE_EVENT = 'proma:insert-agent-input-quote'

interface InsertAgentInputQuoteDetail {
  sessionId: string
  quote: QuotedSelection
  inserted: boolean
}

/**
 * 请求指定 Agent 输入框插入一个可累积的选区 chip。
 * 事件同步分发，由持有 RichTextInput ref 的 AgentView 回写 inserted，调用者可安全决定是否降级。
 */
export function insertAgentInputQuote(sessionId: string, quote: QuotedSelection): boolean {
  const detail: InsertAgentInputQuoteDetail = { sessionId, quote, inserted: false }
  window.dispatchEvent(new CustomEvent<InsertAgentInputQuoteDetail>(INSERT_AGENT_INPUT_QUOTE_EVENT, { detail }))
  return detail.inserted
}

export type { InsertAgentInputQuoteDetail }
