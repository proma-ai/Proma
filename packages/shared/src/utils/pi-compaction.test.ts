import { describe, expect, test } from 'bun:test'
import {
  PI_AUTO_COMPACTION_THRESHOLD_RATIO,
  calculatePiAutoCompactionReserveTokens,
  calculatePiAutoCompactionThresholdTokens,
} from './pi-compaction'

describe('Pi auto-compaction settings', () => {
  test('starts compaction at 80% for each context window size', () => {
    expect(PI_AUTO_COMPACTION_THRESHOLD_RATIO).toBe(0.8)
    expect(calculatePiAutoCompactionReserveTokens(200_000)).toBe(40_000)
    expect(calculatePiAutoCompactionThresholdTokens(200_000)).toBe(160_000)
    expect(calculatePiAutoCompactionReserveTokens(1_000_000)).toBe(200_000)
    expect(calculatePiAutoCompactionThresholdTokens(1_000_000)).toBe(800_000)
    expect(calculatePiAutoCompactionReserveTokens(131_072)).toBe(26_215)
    expect(calculatePiAutoCompactionThresholdTokens(131_072)).toBe(104_857)
  })

  test('rejects an invalid context window', () => {
    expect(() => calculatePiAutoCompactionReserveTokens(0)).toThrow(TypeError)
    expect(() => calculatePiAutoCompactionReserveTokens(Number.NaN)).toThrow(TypeError)
  })
})
