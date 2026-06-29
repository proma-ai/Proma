import type { TranscriptTurn, TurnRole } from './transcript'

export interface SearchHit {
  index: number
  role: TurnRole
  /** 命中处上下文片段。 */
  snippet: string
  /** 该 turn 内匹配次数。 */
  matchCount: number
}

export interface SearchOptions {
  caseSensitive?: boolean
  /** 片段在命中点前后保留的字符数（默认 60）。 */
  context?: number
  /** 最多返回的命中 turn 数。 */
  limit?: number
}

/**
 * 在转录上做子串搜索（正文 + 工具摘要），返回命中 turn 的下标与片段。
 * Agent 据此再用 selectTurns / export --turns 取命中邻域，避免全量读。
 */
export function searchTurns(turns: TranscriptTurn[], query: string, opts: SearchOptions = {}): SearchHit[] {
  const { caseSensitive = false, context = 60, limit } = opts
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const hits: SearchHit[] = []

  for (const t of turns) {
    const haystackRaw = [t.text, ...t.toolSummaries].join('\n')
    const haystack = caseSensitive ? haystackRaw : haystackRaw.toLowerCase()
    let from = 0
    let matchCount = 0
    let firstIdx = -1
    for (;;) {
      const idx = haystack.indexOf(needle, from)
      if (idx === -1) break
      if (firstIdx === -1) firstIdx = idx
      matchCount++
      from = idx + needle.length
    }
    if (matchCount === 0) continue

    const start = Math.max(0, firstIdx - context)
    const end = Math.min(haystackRaw.length, firstIdx + needle.length + context)
    const snippet =
      (start > 0 ? '…' : '') +
      haystackRaw.slice(start, end).replace(/\s+/g, ' ').trim() +
      (end < haystackRaw.length ? '…' : '')

    hits.push({ index: t.index, role: t.role, snippet, matchCount })
    if (limit && hits.length >= limit) break
  }

  return hits
}
