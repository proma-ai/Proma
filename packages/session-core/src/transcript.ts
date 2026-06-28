/**
 * 转录层 — 把 MessageGroup[] 规整为带稳定下标的扁平 TranscriptTurn[]，
 * 供 CLI 的 outline / search / select / export 复用。
 *
 * 关键：groupIntoTurns 会把同一回合的多行流式快照都保留在 assistantMessages 中
 * （每行共享同一 message.id，是逐步增长的完整快照）。本层按 message.id 取最后一条
 * （最完整）快照来消除「拼接单字 / 重复段落」，这是会话「快照去重」的落地实现。
 */
import type { SDKAssistantMessage, SDKContentBlock, SDKToolUseBlock } from '@proma/shared'
import { type MessageGroup, extractUserText, getGroupPreview, stripScheduledRunMarker } from './group'
import { estimateTokens } from './tokens'

export type TurnRole = 'user' | 'assistant' | 'system'

export interface TranscriptTurn {
  /** 稳定下标：在 groupIntoTurns 输出中的 0 基位置。outline/search/export 共享。 */
  index: number
  role: TurnRole
  model?: string
  createdAt?: number
  /** 可见正文（thinking 与 tool_result 已丢弃；assistant 多快照已去重）。 */
  text: string
  /** assistant 回合的工具调用摘要，已折叠连续重复为 "name args ×N"。 */
  toolSummaries: string[]
  /** 单行预览（<=200 字）。 */
  preview: string
  /** 近似 token 数（正文 + 工具摘要）。 */
  tokens: number
}

/** 把工具 input 压缩成可读单行摘要：name key=value …（空值跳过，超 80 字符截断）。 */
export function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name
  const parts: string[] = []
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '' ) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    let sv = typeof v === 'string' ? v : JSON.stringify(v)
    sv = sv.replace(/\s+/g, ' ')
    if (sv.length > 80) sv = sv.slice(0, 77) + '...'
    parts.push(`${k}=${sv}`)
  }
  return parts.length ? `${name} ${parts.join(' ')}` : name
}

/** 折叠连续相同的工具摘要为一条，末尾加 ×N。 */
export function collapseToolSummaries(summaries: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < summaries.length) {
    let j = i + 1
    while (j < summaries.length && summaries[j] === summaries[i]) j++
    const count = j - i
    out.push(count === 1 ? summaries[i]! : `${summaries[i]} ×${count}`)
    i = j
  }
  return out
}

/** 按 message.id 取每个逻辑消息的最后一条（最完整）快照，保留首次出现顺序。 */
function dedupSnapshotsByMessageId(messages: SDKAssistantMessage[]): SDKAssistantMessage[] {
  const lastById = new Map<string, SDKAssistantMessage>()
  const order: string[] = []
  let anon = 0
  for (const m of messages) {
    // message.id 在真实 JSONL 中存在（同一回合的多行快照共享它），但 SDK 类型未建模 → 安全读取。
    const id = (m.message as unknown as { id?: string } | undefined)?.id ?? `__anon_${anon++}`
    if (!lastById.has(id)) order.push(id)
    lastById.set(id, m)
  }
  return order.map((id) => lastById.get(id)!)
}

/** 从去重后的 assistant 消息中抽取正文与工具摘要（thinking / tool_result 丢弃）。 */
function buildAssistantContent(messages: SDKAssistantMessage[]): { text: string; toolSummaries: string[] } {
  const texts: string[] = []
  const rawToolSummaries: string[] = []
  for (const m of dedupSnapshotsByMessageId(messages)) {
    const blocks = m.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks as SDKContentBlock[]) {
      if (block.type === 'text' && 'text' in block) {
        const t = (block as { text: string }).text.trim()
        if (t) texts.push(t)
      } else if (block.type === 'tool_use') {
        const tu = block as SDKToolUseBlock
        rawToolSummaries.push(summarizeToolInput(tu.name ?? 'tool', tu.input))
      }
      // thinking / 其他块：丢弃
    }
  }
  return { text: texts.join('\n\n'), toolSummaries: collapseToolSummaries(rawToolSummaries) }
}

/**
 * MessageGroup[] → TranscriptTurn[]（稳定下标）。
 */
export function toTranscript(groups: MessageGroup[]): TranscriptTurn[] {
  return groups.map((group, index) => {
    if (group.type === 'user') {
      const text = stripScheduledRunMarker(extractUserText(group.message) ?? '')
        .replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/g, '')
        .replace(/<quoted_file[^>]*>[\s\S]*?<\/quoted_file>\n*/g, '')
        .trim()
      return {
        index,
        role: 'user' as const,
        createdAt: (group.message as unknown as { _createdAt?: number })._createdAt,
        text,
        toolSummaries: [],
        preview: getGroupPreview(group),
        tokens: estimateTokens(text),
      }
    }
    if (group.type === 'system') {
      const preview = getGroupPreview(group)
      return {
        index,
        role: 'system' as const,
        text: preview,
        toolSummaries: [],
        preview,
        tokens: estimateTokens(preview),
      }
    }
    const { text, toolSummaries } = buildAssistantContent(group.assistantMessages)
    return {
      index,
      role: 'assistant' as const,
      model: group.model,
      createdAt: group.createdAt,
      text,
      toolSummaries,
      preview: getGroupPreview(group),
      tokens: estimateTokens(text + ' ' + toolSummaries.join(' ')),
    }
  })
}
