import { describe, expect, test } from 'bun:test'
import { computeTurnSpeed, formatTokPerSec, isTurnTiming } from './turn-speed'

describe('computeTurnSpeed', () => {
  test('正常路径：usage 与 timing 齐全时返回 tok/s 与 TTFT', () => {
    const speed = computeTurnSpeed({ outputTokens: 425, ttftMs: 1200, genMs: 10_000 })
    expect(speed.tokPerSec).toBe(42.5)
    expect(speed.ttftMs).toBe(1200)
  })

  test('边界：输出 token 低于门槛时不返回速度，但保留 TTFT', () => {
    const speed = computeTurnSpeed({ outputTokens: 9, ttftMs: 800, genMs: 5_000 })
    expect(speed.tokPerSec).toBeUndefined()
    expect(speed.ttftMs).toBe(800)
  })

  test('边界：净生成时长低于门槛时不返回速度', () => {
    const speed = computeTurnSpeed({ outputTokens: 100, ttftMs: 300, genMs: 499 })
    expect(speed.tokPerSec).toBeUndefined()
  })

  test('边界：字段缺失或非法时不抛错，速度与 TTFT 均为空', () => {
    expect(computeTurnSpeed({})).toEqual({})
    expect(computeTurnSpeed({ outputTokens: undefined, ttftMs: Number.NaN, genMs: 0 })).toEqual({})
  })

  test('边界：TTFT 为 0 时不输出 ttftMs，速度正常计算', () => {
    const speed = computeTurnSpeed({ outputTokens: 100, ttftMs: 0, genMs: 4_000 })
    expect(speed.ttftMs).toBeUndefined()
    expect(speed.tokPerSec).toBe(25)
  })
})

describe('formatTokPerSec', () => {
  test('保留一位小数并携带单位', () => {
    expect(formatTokPerSec(42.5)).toBe('42.5 tok/s')
    expect(formatTokPerSec(42)).toBe('42.0 tok/s')
  })
})

describe('isTurnTiming', () => {
  test('合法结构通过校验，非法结构被拒绝', () => {
    expect(isTurnTiming({ ttftMs: 100, genMs: 2000 })).toBe(true)
    expect(isTurnTiming({ ttftMs: 'x', genMs: 2000 })).toBe(false)
    expect(isTurnTiming(null)).toBe(false)
    expect(isTurnTiming('timing')).toBe(false)
  })
})
