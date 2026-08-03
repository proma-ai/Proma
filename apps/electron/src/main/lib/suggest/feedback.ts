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
import type { SuggestionsIndex, SuggestionTypeWeights } from './types'
import type {
  SuggestionCandidate,
  SuggestionFeedback,
  SuggestionKind,
  SuggestionRecord,
} from '@proma/shared'
import { defaultTypeWeights } from './engine'

const INDEX_VERSION = 1

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
  if (!data.typeWeights) data.typeWeights = defaultTypeWeights()
  if (typeof data.enabled !== 'boolean') data.enabled = true
  if (!Array.isArray(data.records)) data.records = []
  cachedIndex = data
  return cachedIndex
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
  writeIndex()
  return record
}

/** 记录用户反馈，更新类型权重 */
export function recordFeedback(suggestionId: string, feedback: SuggestionFeedback): SuggestionRecord | undefined {
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

/** 获取当前类型权重 */
export function typeWeights(): SuggestionTypeWeights {
  return { ...readIndex().typeWeights }
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
