/**
 * Agent 会话上下文提取模块
 *
 * 从 SDKMessage 数组中提取干净对话内容，过滤流式噪声，
 * 产出紧凑格式文本供直接注入 LLM 上下文。
 *
 * 清洗规则：
 * - 过滤 thinking 块、tool_result 块
 * - 工具调用压缩为 `[工具: name key=val]` 单行
 * - 连续相同工具调用合并为 ×N
 * - 超长文本截断（50K 字符/段）
 */

import type { SDKMessage, SDKAssistantMessage, SDKUserMessage } from '@proma/shared'

const TOOL_PARAM_MAX_LEN = 80
const MAX_TEXT_LEN = 50000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAssistant(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === 'assistant'
}

function isUser(msg: SDKMessage): msg is SDKUserMessage {
  return msg.type === 'user'
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    const sv = typeof v === 'object' ? JSON.stringify(v) : String(v)
    const truncated = sv.length > TOOL_PARAM_MAX_LEN ? `${sv.slice(0, 77)}...` : sv
    parts.push(`${k}=${truncated}`)
  }
  return parts.length === 0 ? name : `${name} ${parts.join(' ')}`
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface Turn {
  type: 'user' | 'assistant' | 'tool'
  text: string
}

function extractUserTurns(msg: SDKUserMessage): Turn[] {
  const turns: Turn[] = []
  const content = msg.message?.content
  if (!Array.isArray(content)) return turns
  for (const blk of content) {
    if (!blk || typeof blk !== 'object') continue
    const block = blk as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim()
      if (text) turns.push({ type: 'user', text })
    }
  }
  return turns
}

function extractAssistantTurns(msg: SDKAssistantMessage): Turn[] {
  const turns: Turn[] = []
  const content = msg.message?.content
  if (!Array.isArray(content)) return turns
  for (const blk of content) {
    if (!blk || typeof blk !== 'object') continue
    const block = blk as Record<string, unknown>
    if (block.type === 'thinking') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim()
      if (text) turns.push({ type: 'assistant', text })
      continue
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool'
      const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>
      turns.push({ type: 'tool', text: summarizeToolInput(name, input) })
    }
  }
  if (msg.error?.message) {
    turns.push({ type: 'assistant', text: `[错误] ${msg.error.message}` })
  }
  return turns
}

function collapseTools(turns: Turn[]): Turn[] {
  const out: Turn[] = []
  let i = 0
  while (i < turns.length) {
    const t = turns[i]!
    if (t.type !== 'tool') { out.push(t); i++; continue }
    let j = i + 1
    while (j < turns.length && turns[j]!.type === 'tool' && turns[j]!.text === t.text) j++
    const count = j - i
    out.push(count === 1 ? t : { ...t, text: `${t.text} ×${count}` })
    i = j
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 从 SDKMessage 数组提取紧凑上下文文本。
 *
 * 纯函数，无 I/O——可直接注入 resultSummary 供父会话消费。
 *
 * @param messages SDK 消息数组
 * @param meta 可选的标题/目标元数据
 * @returns 清洗后的紧凑格式文本，无有效内容时返回空字符串
 */
export function extractContextText(
  messages: SDKMessage[],
  meta?: { title?: string; goal?: string },
): string {
  const turns: Turn[] = []
  for (const msg of messages) {
    if (isUser(msg)) turns.push(...extractUserTurns(msg))
    else if (isAssistant(msg)) turns.push(...extractAssistantTurns(msg))
  }
  if (turns.length === 0) return ''

  const collapsed = collapseTools(turns)
  const lines: string[] = []

  if (meta?.title) {
    lines.push(`# 子任务结果: ${meta.title}`)
    if (meta.goal) lines.push(`> ${meta.goal}`)
    lines.push('')
  }

  let lastType = ''
  for (const t of collapsed) {
    if (t.type === 'user') {
      if (lastType !== '' && lastType !== 'user') lines.push('')
      lastType = 'user'
      const txt = t.text.length > MAX_TEXT_LEN
        ? t.text.slice(0, MAX_TEXT_LEN) + '\n[截断]'
        : t.text
      lines.push(`**用户:** ${txt}`)
    } else if (t.type === 'assistant') {
      if (lastType !== '' && lastType !== 'assistant' && lastType !== 'tool') lines.push('')
      lastType = 'assistant'
      const txt = t.text.length > MAX_TEXT_LEN
        ? t.text.slice(0, MAX_TEXT_LEN) + '\n[截断]'
        : t.text
      lines.push(`**助手:** ${txt}`)
    } else if (t.type === 'tool') {
      lastType = 'tool'
      lines.push(`[工具: ${t.text}]`)
    }
  }

  return lines.join('\n')
}
