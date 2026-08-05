/**
 * Suggestion 反馈层 — 频率学习 + 持久化
 *
 * 用户三态反馈 → 类型权重调节（"越用越好用"的机制）：
 * - accepted：weight × 1.2（上限 2.0），同类建议更容易出现
 * - ignored：weight × 0.8（下限 0.2），同类建议收敛
 * - never：该 duplicateKey 永久屏蔽 + 类型 weight × 0.5
 * 连续忽略 N 次后该类型自动静默（P9 时机学习的简化落地）。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'
import { getSuggestionsPath } from '../config-paths'
import type { SuggestionsIndex, SuggestionTypeWeights, SuggestionDndConfig, SuggestionAnalysisState } from './types'
import { DEFAULT_DND_CONFIG } from './types'
import type {
  SuggestionCandidate,
  SuggestionFeedback,
  SuggestionKind,
  SuggestionRecord,
} from '@proma/shared'
import { defaultTypeWeights } from './engine'

const INDEX_VERSION = 1

/** 建议记录容量上限（防止文件无限膨胀/性能 DoS） */
const MAX_RECORDS = 500

/** 连续忽略达到该次数后，类型自动静默（跳过评估） */
export const SILENCE_AFTER_IGNORES = 3

// ===== 内存缓存 =====

let cachedIndex: SuggestionsIndex | null = null

function readIndex(): SuggestionsIndex {
  if (cachedIndex) return cachedIndex

  const data = readJsonFileSafe<SuggestionsIndex>(getSuggestionsPath())
  if (!data) {
    cachedIndex = { version: INDEX_VERSION, records: [], typeWeights: defaultTypeWeights(), enabled: true }
    return cachedIndex
  }
  // 兼容旧格式：补齐缺省字段
  if (!data.typeWeights || typeof data.typeWeights !== 'object') data.typeWeights = defaultTypeWeights()
  if (typeof data.enabled !== 'boolean') data.enabled = true
  if (!Array.isArray(data.records)) data.records = []
  // DND 缺省：关闭
  if (!data.dnd || typeof data.dnd !== 'object') data.dnd = { ...DEFAULT_DND_CONFIG }
  // 分析状态缺省：尚未运行；读取时只保留白名单状态与有限字段。
  data.analysis = sanitizeAnalysisState(data.analysis)
  // schema 校验：过滤非法记录，截断超长字段，限制数量上限
  data.records = data.records.filter(isValidSuggestionRecord).map(sanitizeSuggestionRecord).slice(0, MAX_RECORDS)
  cachedIndex = data
  return cachedIndex
}

/** 合法建议记录：必须有 id、createdAt、title，status 为已知枚举 */
function isValidSuggestionRecord(r: unknown): r is SuggestionRecord {
  if (!r || typeof r !== 'object') return false
  const rec = r as Record<string, unknown>
  return (
    typeof rec.id === 'string' && rec.id.length > 0 &&
    typeof rec.createdAt === 'number' &&
    typeof rec.title === 'string' &&
    (rec.status === 'suggested' || rec.status === 'accepted' || rec.status === 'ignored' || rec.status === 'never')
  )
}

/** 截断超长字段，防膨胀 */
function sanitizeSuggestionRecord(r: SuggestionRecord): SuggestionRecord {
  return {
    ...r,
    title: r.title.slice(0, 200),
    reason: r.reason?.slice(0, 500),
    evidence: r.evidence?.slice(0, 500),
    duplicateKey: r.duplicateKey?.slice(0, 200),
  }
}

function sanitizeAnalysisState(value: unknown): SuggestionAnalysisState {
  if (!value || typeof value !== 'object') return { status: 'idle' }
  const raw = value as Record<string, unknown>
  const validStatuses = new Set<SuggestionAnalysisState['status']>(['idle', 'running', 'succeeded', 'empty', 'unavailable', 'failed'])
  const status = typeof raw.status === 'string' && validStatuses.has(raw.status as SuggestionAnalysisState['status'])
    ? raw.status as SuggestionAnalysisState['status']
    : 'idle'
  return {
    status,
    ...(typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.completedAt === 'number' && Number.isFinite(raw.completedAt) ? { completedAt: raw.completedAt } : {}),
    ...(typeof raw.added === 'number' && Number.isInteger(raw.added) && raw.added >= 0 && raw.added <= 3 ? { added: raw.added } : {}),
    ...(typeof raw.message === 'string' && raw.message.length <= 200 ? { message: raw.message } : {}),
  }
}

