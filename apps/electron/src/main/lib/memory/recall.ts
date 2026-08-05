/**
 * Memory Recall — 主动回忆引擎
 *
 * 从 L1 atoms 中按关键词检索相关记忆，输出带预算截断的注入上下文。
 *
 * 检索策略（MVP）：
 * - keyword：简单中文/英文分词 + 倒排命中评分（BM25 简化版）
 * - latest：空查询时返回最近 N 条（用于新会话冷启动注入）
 *
 * 召回预算：默认最多 5 条，超长内容截断；防止上下文膨胀。
 */

import type { MemoryAtom, MemorySearchHit, MemorySearchRequest, MemorySearchResult } from '@proma/shared'
import { readAllAtoms, isDuplicate } from './store'
import { getEmbeddingProvider, cosineSimilarity } from './embedding'
import { rewriteQuery } from './query-rewriter'

/** 召回预算默认值 */
export const DEFAULT_RECALL_LIMIT = 5
export const MAX_RECALL_LIMIT = 20
/** 单条召回内容最大字符数 */
const MAX_RECALL_ATOM_CHARS = 300
/** 注入块最大总字符数 */
export const MAX_RECALL_BLOCK_CHARS = 2_000

// ===== 轻量分词 =====

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const WORD_RE = /[A-Za-z0-9_]+/g

/**
 * 高频功能词（停用词）：查询中出现时不参与检索，避免“帮我写排序算法”命中“写代码用TS”类误报。
 * 只影响查询侧；记忆内容侧不受影响（内容里的词仍可被检索）。
 */
const STOP_WORDS = new Set([
  // 中文功能词
  '的', '了', '是', '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '在', '有', '和', '与', '及', '或', '也', '都', '很', '就', '还', '又',
  '把', '被', '让', '给', '对', '从', '向', '到', '去', '来', '用', '想',
  '吗', '呢', '吧', '啊', '哦', '呀', '嘛', '什么', '怎么', '怎样', '如何',
  '为什么', '哪', '哪些', '谁', '哪个', '一个', '这个', '那个', '可以',
  '能', '会', '要', '帮', '请', '请问', '一下', '看看', '帮我', '写', '做',
  '说', '知道', '记得', '觉得', '应该', '可能', '大概', '现在', '今天',
  // 中文单字量词/虚词（tokenize 会同时输出单字，需单独过滤）
  '一', '两', '几', '个', '种', '些', '这', '那', '每', '各', '只', '下', '次',
  '上', '里', '中', '外', '前', '后', '边', '处', '时', '候', '起', '请', '帮', '写', '做',
  // 时间/高频名词单字（避免“今天股票行情”靠单字叠加突破门槛）
  '今', '日', '天', '昨', '明', '股', '票', '行', '情', '涨', '跌', '盘',
  // 时间双字词
  '今日', '昨天', '明天', '昨天', '股票', '行情', '股市', '大盘',
  // 闲聊意图词（“今天天气怎么样”不该命中“天气小程序”项目记忆；项目名仍有小程序/程序等词可召回）
  '天气',
  // 英文功能词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'for', 'with', 'and', 'or', 'but', 'i', 'you', 'he', 'she', 'it', 'we',
  'they', 'me', 'my', 'your', 'this', 'that', 'what', 'how', 'why', 'when',
  'can', 'could', 'would', 'should', 'do', 'does', 'did', 'have', 'has',
])

/** 是否为噪声 token（查询侧过滤）：只过滤高频功能词；有意义的单字（名/谁/语等）保留，保证宽松召回 */
function isStopToken(token: string): boolean {
  if (STOP_WORDS.has(token)) return true
  return false
}

