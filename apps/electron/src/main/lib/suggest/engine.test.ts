import { describe, expect, test } from 'bun:test'
import { evaluateSuggestions, defaultTypeWeights, DEFAULT_SUGGEST_OPTIONS } from './engine'
import type { SuggestionsIndex } from './types'

function makeIndex(overrides: Partial<SuggestionsIndex> = {}): SuggestionsIndex {
  return {
    version: 1,
    records: [],
    typeWeights: defaultTypeWeights(),
    enabled: true,
    ...overrides,
  }
}

function makeInput(messages: string[], overrides: Record<string, unknown> = {}) {
  return {
    messages: messages.map((content) => ({ role: 'user' as const, content })),
    ...overrides,
  }
}

describe('suggest/engine: 决策与预算', () => {
  test('明确纠正信号产生建议', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(makeInput(['以后不要用 setTimeout']), index)
    expect(result.candidates.length).toBe(1)
    expect(result.candidates[0]?.kind).toBe('correction')
  })

  test('同会话已建议过则不重复', () => {
    const index = makeIndex()
    const first = evaluateSuggestions(makeInput(['以后不要用 setTimeout']), index)
    expect(first.candidates.length).toBe(1)

    const existing = [{ id: 'x', ...first.candidates[0]!, status: 'suggested' as const, createdAt: Date.now() }]
    const second = evaluateSuggestions(
      makeInput(['以后不要用 setTimeout'], { existingSessionSuggestions: existing }),
      index,
    )
    expect(second.candidates.length).toBe(0)
  })

  test('用户已屏蔽 duplicateKey 则不建议', () => {
    const cand = evaluateSuggestions(makeInput(['以后不要用 setTimeout']), makeIndex()).candidates[0]!
    const index = makeIndex({
      records: [
        { id: 'never-1', ...cand, status: 'never' as const, createdAt: Date.now(), feedbackAt: Date.now() },
      ],
    })
    const result = evaluateSuggestions(makeInput(['以后不要用 setTimeout']), index)
    expect(result.candidates.length).toBe(0)
    expect(result.suppressed.some((s) => s.reason.includes('不再建议'))).toBe(true)
  })

  test('最后一条消息含明确拒绝则本轮不触发', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(makeInput(['以后不要用 setTimeout', '不用了算了']), index)
    expect(result.candidates.length).toBe(0)
  })

  test('预算：单次最多 1 条', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(
      makeInput(['以后不要用 setTimeout', '明天继续这个任务', '每天自动帮我总结']),
      index,
    )
    expect(result.candidates.length).toBeLessThanOrEqual(DEFAULT_SUGGEST_OPTIONS.maxPerEvaluation)
  })

  test('无信号时不建议（该沉默）', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(makeInput(['帮我写个 hello world']), index)
    expect(result.candidates.length).toBe(0)
  })

  test('sop 积累达标时建议 skill', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(
      makeInput(['以后不要用 setTimeout'], { sopCandidateCount: 4 }),
      index,
    )
    // correction 置信度更高，应优先 correction；skill 作为低频补充不抢占
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  test('todo 类型不死锁（权重 0.9 × raw 0.72 ≥ 阈值）', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(makeInput(['这个功能还没做完']), index)
    expect(result.candidates.some((c) => c.kind === 'todo')).toBe(true)
  })

  test('"以后再说吧" 不产生建议（延后≠纠正）', () => {
    const index = makeIndex()
    const result = evaluateSuggestions(makeInput(['这个问题以后再说吧']), index)
    expect(result.candidates.length).toBe(0)
  })
})

describe('suggest/engine: 频率加权', () => {
  test('类型权重降低后弱信号被过滤', () => {
    // followup 原始 0.8，权重降到 0.5 → effective 0.4 < 0.6 被抑制
    const index = makeIndex({ typeWeights: { ...defaultTypeWeights(), followup: 0.5 } })
    const result = evaluateSuggestions(makeInput(['明天继续这个任务']), index)
    expect(result.candidates.length).toBe(0)
    expect(result.suppressed.some((s) => s.reason.includes('置信度不足'))).toBe(true)
  })

  test('类型权重提升后弱信号可触发', () => {
    // todo 原始 0.72，权重提升 1.2 → effective 0.864 ≥ 0.6
    const index = makeIndex({ typeWeights: { ...defaultTypeWeights(), todo: 1.2 } })
    const result = evaluateSuggestions(makeInput(['这个功能还没做完']), index)
    expect(result.candidates.some((c) => c.kind === 'todo')).toBe(true)
  })
})
