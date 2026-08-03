import { describe, expect, test, beforeEach, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  resetSuggestionsCache,
  setSuggestionsIndexForTest,
  persistSuggestion,
  recordFeedback,
  listSuggestions,
  getSuggestion,
  suggestionStats,
  deleteSuggestion,
  clearSuggestions,
  isTypeSilenced,
  SILENCE_AFTER_IGNORES,
} from './feedback'
import { defaultTypeWeights } from './engine'
import type { SuggestionsIndex } from './types'
import type { SuggestionCandidate } from '@proma/shared'

function makeCandidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    duplicateKey: 'correction:test-rule',
    kind: 'correction',
    title: '记住这个纠正',
    reason: 'test reason',
    evidence: '以后不要 X',
    rawConfidence: 0.95,
    action: { type: 'memory_correction', raw: '以后不要 X', rule: '不要 X' },
    ...overrides,
  }
}

function makeIndex(overrides: Partial<SuggestionsIndex> = {}): SuggestionsIndex {
  return {
    version: 1,
    records: [],
    typeWeights: defaultTypeWeights(),
    enabled: true,
    ...overrides,
  }
}

// 与 memory 集成测试共用同一隔离配置目录：全量并发时 bun 测试文件共享 process.env，
// 统一路径避免 suggestions.json 写入不存在的目录。
const TEST_CONFIG_DIR = '/tmp/proma-test-config'

beforeAll(() => {
  process.env.PROMA_CONFIG_DIR = TEST_CONFIG_DIR
  mkdirSync(TEST_CONFIG_DIR, { recursive: true })
})

afterAll(() => {
  delete process.env.PROMA_CONFIG_DIR
  rmSync(TEST_CONFIG_DIR, { recursive: true, force: true })
})

describe('suggest/feedback: 持久化', () => {
  beforeEach(() => {
    resetSuggestionsCache()
  })

  test('persistSuggestion 创建待展示记录', () => {
    setSuggestionsIndexForTest(makeIndex())
    const record = persistSuggestion(makeCandidate(), 'sess-1')
    expect(record.id).toBeTruthy()
    expect(record.status).toBe('suggested')
    expect(record.sessionId).toBe('sess-1')
    expect(listSuggestions('suggested').length).toBe(1)
  })

  test('recordFeedback accepted 后状态更新', () => {
    setSuggestionsIndexForTest(makeIndex())
    const record = persistSuggestion(makeCandidate())
    const updated = recordFeedback(record.id, 'accepted')
    expect(updated?.status).toBe('accepted')
    expect(updated?.feedbackAt).toBeTruthy()
  })

  test('recordFeedback 不存在 ID 返回 undefined', () => {
    setSuggestionsIndexForTest(makeIndex())
    expect(recordFeedback('no-such-id', 'ignored')).toBeUndefined()
  })

  test('deleteSuggestion 删除单条', () => {
    setSuggestionsIndexForTest(makeIndex())
    const a = persistSuggestion(makeCandidate())
    const b = persistSuggestion(makeCandidate({ duplicateKey: 'other:1' }))
    expect(listSuggestions().length).toBe(2)
    expect(deleteSuggestion(a.id)).toBe(true)
    expect(listSuggestions().length).toBe(1)
    expect(getSuggestion(a.id)).toBeUndefined()
    expect(getSuggestion(b.id)).toBeTruthy()
  })

  test('clearSuggestions 清空全部（保留权重）', () => {
    setSuggestionsIndexForTest(makeIndex())
    persistSuggestion(makeCandidate())
    persistSuggestion(makeCandidate({ duplicateKey: 'other:1' }))
    clearSuggestions()
    expect(listSuggestions().length).toBe(0)
  })
})

describe('suggest/feedback: 频率学习', () => {
  beforeEach(() => {
    resetSuggestionsCache()
  })

  test('accepted 提升类型权重（×1.2 上限 2.0）', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    const record = persistSuggestion(makeCandidate())
    recordFeedback(record.id, 'accepted')
    expect(index.typeWeights.correction).toBeCloseTo(1.2)
  })

  test('ignored 降低类型权重（×0.8）', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    const record = persistSuggestion(makeCandidate())
    recordFeedback(record.id, 'ignored')
    expect(index.typeWeights.correction).toBeCloseTo(0.8)
  })

  test('never 永久屏蔽该条 + 类型权重减半', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    const record = persistSuggestion(makeCandidate())
    const updated = recordFeedback(record.id, 'never')
    expect(updated).toBeDefined()
    expect(listSuggestions().find((r) => r.id === record.id)?.status).toBe('never')
    expect(index.typeWeights.correction).toBeCloseTo(0.5)
  })

  test('连续忽略 N 次后类型自动静默', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    for (let i = 0; i < SILENCE_AFTER_IGNORES; i++) {
      const record = persistSuggestion(makeCandidate({ duplicateKey: `correction:test-${i}` }))
      recordFeedback(record.id, 'ignored')
    }
    expect(isTypeSilenced('correction')).toBe(true)
  })

  test('未达 N 次不静默', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    const record = persistSuggestion(makeCandidate())
    recordFeedback(record.id, 'ignored')
    expect(isTypeSilenced('correction')).toBe(false)
  })

  test('权重下限不低于 0.2', () => {
    const index = makeIndex({ typeWeights: { ...defaultTypeWeights(), automation: 0.25 } })
    setSuggestionsIndexForTest(index)
    const record = persistSuggestion(makeCandidate({ kind: 'automation' }))
    recordFeedback(record.id, 'never')
    expect(index.typeWeights.automation).toBeGreaterThanOrEqual(0.2)
  })
})

describe('suggest/feedback: 统计', () => {
  beforeEach(() => {
    resetSuggestionsCache()
  })

  test('suggestionStats 统计建议数', () => {
    const index = makeIndex()
    setSuggestionsIndexForTest(index)
    persistSuggestion(makeCandidate())
    const stats = suggestionStats()
    expect(stats.suggestedCount).toBe(1)
    expect(stats.typeWeights.correction).toBe(1.0)
  })
})
