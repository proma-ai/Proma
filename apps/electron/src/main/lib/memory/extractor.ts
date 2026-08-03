/**
 * Memory Extractor — LLM 主动记忆提取
 *
 * 从一段对话消息中提取结构化长期记忆候选（L1 atoms）。
 * 通过 OpenAI 兼容端点调用 LLM，JSON 模式输出，随后由 service 层去重写入。
 *
 * 设计：
 * - 从本地 .env / 环境变量读取 LLM 配置（MEMORY_LLM_*），绝不回显 key
 * - prompt 要求"只写对话中明确出现的"，type 限 fact/preference/correction/sop/todo_context
 * - 输出 JSON 数组 [{ content, type, priority }]
 * - 失败降级：返回空数组（不阻塞主流程）
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { getConfigDir } from '../config-paths'
import type { MemoryCandidate } from '@proma/shared'

// ===== 配置 =====

export interface MemoryLlmConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const CONFIG_KEYS = {
  apiKey: 'MEMORY_LLM_API_KEY',
  baseUrl: 'MEMORY_LLM_BASE_URL',
  model: 'MEMORY_LLM_MODEL',
} as const

/** 读取 .env（简单解析，不引入 dotenv 运行时依赖） */
function loadDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(filePath)) return result
  try {
    const raw = readFileSync(filePath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      let value = trimmed.slice(idx + 1).trim()
      // 去掉可选引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key) result[key] = value
    }
  } catch {
    // 忽略读取失败
  }
  return result
}

function resolveEnv(name: string): string | undefined {
  return process.env[name] ?? undefined
}

/**
 * 沿 cwd 向上查找 .env（最多 MAX_LOOKUP_DEPTH 层）。
 * 覆盖 dev 模式 cwd=apps/electron 但仓库根 .env 在 ProMa/.env 的场景。
 */
export function findDotEnvUpwards(startDir: string): Record<string, string> {
  let dir = startDir
  for (let depth = 0; depth < 5; depth++) {
    const env = loadDotEnv(join(dir, '.env'))
    if (Object.keys(env).length > 0) return env
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

/**
 * 解析 LLM 配置（同源原则）：
 * - 信任源优先级：环境变量 → 项目 .env（沿 cwd 向上查找）→ 配置目录 .env（~/.proma 或 PROMA_CONFIG_DIR）
 * - apiKey 决定主信任源；baseUrl/model 只从主信任源取，绝不跨源混搭
 *   （防止攻击者在启动目录放置仅含 MEMORY_LLM_BASE_URL 的 .env，
 *    与来自 env/home 的真实 apiKey 组合导致 key 外泄）
 * - project 源只有同时提供 apiKey 才整体生效；单独提供 baseUrl 被忽略
 * - baseUrl 仅允许 https（localhost 本地代理例外），异常 URL 视为未配置
 */
export function getMemoryLlmConfig(): MemoryLlmConfig | undefined {
  // 显式禁用（测试隔离 / 用户临时关闭）
  if (process.env.PROMA_MEMORY_LLM_DISABLED === '1') return undefined

  const envVars = process.env
  const projectEnv = findDotEnvUpwards(process.cwd())
  const homeEnv = loadDotEnv(join(getConfigDir(), '.env'))

  const sources: Array<{ name: 'env' | 'project' | 'home'; vars: Record<string, string | undefined> }> = [
    { name: 'env', vars: envVars },
    { name: 'project', vars: projectEnv },
    { name: 'home', vars: homeEnv },
  ]
  return resolveMemoryLlmConfig(sources)
}

/** 同源解析纯函数（可独立测试，不受全局 env 竞态影响） */
export function resolveMemoryLlmConfig(
  sources: Array<{ name: 'env' | 'project' | 'home'; vars: Record<string, string | undefined> }>,
): MemoryLlmConfig | undefined {
  const primary = sources.find((s) => {
    const key = s.vars[CONFIG_KEYS.apiKey]
    return !!key && key.trim() !== '' && !key.includes('在此填入')
  })
  if (!primary) return undefined

  const apiKey = (primary.vars[CONFIG_KEYS.apiKey] ?? '').trim()
  const baseUrlRaw = primary.vars[CONFIG_KEYS.baseUrl]?.trim() || 'https://api.deepseek.com/v1'
  const model = primary.vars[CONFIG_KEYS.model]?.trim() || 'deepseek-chat'

  // baseUrl 安全校验：仅 https，localhost/127.0.0.1 本地代理放行；拒绝用户信息/控制字符/解析失败
  if (!isSafeBaseUrl(baseUrlRaw)) return undefined

  return { apiKey, baseUrl: baseUrlRaw, model }
}

/** baseUrl 安全校验：强制 https；localhost/127.0.0.1/::1 本地代理例外 */
export function isSafeBaseUrl(url: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(url)) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') {
    const host = parsed.hostname
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false
  }
  // 拒绝 URL 中带用户信息（user:pass@host）——防止伪装目标
  if (parsed.username || parsed.password) return false
  return true
}