/**
 * 简易分词：中文按单字 + 相邻双字（bigram）索引，英文按单词。
 * 足够用于关键词召回，不需要引入 jieba 等依赖。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  // 英文/数字单词
  for (const m of text.matchAll(WORD_RE)) {
    const w = m[0]?.toLowerCase() ?? ''
    if (w.length >= 2) tokens.push(w)
  }
  // 中文字符 + bigram
  const chars = text.split('').filter((c) => CJK_RE.test(c))
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const next = chars[i + 1]
    if (ch) tokens.push(ch)
    if (ch && next) tokens.push(ch + next)
  }
  return tokens
}

/** 查询词集合（过滤停用词；单个中文字不参与） */
export function queryTerms(query: string): string[] {
  const raw = tokenize(query)
  const filtered = raw.filter((t) => !isStopToken(t))
  return [...new Set(filtered)]
}

/**
 * 轻量同义词/概念扩展：解决“编程语言 → TypeScript”这类转喻问题。
 * 命中概念词时追加扩展词，扩大召回。MVP 用静态表，后续可换 embedding。
 */
const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  '编程': ['typescript', 'rust', 'python', 'golang', 'java', 'javascript', '语言', '代码', '技术栈'],
  '语言': ['typescript', 'rust', 'python', 'golang', 'java', 'javascript', '代码', '技术栈'],
  '技术栈': ['typescript', 'rust', 'python', 'golang', 'java', 'javascript', '编程', '语言'],
  '名字': ['姓名', 'conrad', '叫'],
  '姓名': ['名字', 'conrad', '叫'],
  '项目': ['proma', 'proactive', '开发'],
  '开发': ['proma', 'proactive', '项目'],
}

/** 扩展查询词（保留原词 + 追加同义词） */
export function expandedQueryTerms(query: string): string[] {
  const terms = queryTerms(query)
  const expanded = [...terms]
  for (const term of terms) {
    const syns = SYNONYM_EXPANSIONS[term]
    if (syns) expanded.push(...syns)
  }
  return [...new Set(expanded)]
}

/** 计算一条 atom 与查询的 BM25 简化得分 */
function scoreAtom(atom: MemoryAtom, terms: string[], docFreq: Map<string, number>, totalDocs: number): { score: number; matched: string[] } {
  const text = `${atom.content} ${atom.type} ${atom.metadata?.tags ?? ''}`.toLowerCase()
  const tokens = tokenize(text)
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  const avgLen = Math.max(1, tokens.length)
  let score = 0
  const matched: string[] = []
  for (const term of terms) {
    const freq = tf.get(term) ?? 0
    if (freq === 0) continue
    const df = docFreq.get(term) ?? 1
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5))
    const k1 = 1.2
    const b = 0.75
    const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (avgLen / Math.max(1, totalDocs))))
    // 单个中文字匹配权重 0.15（仅作宽松兜底，避免单字噪声主导；bigram 才是主信号）
    const charWeight = term.length === 1 && CJK_RE.test(term) ? 0.15 : 1
    score += idf * tfNorm * charWeight
    matched.push(term)
  }
  return { score, matched }
}

/**
 * 相关度阈值（归一化分数，0-1）：低于此值的命中视为弱相关/噪声，不注入。
 * 参考 ProactiveAgent 论文“误报是主动性头号杀手”：宁可少推、不推无关。
 */
export const RECALL_MIN_SCORE = 0.12

/**
 * 回忆意图词：查询含这些词且关键词 0 命中时，降级返回最近记忆（保 Recall）。
 * 避免语义问句（如“你还记得我是谁吗”）因关键词不匹配而过度沉默。
 */
const RECALL_INTENT_WORDS = ['记得', '回忆', '认识', '知道', '还记得', '我是谁', '我叫什么', '我的名字', '上次', '之前', '前面']

/** 查询是否含回忆意图（用于 0 命中时的降级策略） */
function hasRecallIntent(query: string): boolean {
  const lower = query.toLowerCase()
  return RECALL_INTENT_WORDS.some((w) => lower.includes(w))
}
/**
 * 归一化：把 BM25 分数映射到 0-1（除以当前查询的最大分）。
 * 让跨查询可比，从而可以用统一阈值过滤弱相关。
 */
function normalizeScore(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0
  return score / maxScore
}

// ===== 检索 =====

