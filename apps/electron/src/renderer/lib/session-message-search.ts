import {
  createSearchSnippet,
  MAX_NORMALIZED_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_QUERY_SOURCE_LENGTH,
  findBestSearchMatchInNormalized,
  normalizeSearchText,
} from '@proma/shared'
import type { SessionMessageSearchResponse, SessionMessageSearchResult } from '@proma/shared'

/**
 * 搜索数据源与迷你地图展示解耦：数据源只返回命中元数据，不向 UI 泄露完整历史正文。
 */
export type SessionMessageSearch = (query: string) => Promise<SessionMessageSearchResponse>

export interface LocalSearchRecordInput {
  messageId: string
  role: SessionMessageSearchResult['role']
  text: string
}

export interface LocalSearchRecord extends LocalSearchRecordInput {
  normalizedText: ReturnType<typeof normalizeSearchText>
}

/** 在 Agent 结构快照更新时预计算规范化文本，而不是随每次输入重复规范化全文。 */
export function createLocalSearchRecords(records: readonly LocalSearchRecordInput[]): LocalSearchRecord[] {
  return records.map((record) => ({
    ...record,
    normalizedText: normalizeSearchText(record.text),
  }))
}

/**
 * 在 Agent 已加载的结构化快照中检索全文。
 * 调用方只应在消息结构改变或流式轮次结束时重建 records，避免 token 级的全历史扫描。
 */
export function searchLocalSessionMessages(
  records: readonly LocalSearchRecord[],
  query: string,
  maxResults = 50,
): SessionMessageSearchResponse {
  if (query.length > MAX_SEARCH_QUERY_SOURCE_LENGTH) {
    return { results: [], truncated: false, queryTooLong: true }
  }
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.chars.length < 2) return { results: [], truncated: false, queryTooLong: false }
  if (normalizedQuery.chars.length > MAX_NORMALIZED_SEARCH_QUERY_LENGTH) {
    return { results: [], truncated: false, queryTooLong: true }
  }

  const results: Array<SessionMessageSearchResult & { score: number }> = []
  for (const record of records) {
    const match = findBestSearchMatchInNormalized(record.normalizedText, normalizedQuery)
    if (!match) continue
    const snippet = createSearchSnippet(record.text, match.matchStart, match.matchLength)
    results.push({
      messageId: record.messageId,
      role: record.role,
      ...snippet,
      score: match.score,
    })
  }

  return {
    results: results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ score: _score, ...result }) => result),
    truncated: false,
    queryTooLong: false,
  }
}
