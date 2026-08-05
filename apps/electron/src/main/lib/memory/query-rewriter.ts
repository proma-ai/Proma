/**
 * Memory Query Rewriter — LLM 查询改写
 *
 * 解决小型 embedding 模型对中文近义词区分度不足的问题：
 * 用户问句（如"ShopGo 订单拆分用什么锁？"）通过 LLM 改写成
 * 2-3 个检索友好的查询（扩展同义词/明确意图），提升召回精度。
 *
 * 设计：
 * - 调 LLM（复用 callLlm），JSON 输出改写查询数组
 * - 缓存：相同 query 短时间不重复改写（LRU，避免每轮都调 LLM）
 * - fail-open：LLM 不可用/失败时返回 [原查询]（不阻塞）
 * - 只用于异步路径（memory_search 工具 / IPC hybrid），per-message 注入保持同步
 */

import { callLlm } from './extractor'

const REWRITE_SYSTEM_PROMPT = `你是检索查询改写器。把用户的自然语言问句改写为 2-3 个检索查询，用于在长期记忆中精确检索。

规则：
1. 输出必须 ONLY 是 JSON 字符串数组，不要任何其他文字、解释或 markdown 围栏。
2. 格式严格如：["分段锁","ShopGo 订单拆分锁"]
3. 改写目标：提取问句中的关键实体 + 同义词/下位词（如"锁"→"分段锁/分布式锁/全局锁"）。
4. 查询要短（3-12 字），直接可检索，不要包含疑问词（什么/怎么/为什么/是否）。
5. 第一个查询保留原问句核心实体，后续查询补充同义/近义/下位词表达。
6. 禁止输出解释性句子，禁止输出"未明确/需更多上下文"之类的内容；只输出查询词。

示例：
用户问：ShopGo 订单拆分用什么锁？
输出：["ShopGo订单拆分锁","订单拆分 分布式锁","分段锁"]`

/** 缓存条目 */
const cache = new Map<string, { queries: string[]; expiresAt: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CACHE_SIZE = 200

/** 解析 LLM 输出为查询数组（容错：剥离围栏 + 从任意文本提取 JSON 数组 + 丢弃解释性句子） */
export function parseRewriteResponse(raw: string): string[] {
  if (!raw) return []
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]?.trim() ?? text
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((q): q is string => typeof q === 'string' && q.trim().length >= 2)
      // 丢弃解释性/模糊输出（LLM 有时会输出“未明确/需更多上下文”而非查询词）
      .filter((q) => !/未明确|需更多|无法|不确定|需要提供/.test(q))
      .map((q) => q.trim())
      .slice(0, 3)
  } catch {
    return []
  }
}

/**
 * 规则同义词补充（LLM 改写失败/不稳定时的稳定兜底）：
 * 从原查询中识别概念词，追加常见同义/下位词，保证近义词召回不依赖 LLM 输出稳定性。
 */
const RULE_SYNONYMS: Array<{ pattern: RegExp; expansions: string[] }> = [
  { pattern: /锁/, expansions: ['分段锁', '分布式锁', '全局锁', '锁类型'] },
  { pattern: /语言|技术栈|用什么(?:语言|技术)/, expansions: ['typescript', 'rust', 'golang', 'python', 'java'] },
  { pattern: /编辑器/, expansions: ['prosemirror', 'editor'] },
  { pattern: /压测|性能测试/, expansions: ['k6', '压测脚本'] },
  { pattern: /缓存/, expansions: ['缓存key', '缓存隔离', 'cache'] },
  { pattern: /并行|并发/, expansions: ['worker', 'worker_threads', '并发控制'] },
  { pattern: /工作习惯|工作方式/, expansions: ['lint', '测试', '提交'] },
  { pattern: /编辑器/, expansions: ['prosemirror', '编辑器'] },
]

/** 规则补充查询词（在 LLM 改写结果上追加） */
export function ruleExpandQuery(query: string): string[] {
  const extra: string[] = []
  for (const { pattern, expansions } of RULE_SYNONYMS) {
    if (pattern.test(query)) {
      extra.push(...expansions)
    }
  }
  return [...new Set(extra)].slice(0, 5)
}

/**
 * 改写用户问句为多个检索查询。
 * 缓存命中直接返回；LLM 失败时用规则同义词兜底（保证稳定）。
 */
export async function rewriteQuery(query: string): Promise<string[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // 缓存命中
  const cached = cache.get(trimmed)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.queries
  }

  // 短查询不值得改写（本身已是检索词）
  if (trimmed.length < 4) return [trimmed]

  // 规则同义词兜底（稳定，不依赖 LLM）
  const ruleExtra = ruleExpandQuery(trimmed)

  try {
    const raw = await callLlm(REWRITE_SYSTEM_PROMPT, trimmed, { temperature: 0.2, maxTokens: 512, timeoutMs: 15_000 })
    const queries = raw ? parseRewriteResponse(raw) : []
    const combined = [...new Set([trimmed, ...queries, ...ruleExtra])].slice(0, 5)
    // 只要有有效查询（原查询 + 至少 1 个补充）就缓存
    if (combined.length > 1) {
      if (cache.size >= MAX_CACHE_SIZE) cache.clear()
      cache.set(trimmed, { queries: combined, expiresAt: Date.now() + CACHE_TTL_MS })
      return combined
    }
    // 完全失败（无任何补充）：返回原查询但不缓存（下次重试）
    return [trimmed]
  } catch {
    // LLM 异常：规则兜底仍有效
    const combined = [...new Set([trimmed, ...ruleExtra])].slice(0, 5)
    return combined.length > 1 ? combined : [trimmed]
  }
}

/** 清空缓存（测试用） */
export function clearRewriteCache(): void {
  cache.clear()
}