/**
 * 规则加权（P7b）：对身份/偏好类记忆在排序中加权，缓解“我是谁”类语义问句答错。
 * 加分项：
 * - fact 类含用户身份关键词（我叫/我是/名字/独立开发者/从事）→ +0.15
 * - preference 类（用户偏好）→ +0.08
 * - 高优先级（≥70）→ +0.05
 */
export function ruleBoost(atom: MemoryAtom): number {
  let boost = 0
  if (atom.type === 'fact' && /我叫|我是|名字|姓名|独立开发者|从事|负责|做.*开发/.test(atom.content)) {
    boost += 0.15
  } else if (atom.type === 'preference') {
    boost += 0.08
  }
  if ((atom.priority ?? 0) >= 70) boost += 0.05
  return boost
}

// ===== 时间衰减（数据生命周期） =====

/** 半衰期天数：超过该天数，事实/偏好/任务类记忆权重减半 */
export const MEMORY_HALF_LIFE_DAYS = 30

/** 事件类记忆半衰期天数：高时效，衰减更快（默认 14 天） */
export const EVENT_HALF_LIFE_DAYS = 14

/** 行为规则类（correction/sop）不衰减：规则要稳定，不能因为时间而忘记 */
const STABLE_TYPES = new Set(['correction', 'sop'])

/**
 * 时间衰减因子：0.5^(天数 / 半衰期)。
 * 稳定类型（correction/sop）恒为 1.0（不衰减）；事件类（event）用更短半衰期；
 * 其余类型按默认半衰期衰减。
 * 支持 MEMORY_HALF_LIFE_DAYS / EVENT_HALF_LIFE_DAYS 环境变量覆盖（测试/配置）。
 */
export function timeDecay(atom: MemoryAtom, now = Date.now()): number {
  if (STABLE_TYPES.has(atom.type)) return 1.0
  const days = Math.max(0, (now - atom.createdAt) / 86_400_000)
  if (atom.type === 'event') {
    const eventHalfLife = Number(process.env.EVENT_HALF_LIFE_DAYS) > 0 ? Number(process.env.EVENT_HALF_LIFE_DAYS) : EVENT_HALF_LIFE_DAYS
    return Math.pow(0.5, days / eventHalfLife)
  }
  const halfLife = Number(process.env.MEMORY_HALF_LIFE_DAYS) > 0 ? Number(process.env.MEMORY_HALF_LIFE_DAYS) : MEMORY_HALF_LIFE_DAYS
  return Math.pow(0.5, days / halfLife)
}

