import { createHash } from 'node:crypto'
import { countTokens } from '@anthropic-ai/tokenizer'

const CHUNK_MAX_ESTIMATED_TOKENS = 1_100
const CHUNK_OVERLAP_ESTIMATED_TOKENS = 140
const MAX_CACHED_DOCUMENTS = 20

export const DOCUMENT_CONTEXT_MAX_TOKENS = 60_000
export const PROMPT_SAFE_INPUT_TOKENS = 180_000

export interface DocumentContextSource {
  filename: string
  text: string
}

export interface DocumentContextResult {
  content: string
  estimatedTokens: number
  includedDocuments: string[]
  duplicateDocumentsSkipped: number
}

interface DocumentChunk {
  index: number
  text: string
  tokens: number
}

interface RankedChunk extends DocumentChunk {
  documentKey: string
  filename: string
  score: number
}

const chunkCache = new Map<string, DocumentChunk[]>()

function normalizeDocument(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

function documentKey(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 文档全文只做线性、保守估算。官方 tokenizer 仅用于最终入选的最多 60K 上下文，
 * 避免对百万字符 PDF 反复分片计数造成 CPU/内存尖峰。
 */
function conservativeTokenWeight(code: number): number {
  if (code <= 0x20) return 0.12
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
    return 0.34
  }
  if (code <= 0x7f) return 0.65
  if (
    (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
  ) {
    return 1.85
  }
  return 1.35
}

export function estimateDocumentTokensConservatively(text: string): number {
  let tokens = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      tokens += 2.5
      index++
      continue
    }
    tokens += conservativeTokenWeight(code)
  }
  return Math.ceil(tokens)
}

function scanChunkEnd(text: string, start: number, budget: number): number {
  let tokens = 0
  let end = start
  while (end < text.length) {
    const code = text.charCodeAt(end)
    const isSurrogatePair = code >= 0xd800 && code <= 0xdbff && end + 1 < text.length
    const weight = isSurrogatePair ? 2.5 : conservativeTokenWeight(code)
    if (end > start && tokens + weight > budget) break
    tokens += weight
    end += isSurrogatePair ? 2 : 1
  }
  return Math.max(start + 1, end)
}

function preferSentenceBoundary(text: string, start: number, end: number): number {
  if (end >= text.length) return end
  const minimumBoundary = start + Math.floor((end - start) * 0.65)
  const boundary = Math.max(
    text.lastIndexOf('\n', end),
    text.lastIndexOf('。', end),
    text.lastIndexOf('！', end),
    text.lastIndexOf('？', end),
    text.lastIndexOf('. ', end),
  )
  return boundary >= minimumBoundary ? boundary + 1 : end
}

function findOverlapStart(text: string, chunkStart: number, chunkEnd: number): number {
  let tokens = 0
  let start = chunkEnd
  while (start > chunkStart + 1) {
    const previous = start - 1
    const code = text.charCodeAt(previous)
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff && previous > chunkStart
    const nextStart = isLowSurrogate ? previous - 1 : previous
    const weight = isLowSurrogate ? 2.5 : conservativeTokenWeight(code)
    if (tokens + weight > CHUNK_OVERLAP_ESTIMATED_TOKENS) break
    tokens += weight
    start = nextStart
  }
  return start
}

export function chunkDocument(text: string): DocumentChunk[] {
  const normalized = normalizeDocument(text)
  if (!normalized) return []

  const key = documentKey(normalized)
  const cached = chunkCache.get(key)
  if (cached) return cached

  const chunks: DocumentChunk[] = []
  let start = 0
  while (start < normalized.length) {
    const scannedEnd = scanChunkEnd(normalized, start, CHUNK_MAX_ESTIMATED_TOKENS)
    const end = preferSentenceBoundary(normalized, start, scannedEnd)
    const chunkText = normalized.slice(start, end).trim()
    if (chunkText) {
      chunks.push({
        index: chunks.length,
        text: chunkText,
        tokens: estimateDocumentTokensConservatively(chunkText),
      })
    }
    if (end >= normalized.length) break
    start = findOverlapStart(normalized, start, end)
  }

  if (chunkCache.size >= MAX_CACHED_DOCUMENTS) {
    const oldest = chunkCache.keys().next().value
    if (oldest) chunkCache.delete(oldest)
  }
  chunkCache.set(key, chunks)
  return chunks
}

function queryTerms(query: string): string[] {
  const normalized = query.toLowerCase()
  const terms = new Set(normalized.match(/[a-z0-9_-]{2,}/g) ?? [])
  for (const sequence of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    terms.add(sequence)
    for (const size of [4, 3, 2]) {
      for (let index = 0; index + size <= sequence.length && terms.size < 200; index++) {
        terms.add(sequence.slice(index, index + size))
      }
    }
  }
  return [...terms].slice(0, 200)
}

