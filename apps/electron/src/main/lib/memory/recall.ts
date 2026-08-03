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
import { readAllAtoms } from './store'
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
    .sort((a, b) => (b.score + ruleBoost(b.atom)) - (a.score + ruleBoost(a.atom)) || b.atom.createdAt - a.atom.createdAt)

  // 归一化 + 阈值过滤：把分数映射到 0-1，低于阈值的弱相关/噪声不返回
  const maxScore = scored.length > 0 ? scored[0]!.score : 0
  let hits: MemorySearchHit[] = scored
    .map((r) => ({
      atom: r.atom,
      score: normalizeScore(r.score, maxScore),
      matchedTerms: r.matched,
    }))
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
  const kwList = kwResult.hits.map((h) => ({ atom: h.atom, score: h.score }))
  const kwIds = new Set(kwList.map((r) => r.atom.id))

  // 通道 1.5：LLM 查询改写（近义词/同义表达补充召回，解决小模型区分度不足）
  let rwList: Array<{ atom: MemoryAtom; score: number }> = []
  try {
    const rewritten = await rewriteQuery(query)
    if (rewritten.length > 1) {
      const rwSeen = new Set<string>()
      for (const rw of rewritten) {
        if (rw === query || rwSeen.has(rw)) continue
        rwSeen.add(rw)
        const rwResult = searchMemoriesByKeyword({ query: rw, limit: Math.max(limit, 8), includeUnconfirmed: request.includeUnconfirmed })
        for (const h of rwResult.hits) {
          if (kwIds.has(h.atom.id)) continue // 原 keyword 已命中，不重复
          rwList.push({ atom: h.atom, score: h.score * 0.8 }) // 改写命中权重略低于原查询
        }
      }
      // 去重 + 排序
      const seen = new Set<string>()
      rwList = rwList.filter((r) => { if (seen.has(r.atom.id)) return false; seen.add(r.atom.id); return true })
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 8))
    }
  } catch (error) {
    console.warn('[Memory] 查询改写失败，跳过补充召回:', error instanceof Error ? error.message : error)
  }
  const kwPlusRwIds = new Set([...kwIds, ...rwList.map((r) => r.atom.id)])

  // 通道 2：embedding（语义，仅补充 keyword/改写未覆盖的）
  const provider = getEmbeddingProvider()
  let embList: Array<{ atom: MemoryAtom; score: number }> = []
  if (provider) {
    const queryVec = await provider.embed(query)
    if (queryVec) {
      const batch = await provider.embedBatch(allAtoms.slice(0, 80).map((a) => a.content.slice(0, 200)))
      const scored: Array<{ atom: MemoryAtom; score: number }> = []
      for (let i = 0; i < batch.length; i++) {
        const vec = batch[i]
        if (!vec) continue
        const sim = cosineSimilarity(queryVec, vec)
        if (sim > 0.6) scored.push({ atom: allAtoms[i]!, score: sim })
      }
      // 只保留 keyword/改写未命中的（避免 embedding 干扰精确匹配）
      embList = scored
        .filter((r) => !kwPlusRwIds.has(r.atom.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(limit, 15)) // 保留更多语义候选（embTop 保底取前 3）
    }
  }

  // 通道 3：规则加权（仅身份/偏好类进入补充通道；priority 加成在排序时体现，不膨胀通道）
  const ruleList = [...allAtoms]
    .map((atom) => ({ atom, score: ruleBoost(atom) }))
    .filter((r) => r.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit, 10))

  // RRF 融合（含改写查询补充通道）
  const merged = rrfMerge([kwList, rwList, embList, ruleList])
  const maxScore = merged.size > 0 ? Math.max(...[...merged.values()].map((v) => v.score)) : 0

  // 精确匹配优先：原 keyword 命中 > 改写命中 > embedding 语义命中 > 其他规则补充
  // embedding 命中的（kw/rw 未覆盖的语义相关）全部作为高价值候选，避免被 RRF 稀释
  const kwHitIds = new Set(kwResult.hits.map((h) => h.atom.id))
  const rwHitIds = new Set(rwList.map((r) => r.atom.id))
  const embHitIds = new Set(embList.map((r) => r.atom.id))
  const sortedMerged = [...merged.values()]
    .sort((a, b) => {
      const rankOf = (item: { atom: MemoryAtom }): number =>
        kwHitIds.has(item.atom.id) ? 0
          : rwHitIds.has(item.atom.id) ? 1
            : embHitIds.has(item.atom.id) ? 2
              : 3
      const aRank = rankOf(a)
      const bRank = rankOf(b)
      if (aRank !== bRank) return aRank - bRank
      return b.score - a.score
    })

  // 精确优先但不过度：keyword 命中过多时会挤掉改写/embedding 补充。
  // 策略：先取 kw 前 (limit-2)，再补 rw/emb 前 2（保证语义补充有机会进）
  const kwItems = sortedMerged.filter((item) => kwHitIds.has(item.atom.id))
  const supplementItems = sortedMerged.filter((item) => !kwHitIds.has(item.atom.id))
  const pooled = [...kwItems.slice(0, Math.max(0, limit - 2)), ...supplementItems.slice(0, 2)]
    .sort((a, b) => b.score - a.score)

  const hits: MemorySearchHit[] = pooled
    .slice(0, limit)
    .map((item) => ({
      atom: item.atom,
      score: maxScore > 0 ? item.score / maxScore : 0,
      matchedTerms: [],
    }))

  // 阈值过滤（比 keyword 略低，因为 RRF 分数普遍偏低）
  const filtered = hits.filter((h) => h.score >= (RECALL_MIN_SCORE * 0.6))
  if (filtered.length === 0 && kwResult.hits.length > 0) {
    return kwResult
  }
  return { query, hits: filtered, strategy: 'hybrid', durationMs: Date.now() - started }
}