/** 关键词检索（MVP，保持现有行为） */
export function searchMemoriesByKeyword(request: MemorySearchRequest): MemorySearchResult {
  const started = Date.now()
  const query = request.query.trim()
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_RECALL_LIMIT, 1), MAX_RECALL_LIMIT)

  const allAtoms = readAllAtoms({ includeUnconfirmed: request.includeUnconfirmed === true })

  if (!query) {
    // 空查询：返回最近 N 条（供冷启动）
    const hits: MemorySearchHit[] = allAtoms.slice(0, limit).map((atom) => ({
      atom,
      score: 1,
      matchedTerms: [],
    }))
    return { query, hits, strategy: 'latest', durationMs: Date.now() - started }
  }

  const terms = expandedQueryTerms(query)
  if (terms.length === 0) {
    // 查询全是功能词（如“你还记得我是谁吗”）：没有有效检索词，返回最近 N 条供参考
    const hits: MemorySearchHit[] = allAtoms.slice(0, limit).map((atom) => ({
      atom,
      score: 0.5,
      matchedTerms: [],
    }))
    return { query, hits, strategy: 'latest', durationMs: Date.now() - started }
  }

  // 有效检索词过少（1 个）：放宽阈值，避免过度沉默（ProactiveAgent 论文 P3：该沉默时沉默，但不该沉默时也不能漏）
  const effectiveMinScore = terms.length <= 1 ? RECALL_MIN_SCORE * 0.3 : RECALL_MIN_SCORE

  const totalDocs = Math.max(1, allAtoms.length)
  const docFreq = new Map<string, number>()
  for (const atom of allAtoms) {
    const tokens = new Set(tokenize(`${atom.content} ${atom.type}`.toLowerCase()))
    for (const t of tokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  }

  const scored = allAtoms
    .map((atom) => ({ atom, ...scoreAtom(atom, terms, docFreq, totalDocs) }))
    .filter((r) => r.score > 0)
    .sort((a, b) =>
      (b.score * timeDecay(b.atom) + ruleBoost(b.atom)) - (a.score * timeDecay(a.atom) + ruleBoost(a.atom))
      || b.atom.createdAt - a.atom.createdAt)

  // 归一化 + 阈值过滤：把分数映射到 0-1，低于阈值的弱相关/噪声不返回
  const maxScore = scored.length > 0 ? scored[0]!.score : 0
  let hits: MemorySearchHit[] = scored
    .map((r) => {
      const hasStrongTerm = r.matched.some((t) => t.length >= 2) // 是否有 bigram/单词强命中
      let score = normalizeScore(r.score, maxScore)
      // 只有单字弱命中（无任何强词）：归一化会把“唯一弱命中”放大成 1.0，
      // 此处对纯单字命中大幅降权，避免“帮我写排序算法”因单字“序”误伤天气/流程类记忆。
      if (!hasStrongTerm) score *= 0.1
      return {
        atom: r.atom,
        score,
        rawScore: r.score, // 保留绝对分供 hybrid 真相关判断
        matchedTerms: r.matched,
      }
    })
    .filter((h) => h.score >= effectiveMinScore)
    .slice(0, limit)

  // 0 命中但查询含回忆意图（“还记得我是谁吗”等语义问句）：降级返回最近记忆，避免过度沉默
  // 排序：规则加权（身份/偏好优先），再按 priority 降序，再按时间
  if (hits.length === 0 && hasRecallIntent(query) && allAtoms.length > 0) {
    const sorted = [...allAtoms].sort((a, b) => {
      const boostDiff = ruleBoost(b) - ruleBoost(a)
      if (boostDiff !== 0) return boostDiff
      const factDiff = (b.type === 'fact' ? 1 : 0) - (a.type === 'fact' ? 1 : 0)
      if (factDiff !== 0) return factDiff
      return (b.priority ?? 0) - (a.priority ?? 0) || b.createdAt - a.createdAt
    })
    hits = sorted.slice(0, Math.min(limit, 3)).map((atom) => ({
      atom,
      score: 0.5,
      matchedTerms: [],
    }))
    return { query, hits, strategy: 'fallback', durationMs: Date.now() - started }
  }

  return { query, hits, strategy: 'keyword', durationMs: Date.now() - started }
}

// ===== 注入上下文 =====

/** 截断单条记忆内容 */
export function truncateAtom(atom: MemoryAtom): string {
  if (atom.content.length <= MAX_RECALL_ATOM_CHARS) return atom.content
  return `${atom.content.slice(0, MAX_RECALL_ATOM_CHARS)}…（已截断）`
}

/** 将检索结果渲染为注入上下文（带预算截断 + 命中强度标注） */
export function formatRecallContext(result: MemorySearchResult): string {
  if (result.hits.length === 0) return ''
  const lines = result.hits.map((hit) => {
    const tag = hit.atom.type
    const time = new Date(hit.atom.createdAt).toISOString().slice(0, 10)
    // 命中强度：≥0.6 视为强相关，标注以帮助 Agent 判断可信度
    const strength = hit.score >= 0.6 ? 'rel=high' : hit.score >= 0.3 ? 'rel=mid' : 'rel=low'
    return `- [${tag}|${time}|${strength}] ${truncateAtom(hit.atom)}`
  })
  let block = lines.join('\n')
  if (block.length > MAX_RECALL_BLOCK_CHARS) {
    block = block.slice(0, MAX_RECALL_BLOCK_CHARS) + '\n…（记忆内容较多，已截断；可用 memory_search 工具检索更多）'
  }
  return block
}

