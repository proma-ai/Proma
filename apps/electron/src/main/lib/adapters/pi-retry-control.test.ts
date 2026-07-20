import { describe, expect, test } from 'bun:test'
import { createPiRetryTerminalGate, mapPiNativeRetryEvent } from './pi-retry-control'

describe('Pi native retry terminal gate', () => {
  test('suppresses retryable error until Pi continues the same transcript', () => {
    const gate = createPiRetryTerminalGate<string>()
    gate.defer('temporary 529')

    expect(gate.settle(true)).toBeUndefined()
    expect(gate.settle(false)).toBeUndefined()
  })

  test('releases the deferred error only after retry is exhausted', () => {
    const gate = createPiRetryTerminalGate<string>()
    gate.defer('persistent 529')

    expect(gate.settle(false)).toBe('persistent 529')
  })

  test('clears a deferred error when an interrupt discards its terminal event', () => {
    const gate = createPiRetryTerminalGate<string>()
    gate.defer('cancelled retryable error')

    // Adapter 在 interrupt 时会丢弃此返回值；下一个 turn 不得再次收到旧错误。
    expect(gate.settle(false)).toBe('cancelled retryable error')
    expect(gate.settle(false)).toBeUndefined()
  })

  test('maps Pi native retry lifecycle to Proma retry UI events', () => {
    expect(mapPiNativeRetryEvent({
      type: 'auto_retry_start', attempt: 2, maxAttempts: 8, delayMs: 4_000, errorMessage: '529 overloaded',
    }, 123)).toEqual([
      { status: 'starting', attempt: 2, maxAttempts: 8, delaySeconds: 4, reason: '529 overloaded' },
      { status: 'attempt', attemptData: { attempt: 2, timestamp: 123, reason: '529 overloaded', errorMessage: '529 overloaded', delaySeconds: 4 } },
    ])
    expect(mapPiNativeRetryEvent({ type: 'auto_retry_end', success: true, attempt: 2 }, 123)).toEqual([{ status: 'cleared' }])
  })
})
