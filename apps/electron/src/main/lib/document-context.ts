import { createHash } from 'node:crypto'

const CHUNK_CHARS = 4_000
const CHUNK_OVERLAP_CHARS = 600
export const DOCUMENT_CONTEXT_MAX_TOKENS = 60_000
// 预留约 2% 给片段编号、XML 包装及 tokenizer 误差。
const DOCUMENT_CONTEXT_MAX_CHARS = Math.floor(DOCUMENT_CONTEXT_MAX_TOKENS * 4 * 0.98)

const chunkCache = new Map<string, string[]>()

function documentKey(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function chunkDocument(text: string): string[] {
  const key = documentKey(text)
  const cached = chunkCache.get(key)
  if (cached) return cached
  const normalized = text.replace(/\r\n/g, '\n').trim()
  const chunks: string[] = []
  for (let start = 0; start < normalized.length; start += CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
    chunks.push(normalized.slice(start, start + CHUNK_CHARS))
  }
  chunkCache.set(key, chunks)
  return chunks
}

function queryTerms(query: string): Set<string> {
  return new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).slice(0, 200))
}

export function retrieveDocumentContext(text: string, query: string): string {
  const terms = queryTerms(query)
  const ranked = chunkDocument(text).map((chunk, index) => {
    const lower = chunk.toLowerCase()
    let score = 0
    for (const term of terms) if (lower.includes(term)) score++
    return { chunk, index, score }
  }).sort((a, b) => b.score - a.score || a.index - b.index)

  const selected: string[] = []
  let chars = 0
  for (const item of ranked) {
    if (chars + item.chunk.length > DOCUMENT_CONTEXT_MAX_CHARS) continue
    selected.push(`[片段 ${item.index + 1}]\n${item.chunk}`)
    chars += item.chunk.length
    if (chars >= DOCUMENT_CONTEXT_MAX_CHARS) break
  }
  return selected.join('\n\n')
}

export function estimatePromptTokens(parts: string[]): number {
  return Math.ceil(parts.reduce((sum, value) => sum + value.length, 0) / 4)
}