function writeIndex(): void {
  if (!cachedIndex) return
  cachedIndex.version = INDEX_VERSION
  // 确保父目录存在（配置目录可能尚未创建）
  mkdirSync(dirname(getSuggestionsPath()), { recursive: true })
  writeJsonFileAtomic(getSuggestionsPath(), cachedIndex)
}

/** 测试/调试用：重置缓存（bun test 隔离） */
export function resetSuggestionsCache(): void {
  cachedIndex = null
}

/** 读取当前索引（供 engine/service 使用） */
export function readSuggestionsIndex(): SuggestionsIndex {
  return readIndex()
}

/** 设置内存缓存（测试注入） */
export function setSuggestionsIndexForTest(index: SuggestionsIndex): void {
  cachedIndex = index
}

// ===== 对外 API =====

export function suggestionsEnabled(): boolean {
  return readIndex().enabled
}

export function setSuggestionsEnabled(enabled: boolean): void {
  const index = readIndex()
  index.enabled = enabled
  writeIndex()
}

/** 读取最近一次工作模式分析状态；崩溃遗留的 running 状态自动标为未完成。 */
export function getAnalysisState(): SuggestionAnalysisState {
  const state = { ...(readIndex().analysis ?? { status: 'idle' }) }
  if (state.status === 'running' && (!state.startedAt || Date.now() - state.startedAt > 120_000)) {
    const recovered: SuggestionAnalysisState = {
      status: 'failed',
      startedAt: state.startedAt,
      completedAt: Date.now(),
      message: '上次分析未完成，请重新运行',
    }
    setAnalysisState(recovered)
    return recovered
  }
  return state
}

/** 持久化分析状态，供用户在离开主动中心后仍能追溯结果。 */
export function setAnalysisState(state: SuggestionAnalysisState): void {
  const index = readIndex()
  index.analysis = { ...state }
  writeIndex()
}

/** 记录一条候选为待展示建议 */
export function persistSuggestion(candidate: SuggestionCandidate, sessionId?: string): SuggestionRecord {
  const index = readIndex()
  const record: SuggestionRecord = {
    ...candidate,
    id: randomUUID(),
    sessionId,
    status: 'suggested',
    createdAt: Date.now(),
  }
  index.records.unshift(record)
  // 容量上限：超出裁剪最旧记录（保留最近 MAX_RECORDS 条）
  if (index.records.length > MAX_RECORDS) {
    index.records.length = MAX_RECORDS
  }
  writeIndex()
  return record
}

/** 记录用户反馈，更新类型权重 */
export function recordFeedback(suggestionId: string, feedback: SuggestionFeedback): SuggestionRecord | undefined {
  // 入口白名单：防止非法枚举污染 status
  if (feedback !== 'accepted' && feedback !== 'ignored' && feedback !== 'never') return undefined
  const index = readIndex()
  const record = index.records.find((r) => r.id === suggestionId)
  if (!record) return undefined

  record.status = feedback === 'never' ? 'never' : feedback
  record.feedbackAt = Date.now()

  // 频率学习：更新类型权重
  const weight = typeWeightValue(index, record.kind)
  switch (feedback) {
    case 'accepted':
      index.typeWeights[record.kind] = Math.min(2.0, weight * 1.2)
      break
    case 'ignored':
      index.typeWeights[record.kind] = Math.max(0.2, weight * 0.8)
      break
    case 'never':
      // 永久屏蔽该条 + 类型权重减半
      index.typeWeights[record.kind] = Math.max(0.2, weight * 0.5)
      break
  }

  writeIndex()
  return record
}

/** 列出待展示建议（UI 拉取） */
export function listSuggestions(status?: 'suggested' | 'accepted' | 'ignored' | 'never'): SuggestionRecord[] {
  const index = readIndex()
  if (!status) return index.records
  return index.records.filter((r) => r.status === status)
}

/** 删除一条建议记录（用户控制/清理） */
export function deleteSuggestion(id: string): boolean {
  const index = readIndex()
  const before = index.records.length
  index.records = index.records.filter((r) => r.id !== id)
  writeIndex()
  return index.records.length < before
}

/** 清空全部建议记录（保留类型权重与启用状态） */
export function clearSuggestions(): void {
  const index = readIndex()
  index.records = []
  writeIndex()
}

