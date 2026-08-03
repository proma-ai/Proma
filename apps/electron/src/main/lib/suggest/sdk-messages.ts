/**
 * SDK 会话消息文本提取工具
 *
 * 会话 JSONL 持久化为 SDKMessage 格式（`type`/`message.content` 嵌套），
 * 而 `getAgentSessionMessages` 按 AgentMessage（`role`/`content` 平铺）解析，
 * 返回的对象实际是 SDK 结构，`m.role`/`m.content` 均不存在。
 *
 * 本工具用 `getAgentSessionSDKMessages`（内部 normalize 到 SDKMessage 类型）
 * 读取会话，并提取 user/assistant 的纯文本消息，供记忆捕获 / 建议引擎使用。
 */

import type { SDKMessage } from '@proma/shared'

/** 从 SDK 内容块中提取纯文本 */
export function sdkBlockText(block: unknown): string {
  if (!block || typeof block !== 'object') return ''
  const b = block as { type?: string; text?: string; content?: unknown }
  if (b.type === 'text' && typeof b.text === 'string') return b.text
  return ''
}

/** 从 SDKMessage 中提取 user/assistant 纯文本（跳过 tool_use/tool_result/thinking 等非文本） */
export function sdkMessageText(msg: SDKMessage): string | null {
  const m = msg as unknown as {
    type?: string
    message?: { content?: unknown }
    content?: unknown
  }

  if (m.type !== 'user' && m.type !== 'assistant') return null

  const content = m.message?.content
  if (!content) return null

  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    const parts = content.map(sdkBlockText).filter((t) => t.length > 0)
    if (parts.length === 0) return null
    return parts.join('\n')
  }

  return null
}

/** 从 SDKMessage 列表提取最近的 user/assistant 文本消息（按时间序） */
export function extractRecentConversationText(
  messages: SDKMessage[],
  limit = 30,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const msg of messages) {
    const text = sdkMessageText(msg)
    if (!text || text.trim().length === 0) continue
    const role = (msg as unknown as { type?: string }).type
    if (role !== 'user' && role !== 'assistant') continue
    result.push({ role, content: text })
  }
  return result.slice(-limit)
}
