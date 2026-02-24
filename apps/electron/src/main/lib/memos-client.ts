/**
 * MemOS Cloud HTTP 客户端
 *
 * 主进程内直接调用 MemOS Cloud API，替代外部 MCP 进程。
 * 提供 searchMemory（搜索记忆）和 addMemory（存储记忆）两个核心方法。
 */

const DEFAULT_BASE_URL = 'https://memos.memtensor.cn/api/openmem/v1'
const TIMEOUT_MS = 8000
const RETRIES = 1

/** 记忆凭据 */
export interface MemosCredentials {
  apiKey: string
  userId: string
  baseUrl?: string
}

/** 搜索记忆的结果 */
export interface MemorySearchResult {
  facts: Array<{
    id: string
    text: string
    createTime?: string
    confidence?: number
  }>
  preferences: Array<{
    id: string
    text: string
    type?: string
  }>
}

// ===== 内部工具函数 =====

async function callApi(
  credentials: MemosCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!credentials.apiKey) throw new Error('MEMOS_API_KEY not set')

  const baseUrl = credentials.baseUrl || DEFAULT_BASE_URL
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${credentials.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return await res.json()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
    }
  }
  throw lastError
}

function extractData(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const data = r.data as Record<string, unknown> | undefined
  return data ?? null
}

// ===== 公开 API =====

/**
 * 搜索记忆
 *
 * 根据查询文本搜索相关的事实记忆和偏好记忆。
 */
export async function searchMemory(
  credentials: MemosCredentials,
  query: string,
  limit = 6,
): Promise<MemorySearchResult> {
  const result = await callApi(credentials, '/search/memory', {
    user_id: credentials.userId,
    query,
    source: 'proma',
    memory_limit_number: limit,
    include_preference: true,
    preference_limit_number: limit,
  })

  const data = extractData(result)
  if (!data) return { facts: [], preferences: [] }

  const memories = (data.memory_detail_list as Array<Record<string, unknown>>) ?? []
  const prefs = (data.preference_detail_list as Array<Record<string, unknown>>) ?? []

  return {
    facts: memories.map((item) => ({
      id: String(item.id ?? ''),
      text: String(item.memory_value || item.memory_key || ''),
      createTime: item.create_time ? String(item.create_time) : undefined,
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
    })).filter((f) => f.text),
    preferences: prefs.map((item) => ({
      id: String(item.id ?? ''),
      text: String(item.preference || ''),
      type: item.preference_type ? String(item.preference_type) : undefined,
    })).filter((p) => p.text),
  }
}

/**
 * 格式化搜索结果为文本（供工具返回给 agent）
 */
export function formatSearchResult(result: MemorySearchResult): string {
  const lines: string[] = []

  if (result.facts.length > 0) {
    lines.push('## Facts')
    for (const item of result.facts) {
      const time = item.createTime ? new Date(item.createTime).toLocaleString() : ''
      lines.push(time ? `- [${time}] ${item.text}` : `- ${item.text}`)
    }
  }

  if (result.preferences.length > 0) {
    lines.push('\n## Preferences')
    for (const item of result.preferences) {
      lines.push(item.type ? `- (${item.type}) ${item.text}` : `- ${item.text}`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No memories found.'
}

/**
 * 存储记忆
 *
 * 将对话消息存入 MemOS Cloud，由后端异步提取记忆。
 */
export async function addMemory(
  credentials: MemosCredentials,
  params: {
    userMessage: string
    assistantMessage?: string
    conversationId?: string
    tags?: string[]
  },
): Promise<void> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: params.userMessage },
  ]
  if (params.assistantMessage) {
    messages.push({ role: 'assistant', content: params.assistantMessage })
  }

  await callApi(credentials, '/add/message', {
    user_id: credentials.userId,
    conversation_id: params.conversationId || `proma-${Date.now()}`,
    messages,
    source: 'proma',
    tags: params.tags ?? ['proma'],
    async_mode: true,
    info: { source: 'proma-builtin' },
  })
}