/** 按 ID 读取建议 */
export function getSuggestion(id: string): SuggestionRecord | undefined {
  return readIndex().records.find((r) => r.id === id)
}

/** 判断某类型的建议是否已被"连续忽略自动静默" */
export function isTypeSilenced(kind: SuggestionKind): boolean {
  const index = readIndex()
  const recent = index.records
    .filter((r) => r.kind === kind)
    .slice(0, SILENCE_AFTER_IGNORES)
  if (recent.length < SILENCE_AFTER_IGNORES) return false
  return recent.every((r) => r.status === 'ignored')
}

/**
 * 统计被用户高频忽略/屏蔽的建议去重键（供记忆场景热度抑制使用）。
 *
 * 反馈回流闭环的一部分（P0-1）：
 * - 用户对某类建议（duplicateKey）多次 ignore / never → 说明该方向当前不受欢迎
 * - 记忆场景热度计算时可据此降低相关场景热度，避免“越关注越打扰”
 *
 * @param minHits 至少被忽略/屏蔽的次数阈值（默认 2：出现两次即视为高频）
 */
export function getHighIgnoreDuplicateKeys(minHits = 2): string[] {
  const index = readIndex()
  const counts = new Map<string, number>()
  for (const r of index.records) {
    if (r.status !== 'ignored' && r.status !== 'never') continue
    if (!r.duplicateKey) continue
    counts.set(r.duplicateKey, (counts.get(r.duplicateKey) ?? 0) + 1)
  }
  const result: string[] = []
  for (const [key, count] of counts) {
    if (count >= minHits) result.push(key)
  }
  return result
}

/** 获取当前类型权重 */
export function typeWeights(): SuggestionTypeWeights {
  return { ...readIndex().typeWeights }
}

// ===== 免打扰时段（DND） =====

/** 读取 DND 配置（缺省关闭） */
export function getDndConfig(): SuggestionDndConfig {
  const cfg = readIndex().dnd
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_DND_CONFIG }
  return {
    enabled: !!cfg.enabled,
    startMin: typeof cfg.startMin === 'number' ? clampMinute(cfg.startMin) : DEFAULT_DND_CONFIG.startMin,
    endMin: typeof cfg.endMin === 'number' ? clampMinute(cfg.endMin) : DEFAULT_DND_CONFIG.endMin,
  }
}

/** 更新 DND 配置 */
export function setDndConfig(cfg: SuggestionDndConfig): void {
  const index = readIndex()
  index.dnd = {
    enabled: !!cfg.enabled,
    startMin: clampMinute(cfg.startMin),
    endMin: clampMinute(cfg.endMin),
  }
  writeIndex()
}

function clampMinute(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1439, Math.max(0, Math.round(v)))
}

/**
 * 当前时间是否处于免打扰时段（支持跨午夜）。
 * 例如 start=22:30 end=08:00 → [1350, 1440) ∪ [0, 480) 为 DND。
 */
export function isInDnd(now: number = Date.now(), cfg?: SuggestionDndConfig): boolean {
  const config = cfg ?? getDndConfig()
  if (!config.enabled) return false
  const d = new Date(now)
  const curMin = d.getHours() * 60 + d.getMinutes()
  if (config.startMin < config.endMin) {
    return curMin >= config.startMin && curMin < config.endMin
  }
  if (config.startMin > config.endMin) {
    return curMin >= config.startMin || curMin < config.endMin
  }
  return false // start === end → 无有效时段
}

/** 统计（UI 展示） */
export function suggestionStats(): {
  suggestedCount: number
  todayAccepted: number
  todayIgnored: number
  todayNever: number
  typeWeights: SuggestionTypeWeights
} {
  const index = readIndex()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startMs = startOfDay.getTime()

  const today = index.records.filter((r) => (r.feedbackAt ?? r.createdAt) >= startMs)
  return {
    suggestedCount: index.records.filter((r) => r.status === 'suggested').length,
    todayAccepted: today.filter((r) => r.status === 'accepted').length,
    todayIgnored: today.filter((r) => r.status === 'ignored').length,
    todayNever: today.filter((r) => r.status === 'never').length,
    typeWeights: { ...index.typeWeights },
  }
}

/** 取类型权重（容错旧索引） */
function typeWeightValue(index: SuggestionsIndex, kind: SuggestionKind): number {
  const w = index.typeWeights?.[kind]
  if (typeof w === 'number' && w > 0) return w
  return 1.0
}
