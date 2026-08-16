import { describe, expect, test } from 'bun:test'
import {
  canRecoverRenderer,
  MAX_RENDERER_RECOVERY_ATTEMPTS,
  RENDERER_RECOVERY_WINDOW_MS,
} from './renderer-process-recovery'

describe('renderer process recovery budget', () => {
  test('allows recovery while fewer than two attempts remain in the window', () => {
    const now = 30_000

    expect(canRecoverRenderer([], now)).toBe(true)
    expect(canRecoverRenderer([now - 1], now)).toBe(true)
    expect(canRecoverRenderer([now - 1, now - 2], now)).toBe(false)
  })

  test('ignores attempts outside the recovery window', () => {
    const now = 30_000

    expect(canRecoverRenderer([
      now - RENDERER_RECOVERY_WINDOW_MS,
      now - RENDERER_RECOVERY_WINDOW_MS - 1,
    ], now)).toBe(true)
  })

  test('keeps the configured recovery limit explicit', () => {
    expect(MAX_RENDERER_RECOVERY_ATTEMPTS).toBe(2)
  })
})