/** 是否已配置 LLM（供 UI/工具提示） */
export function isMemoryLlmConfigured(): boolean {
  return !!getMemoryLlmConfig()
}

// ===== Prompt =====

const EXTRACT_SYSTEM_PROMPT = `你是长期记忆提取器。从对话中提取值得长期记住的结构化记忆。

规则：
1. 只提取对话中"明确出现"的信息，禁止推测、编造或补充常识。
2. 每条记忆必须自包含、简洁、可独立理解（一句话，通常 10-60 字）。
3. 类型只能是以下之一：
   - fact: 客观事实（用户身份、项目信息、技术选型、环境等）
   - preference: 用户偏好（喜欢的语言/工具/风格/工作方式）
   - correction: 行为纠正（用户指出 Agent 的错误或改进要求）
   - sop: 可复用流程（重复出现的步骤、约定）
   - todo_context: 任务上下文（正在进行或计划的工作）
4. 重要度 priority 0-100：影响后续工作的关键约束给 80+，普通背景 50，琐碎 30 以下。
5. 一条消息最多输出 3 条记忆；无值得记忆的内容时输出空数组。
6. 输出必须是合法 JSON 数组，格式：[{"content": "...", "type": "fact", "priority": 60}]
7. 只输出 JSON 数组本身，不要输出任何解释、前后缀或 markdown 围栏。`

/** 构造提取请求（截断超长输入，避免 token 爆炸） */
export function formatExtractionMessages(messages: Array<{ role: 'user' | 'assistant'; content: string }>, maxMessages = 20): string {
  const recent = messages.slice(-maxMessages)
  const lines = recent.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 800)}`)
  return lines.join('\n')
}

// ===== LLM 调用 =====

/** 从 LLM 响应中解析 JSON 数组（容错：剥离 markdown 围栏） */
export function parseExtractionResponse(raw: string): MemoryCandidate[] {
  if (!raw) return []
  let text = raw.trim()
  // 剥离 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]?.trim() ?? ''
  // 找第一个 [ 到最后一个 ]
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  const jsonStr = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []
    const result: MemoryCandidate[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const content = typeof item.content === 'string' ? item.content.trim() : ''
      if (!content) continue
      const type = ['fact', 'preference', 'correction', 'sop', 'todo_context'].includes(item.type)
        ? item.type as MemoryCandidate['type']
        : 'fact'
      const priority = typeof item.priority === 'number' && Number.isFinite(item.priority)
        ? Math.min(100, Math.max(0, Math.round(item.priority)))
        : 50
      result.push({ content, type, priority })
    }
    return result
  } catch {
    return []
  }
}

/**
 * 通用 LLM 调用（OpenAI 兼容，无 JSON 强制格式，适合 reasoning 模型）。
 * 返回原始 content 文本；失败返回 null（不抛错）。
 */
export async function callLlm(
  systemPrompt: string,
  userText: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const config = getMemoryLlmConfig()
  if (!config) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.warn('[Memory] LLM 请求失败:', response.status, errText.slice(0, 200))
      return null
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? null
  } catch (error) {
    console.warn('[Memory] LLM 调用异常:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 调用 LLM 提取记忆候选。
 * 失败返回空数组（不抛错，保证主流程不中断）。
 */
export async function extractCandidates(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<MemoryCandidate[]> {
  const config = getMemoryLlmConfig()
  if (!config) return []

  const inputText = formatExtractionMessages(messages)
  if (!inputText.trim()) return []

  const raw = await callLlm(EXTRACT_SYSTEM_PROMPT, inputText, { temperature: 0.2, maxTokens: 4096 })
  if (!raw) return []
  const candidates = parseExtractionResponse(raw)
  return candidates.slice(0, 10) // 单次最多 10 条
}

/** 从对话消息批量提取并返回候选（service 层调用入口） */
export async function extractFromMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<MemoryCandidate[]> {
  return extractCandidates(messages)
}