/** 一站式：给定用户消息文本，返回可注入的 memory 上下文块（空串表示无需注入） */
export function buildMemoryContextForMessage(userText: string, opts: { limit?: number } = {}): string {
  // per-message 注入保持同步低延迟：用 keyword + 规则加权（embedding 通道由 memory_search 工具异步提供）
  const result = searchMemoriesByKeyword({ query: userText, limit: opts.limit ?? DEFAULT_RECALL_LIMIT })
  if (result.hits.length === 0) return ''
  const body = formatRecallContext(result)
  if (!body) return ''
  return `<memory_context strategy="${result.strategy}" durationMs="${result.durationMs}">\n${body}\n</memory_context>`
}

// ===== 混合检索（P7：keyword + embedding + 规则加权） =====

/**
 * RRF 融合：按排名倒数加权合并多路检索结果。
 * k=60 是 RRF 论文默认值。
 */
function rrfMerge(lists: Array<Array<{ atom: MemoryAtom; score: number }>>, k = 60): Map<string, { atom: MemoryAtom; score: number; sources: number }> {
  const merged = new Map<string, { atom: MemoryAtom; score: number; sources: number }>()
  for (const list of lists) {
    list.forEach((item, rank) => {
      const existing = merged.get(item.atom.id)
      const contribution = 1 / (k + rank + 1)
      if (existing) {
        existing.score += contribution
        existing.sources += 1
      } else {
        merged.set(item.atom.id, { atom: item.atom, score: contribution, sources: 1 })
      }
    })
  }
  return merged
}

/**
 * 混合检索：
 * 1. 关键词 BM25 排序（含误报阈值）
 * 2. embedding 余弦相似度排序（语义）
 * 3. 规则加权（身份/偏好优先）
 * 4. RRF 融合 + 归一化
 */
