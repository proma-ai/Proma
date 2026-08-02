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
import { join } from 'node:path'
import { homedir } from 'node:os'
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

/** 解析 LLM 配置：优先环境变量，其次项目根 .env，其次 ~/.proma/.env */
export function getMemoryLlmConfig(): MemoryLlmConfig | undefined {
  const envVars = process.env
  const projectEnv = loadDotEnv(join(process.cwd(), '.env'))
  const homeEnv = loadDotEnv(join(homedir(), '.proma', '.env'))

  const apiKey = envVars[CONFIG_KEYS.apiKey] ?? projectEnv[CONFIG_KEYS.apiKey] ?? homeEnv[CONFIG_KEYS.apiKey]
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('在此填入')) return undefined

  const baseUrl = envVars[CONFIG_KEYS.baseUrl] ?? projectEnv[CONFIG_KEYS.baseUrl] ?? homeEnv[CONFIG_KEYS.baseUrl] ?? 'https://api.deepseek.com/v1'
  const model = envVars[CONFIG_KEYS.model] ?? projectEnv[CONFIG_KEYS.model] ?? homeEnv[CONFIG_KEYS.model] ?? 'deepseek-chat'

  return { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
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
