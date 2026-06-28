import type { TranscriptTurn, TurnRole } from './transcript'

export interface OutlineEntry {
  index: number
  role: TurnRole
  preview: string
  /** assistant 回合的工具摘要计数概览，如 "Read ×3, Bash ×1"。 */
  tools?: string
  tokens: number
}

/** 生成 turn 级地图：每 turn 一行的结构概览，便于 Agent 决定读哪段。 */
export function outline(turns: TranscriptTurn[]): OutlineEntry[] {
  return turns.map((t) => ({
    index: t.index,
    role: t.role,
    preview: t.preview,
    tools: t.toolSummaries.length ? summarizeToolCounts(t.toolSummaries) : undefined,
    tokens: t.tokens,
  }))
}

/** 把工具摘要列表收敛成 "ToolName ×N" 概览（取工具名首词）。 */
function summarizeToolCounts(toolSummaries: string[]): string {
  const counts = new Map<string, number>()
  for (const s of toolSummaries) {
    const m = /^(\S+)(?:.*?×(\d+))?$/.exec(s)
    const name = m?.[1] ?? 'tool'
    const n = m?.[2] ? Number(m[2]) : 1
    counts.set(name, (counts.get(name) ?? 0) + n)
  }
  return [...counts.entries()].map(([name, n]) => `${name} ×${n}`).join(', ')
}

const ROLE_LABEL: Record<TurnRole, string> = { user: '用户', assistant: '助手', system: '系统' }

/** 单行渲染一个 outline 条目。 */
export function formatOutlineLine(e: OutlineEntry): string {
  const head = `#${e.index} ${ROLE_LABEL[e.role]}`
  const body = e.preview ? ` · ${e.preview.replace(/\s+/g, ' ').slice(0, 80)}` : ''
  const tools = e.tools ? ` · [${e.tools}]` : ''
  return `${head}${body}${tools} (~${e.tokens}t)`
}
