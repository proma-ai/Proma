/**
 * Web search/fetch service shared by Chat tools and Agent tools.
 *
 * Tavily provides both search (`/search`) and page extraction (`/extract`).
 * Proma keeps these as app-hosted tools so Agent runtimes can use a stable,
 * provider-agnostic WebSearch/WebFetch surface even when the selected model does
 * not support native hosted web-search tools.
 */

import { getToolCredentials, getToolState } from './chat-tool-config'

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_RESULTS = 5
const MAX_SEARCH_RESULTS = 10
const MAX_FETCH_CHARS = 20_000

type SearchDepth = 'basic' | 'advanced'
type ExtractDepth = 'basic' | 'advanced'

export interface TavilySearchResult {
  title: string
  url: string
  content: string
  score?: number
  raw_content?: string | null
  favicon?: string | null
}

export interface TavilySearchResponse {
  results: TavilySearchResult[]
  answer?: string
  response_time?: number
  request_id?: string
  usage?: { credits?: number }
}

export interface WebSearchOptions {
  query: string
  maxResults?: number
  searchDepth?: SearchDepth
  includeDomains?: string[]
  excludeDomains?: string[]
  signal?: AbortSignal
}

export interface TavilyExtractResult {
  url: string
  raw_content?: string | null
  images?: string[]
  favicon?: string | null
}

export interface TavilyExtractFailedResult {
  url: string
  error?: string
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[]
  failed_results?: TavilyExtractFailedResult[]
  response_time?: number
  request_id?: string
  usage?: { credits?: number }
}

export interface WebFetchOptions {
  url: string
  prompt?: string
  extractDepth?: ExtractDepth
  maxChars?: number
  signal?: AbortSignal
}

export function isWebSearchAvailable(): boolean {
  const credentials = getToolCredentials('web-search')
  return !!credentials.apiKey
}

export function isWebSearchEnabledForAgent(): boolean {
  return getToolState('web-search').enabled && isWebSearchAvailable()
}

function getTavilyApiKey(): string | undefined {
  return getToolCredentials('web-search').apiKey
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function normalizeStringList(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function validateHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('url 不能为空')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`无效 URL: ${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`仅支持 http/https URL: ${rawUrl}`)
  }
  return parsed.toString()
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout:${timeoutMs}`)), timeoutMs)
  const upstreamSignal = init.signal

  const onAbort = (): void => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason)
    else upstreamSignal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', onAbort)
  }
}

async function postTavily<T>(endpoint: string, apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Tavily request failed (${response.status}): ${errorText || response.statusText}`)
  }

  return await response.json() as T
}

export async function searchWeb(options: WebSearchOptions): Promise<TavilySearchResponse> {
  const apiKey = getTavilyApiKey()
  if (!apiKey) throw new Error('搜索工具未配置 Tavily API Key')

  const query = options.query.trim()
  if (!query) throw new Error('query 不能为空')

  const includeDomains = normalizeStringList(options.includeDomains)
  const excludeDomains = normalizeStringList(options.excludeDomains)

  return postTavily<TavilySearchResponse>(TAVILY_SEARCH_URL, apiKey, {
    query,
    search_depth: options.searchDepth ?? 'basic',
    max_results: clampInt(options.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS),
    include_answer: true,
    include_raw_content: false,
    ...(includeDomains ? { include_domains: includeDomains } : {}),
    ...(excludeDomains ? { exclude_domains: excludeDomains } : {}),
  }, options.signal)
}

export async function fetchWebPage(options: WebFetchOptions): Promise<TavilyExtractResponse> {
  const apiKey = getTavilyApiKey()
  if (!apiKey) throw new Error('网页抓取工具未配置 Tavily API Key')

  const url = validateHttpUrl(options.url)
  const prompt = options.prompt?.trim()

  return postTavily<TavilyExtractResponse>(TAVILY_EXTRACT_URL, apiKey, {
    urls: url,
    ...(prompt ? { query: prompt } : {}),
    extract_depth: options.extractDepth ?? 'basic',
    include_images: false,
    include_favicon: true,
    format: 'markdown',
  }, options.signal)
}

export function formatSearchResults(data: TavilySearchResponse): string {
  const parts: string[] = []

  if (data.answer) {
    parts.push(`**概要：** ${data.answer}`)
    parts.push('')
  }

  if (data.results && data.results.length > 0) {
    parts.push('**搜索结果：**')
    for (const [index, result] of data.results.entries()) {
      parts.push(`${index + 1}. [${result.title}](${result.url})`)
      parts.push(`   ${result.content.slice(0, 500)}`)
      if (typeof result.score === 'number') {
        parts.push(`   score: ${result.score.toFixed(3)}`)
      }
      parts.push('')
    }
  } else {
    parts.push('未找到相关结果。')
  }

  return parts.join('\n')
}

export function formatFetchResults(data: TavilyExtractResponse, options: Pick<WebFetchOptions, 'maxChars'> = {}): string {
  const maxChars = clampInt(options.maxChars, MAX_FETCH_CHARS, 1_000, 80_000)
  const parts: string[] = []

  if (data.results && data.results.length > 0) {
    for (const [index, result] of data.results.entries()) {
      const content = (result.raw_content ?? '').trim()
      parts.push(data.results.length > 1 ? `# ${index + 1}. ${result.url}` : `# ${result.url}`)
      parts.push('')
      if (content) {
        const truncated = content.length > maxChars
          ? `${content.slice(0, maxChars)}\n\n[内容过长，已截断至 ${maxChars} 字符]`
          : content
        parts.push(truncated)
      } else {
        parts.push('未提取到正文内容。')
      }
      parts.push('')
    }
  }

  if (data.failed_results && data.failed_results.length > 0) {
    parts.push('## 抓取失败')
    for (const failure of data.failed_results) {
      parts.push(`- ${failure.url}: ${failure.error ?? 'unknown error'}`)
    }
  }

  if (parts.length === 0) return '未提取到网页内容。'
  return parts.join('\n')
}