function countOccurrences(text: string, term: string): number {
  let count = 0
  let position = 0
  while (count < 8) {
    position = text.indexOf(term, position)
    if (position < 0) break
    count++
    position += term.length
  }
  return count
}

function rankDocumentChunks(source: DocumentContextSource, terms: string[]): RankedChunk[] {
  const normalized = normalizeDocument(source.text)
  const key = documentKey(normalized)
  const filename = source.filename
  const filenameLower = filename.toLowerCase()

  return chunkDocument(normalized).map((chunk) => {
    const lower = chunk.text.toLowerCase()
    let score = 0
    for (const term of terms) {
      const occurrences = countOccurrences(lower, term)
      if (occurrences > 0) score += 1 + Math.log2(occurrences + 1)
      if (filenameLower.includes(term)) score += 2
    }
    return { ...chunk, documentKey: key, filename, score }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
}

function renderSelectedChunks(chunks: RankedChunk[]): string {
  const byDocument = new Map<string, RankedChunk[]>()
  for (const chunk of chunks) {
    const current = byDocument.get(chunk.documentKey) ?? []
    current.push(chunk)
    byDocument.set(chunk.documentKey, current)
  }

  const rendered: string[] = []
  for (const documentChunks of byDocument.values()) {
    documentChunks.sort((a, b) => a.index - b.index)
    const filename = escapeXmlAttribute(documentChunks[0]?.filename ?? 'document')
    const body = documentChunks
      .map((chunk) => `<chunk index="${chunk.index + 1}">\n${chunk.text}\n</chunk>`)
      .join('\n')
    rendered.push(`<file name="${filename}" mode="retrieved-chunks">\n${body}\n</file>`)
  }
  return rendered.join('\n\n')
}

export function retrieveDocumentContexts(
  sources: DocumentContextSource[],
  query: string,
  maxTokens = DOCUMENT_CONTEXT_MAX_TOKENS,
): DocumentContextResult {
  const uniqueSources: Array<DocumentContextSource & { key: string }> = []
  const seen = new Set<string>()
  let duplicateDocumentsSkipped = 0

  for (const source of sources) {
    const normalized = normalizeDocument(source.text)
    if (!normalized) continue
    const key = documentKey(normalized)
    if (seen.has(key)) {
      duplicateDocumentsSkipped++
      continue
    }
    seen.add(key)
    uniqueSources.push({ ...source, text: normalized, key })
  }

  const terms = queryTerms(query)
  const rankedByDocument = uniqueSources.map((source) => rankDocumentChunks(source, terms))
  const selected: RankedChunk[] = []
  const selectedIds = new Set<string>()
  const usedByDocument = new Map<string, number>()
  const perDocumentLimit = uniqueSources.length > 1 ? Math.floor(maxTokens / 2) : maxTokens
  let usedTokens = 0

  const trySelect = (chunk: RankedChunk): boolean => {
    const id = `${chunk.documentKey}:${chunk.index}`
    if (selectedIds.has(id)) return false
    const documentUsed = usedByDocument.get(chunk.documentKey) ?? 0
    const overhead = 64
    if (documentUsed + chunk.tokens + overhead > perDocumentLimit) return false
    if (usedTokens + chunk.tokens + overhead > maxTokens) return false
    selected.push(chunk)
    selectedIds.add(id)
    usedByDocument.set(chunk.documentKey, documentUsed + chunk.tokens + overhead)
    usedTokens += chunk.tokens + overhead
    return true
  }

  for (const ranked of rankedByDocument) {
    const best = ranked.find((chunk) => chunk.score > 0) ?? ranked[0]
    if (best) trySelect(best)
  }

  const remaining = rankedByDocument.flat().sort((a, b) => b.score - a.score || a.index - b.index)
  for (const chunk of remaining) trySelect(chunk)

  let content = renderSelectedChunks(selected)
  let exactTokens = countTokens(content)
  for (let attempt = 0; selected.length > 0 && exactTokens > maxTokens && attempt < 4; attempt++) {
    const keepCount = Math.max(0, Math.floor(selected.length * maxTokens / exactTokens * 0.96))
    selected.splice(Math.min(keepCount, selected.length - 1))
    content = renderSelectedChunks(selected)
    exactTokens = countTokens(content)
  }
  while (selected.length > 0 && exactTokens > maxTokens) {
    selected.pop()
    content = renderSelectedChunks(selected)
    exactTokens = countTokens(content)
  }

  return {
    content,
    estimatedTokens: exactTokens,
    includedDocuments: [...new Set(selected.map((chunk) => chunk.filename))],
    duplicateDocumentsSkipped,
  }
}

export function retrieveDocumentContext(text: string, query: string): string {
  return retrieveDocumentContexts([{ filename: 'document', text }], query).content
}

export function estimatePromptTokens(parts: string[]): number {
  return countTokens(parts.filter(Boolean).join('\n'))
}