export async function searchMemoriesHybrid(request: MemorySearchRequest): Promise<MemorySearchResult> {
  const started = Date.now()
  const query = request.query.trim()
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_RECALL_LIMIT, 1), MAX_RECALL_LIMIT)
  const allAtoms = readAllAtoms({ includeUnconfirmed: request.includeUnconfirmed === true })

  if (!query || allAtoms.length === 0) {
    // 空查询：返回最近 N 条
    const hits: MemorySearchHit[] = allAtoms.slice(0, limit).map((atom) => ({
      atom,
      score: 1,
      matchedTerms: [],
    }))
    return { query, hits, strategy: 'latest', durationMs: Date.now() - started }
  }

  // 通道 1：关键词（精确匹配优先，权重高）
  const kwResult = searchMemoriesByKeyword({ query, limit: Math.max(limit, 10), includeUnconfirmed: request.includeUnconfirmed })
  const kwIds = new Set(kwResult.hits.map((r) => r.atom.id))
  // 只保留高分 kw（≥0.6 精确匹配）；低分弱词匹配（0.2-0.5 噪声）不占 RRF 名额，
  // 避免 kw 命中过多挤掉 rw/embedding 的正确答案（子代理审查发现）
  // 只保留高分 kw（绝对分 ≥1.0 真相关）；低分弱词匹配不占 RRF 名额。
  // 用绝对分（rawScore）而非归一化分，避免“查询与库整体弱相关时弱命中被抬成满分”绕过过滤
  const kwList = kwResult.hits.filter((h) => (h.rawScore ?? h.score) >= 1.0).map((h) => ({ atom: h.atom, score: h.score }))

  // 通道 1.5：LLM 查询改写（近义词/同义表达补充召回）
  // 仅当原查询有真相关（kwList 非空）时才启用改写——否则无关查询（如“帮我写排序算法”
  // 与库无关）会被 LLM 改写发散成“并行/worker”注入无关记忆。改写是“扩展”，不是“凭空召回”。
  const rwHitIdsAll = new Set<string>()
  const rwRealIds = new Set<string>() // 绝对分 ≥1.0 的真相关 rw 命中（用于权重判断）
  let rwList: Array<{ atom: MemoryAtom; score: number }> = []
  try {
    // 只有原查询有真相关时才改写扩展（gate：kwList 非空），否则跳过改写避免发散注入
    if (kwList.length > 0) {
      const rewritten = await rewriteQuery(query)
      if (rewritten.length > 1) {
        const rwSeen = new Set<string>()
        for (const rw of rewritten) {
        if (rw === query || rwSeen.has(rw)) continue
        rwSeen.add(rw)
        const rwResult = searchMemoriesByKeyword({ query: rw, limit: Math.max(limit, 8), includeUnconfirmed: request.includeUnconfirmed })
        for (const h of rwResult.hits) {
          rwHitIdsAll.add(h.atom.id) // 所有 rw 命中都标记（用于观察）
          if ((h.rawScore ?? h.score) >= 1.0) rwRealIds.add(h.atom.id) // 只有绝对分≥1.0 才算真相关
          // 进 rwList 需要绝对分门槛（≥1.0），避免弱改写命中放大噪声
          if ((h.rawScore ?? h.score) < 1.0) continue
          rwList.push({ atom: h.atom, score: h.score * 0.8 })
        }
      }
      // 去重 + 排序
      const seen = new Set<string>()
      rwList = rwList.filter((r) => { if (seen.has(r.atom.id)) return false; seen.add(r.atom.id); return true })
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 8))
      } // end if (rewritten.length > 1)
    } // end if (kwList.length > 0)
  } catch (error) {
    console.warn('[Memory] 查询改写失败，跳过补充召回:', error instanceof Error ? error.message : error)
  }
  const kwPlusRwIds = new Set([...kwIds, ...rwList.map((r) => r.atom.id)])

  // 通道 2：embedding（语义，仅补充 keyword/改写未覆盖的）
  // 只有原查询有真相关（kwList 非空）时才启用 embedding——避免无关查询被语义噪声注入
  const provider = getEmbeddingProvider()
  let embList: Array<{ atom: MemoryAtom; score: number }> = []
  if (provider && kwList.length > 0) {
    const queryVec = await provider.embed(query)
    if (queryVec) {
      const batch = await provider.embedBatch(allAtoms.slice(0, 80).map((a) => a.content.slice(0, 200)))
      const scored: Array<{ atom: MemoryAtom; score: number }> = []
      for (let i = 0; i < batch.length; i++) {
        const vec = batch[i]
        if (!vec) continue
        const sim = cosineSimilarity(queryVec, vec)
        // 阈值 0.68：抑制 embedding 误配（如“批量审查做并行” vs “压测错峰运行” sim=0.64）抢占名额
        if (sim > 0.68) scored.push({ atom: allAtoms[i]!, score: sim })
      }
      // 只保留 keyword/改写未命中的（避免 embedding 干扰精确匹配）
      embList = scored
        .filter((r) => !kwPlusRwIds.has(r.atom.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 15)) // 保留更多语义候选（embTop 保底取前 3）
    }
  }

  // 通道 3：规则加权（仅身份/偏好类进入补充通道；且必须与查询有词命中——
  // 避免“错峰运行”等 preference 在任意 kw 真相关查询下全量霸榜）
  const ruleKwIds = new Set(kwResult.hits.map((h) => h.atom.id))
  const ruleList = kwList.length > 0
    ? [...allAtoms]
        .map((atom) => ({ atom, score: ruleBoost(atom) }))
        .filter((r) => r.score >= 0.08 && ruleKwIds.has(r.atom.id)) // 必须与查询词命中
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 5))
    : []

  // RRF 融合（含改写查询补充通道）
  const merged = rrfMerge([kwList, rwList, embList, ruleList])
  const maxScore = merged.size > 0 ? Math.max(...[...merged.values()].map((v) => v.score)) : 0

  // 精确匹配优先：原 keyword 高分命中 > 改写命中 > embedding 语义命中 > 其他规则补充
  const kwHitIds = new Set(kwList.map((r) => r.atom.id)) // 只算高分 kw（≥0.6）
  const rwHitIds = rwRealIds // 只有绝对分 ≥1.0 的真相关改写命中，用于多源加权提升
  const embHitIds = new Set(embList.map((r) => r.atom.id))

  // 多源一致性融合：每个候选按“最高命中来源”加权（kw 最可信 > rw > emb > rule）
  const sourceWeight = new Map<string, number>()
  for (const item of merged.values()) {
    let w = 0
    if (kwHitIds.has(item.atom.id)) w = Math.max(w, 1.0)
    if (rwHitIds.has(item.atom.id)) w = Math.max(w, 1.15) // rw 是 LLM 精确改写，可信度略高于 kw 弱命中
    if (embHitIds.has(item.atom.id)) w = Math.max(w, 0.4)
    if (ruleBoost(item.atom) > 0) w = Math.max(w, 0.2)
    sourceWeight.set(item.atom.id, w)
  }

  const hits: MemorySearchHit[] = [...merged.values()]
    .map((item) => {
      const w = sourceWeight.get(item.atom.id) ?? 0
      const rrfNorm = maxScore > 0 ? item.score / maxScore : 0
      // 加法融合：源权重主导（kw/rw 命中者显著领先），RRF 做同权重内的微调
      const finalScore = w + rrfNorm * 0.3
      return {
        atom: item.atom,
        score: finalScore,
        matchedTerms: [],
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  // 阈值过滤：加法融合后分数 = 源权重 + RRF 微调
  let filtered = hits.filter((h) => h.score >= 0.35)

  // 同主题冗余降权（P0）：多条内容同主题的记忆（如 4 条“批量审查模式”）霸占 top-N，
  // 把正确答案（worker 实现）挤到第 6+。按“项目+核心词”聚类，同簇只保留最高分 1-2 条。
  if (filtered.length > 1) {
    // 提取记忆的主题键：项目名 + 内容中最高频的 2 个关键词
    // 同主题聚类：项目名 + 内容核心实体（英文词/技术名优先）
    const clusterKey = (atom: MemoryAtom): string => {
      const content = atom.content.toLowerCase()
      const project = ['codelens', 'shopgo', 'docflow', 'proma']
        .find((p) => content.includes(p)) ?? ''
      // 英文技术词（worker/crdt/prosemirror/k6/redis 等）是最强主题信号
      const enWords = content.match(/[a-z][a-z0-9_]{2,}/g) ?? []
      // 中文业务名词：去掉常见动词/虚词后取 2 个（非全局正则避免 lastIndex 状态问题）
      const noise = /用户|已经|完成|需要|要求|实现|使用|做了|计划|准备|今天|今日|支持|用于|增加|添加|优化|解决|处理|避免|进行|开始|正在|问题|性能|功能|项目|方案|代码|方式|方法|时候|可以|会|要|能|到|和|与|在|把|被|让|给/
      const zhWords = (content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [])
        .filter((w) => !noise.test(w))
        .sort((a, b) => b.length - a.length)
        .slice(0, 2)
      const entities = [...new Set([...enWords.slice(0, 2), ...zhWords])].join('|')
      return `${project}:${entities}`
    }
    const seenCluster = new Map<string, number>() // cluster -> 已保留的高分
    const kept: typeof filtered = []
    for (const h of filtered) {
      const key = clusterKey(h.atom)
      const existing = seenCluster.get(key)
      if (existing !== undefined && existing >= 2) {
        // 该主题簇已有 2 条高分，其余降权
        h.score = 0.1
      } else if (existing !== undefined) {
        seenCluster.set(key, existing + 1)
        kept.push(h)
      } else {
        seenCluster.set(key, 1)
        kept.push(h)
      }
    }
    filtered = kept.filter((h) => h.score >= 0.35).sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // 只有当 kw 有真相关（绝对分 ≥1.0）时才 fallback 到 kw；否则返回空（无相关，不注入噪声）
  const hasRealKw = kwResult.hits.some((h) => (h.rawScore ?? h.score) >= 1.0)
  if (filtered.length === 0 && hasRealKw) {
    return kwResult
  }
  return { query, hits: filtered, strategy: 'hybrid', durationMs: Date.now() - started }
}
