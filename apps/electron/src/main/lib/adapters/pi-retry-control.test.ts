import { describe, expect, test } from 'bun:test'
import { createPiRetryTerminalGate, mapPiNativeRetryEvent } from './pi-retry-control'

const retryContext = { runStartedAt: 456 }

const retryDetails = {
  attempt: 2,
  maxAttempts: 8,
  totalAttempt: 5,
  maxTotalAttempts: 8,
  delayMs: 4_000,
  totalDelayMs: 11_000,
  maxTotalDelayMs: 300_000,
  errorMessage: '529 overloaded',
}

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

  test('maps scheduled and actual Pi retry lifecycle separately', () => {
    expect(mapPiNativeRetryEvent({ type: 'auto_retry_start', ...retryDetails }, retryContext, 123)).toEqual([
      {
        status: 'starting',
        attempt: 2,
        maxAttempts: 8,
        totalAttempt: 5,
        maxTotalAttempts: 8,
        runStartedAt: 456,
        scheduledAt: 123,
        delaySeconds: 4,
        reason: '529 overloaded',
      },
    ])

    expect(mapPiNativeRetryEvent({ type: 'auto_retry_attempt_start', ...retryDetails }, retryContext, 127)).toEqual([
      {
        status: 'attempt',
        attempt: 2,
        maxAttempts: 8,
        totalAttempt: 5,
        maxTotalAttempts: 8,
        runStartedAt: 456,
        attemptData: {
          attempt: 2,
          totalAttempt: 5,
          maxTotalAttempts: 8,
          timestamp: 127,
          reason: '529 overloaded',
          errorMessage: '529 overloaded',
          delaySeconds: 4,
        },
      },
    ])
  })

  test('maps a successful retry and cancellation to distinct terminal states', () => {
    expect(mapPiNativeRetryEvent({
      type: 'auto_retry_end', success: true, outcome: 'succeeded', ...retryDetails,
    }, retryContext, 123)).toEqual([{
      status: 'cleared',
      attempt: 2,
      maxAttempts: 8,
      totalAttempt: 5,
      maxTotalAttempts: 8,
      runStartedAt: 456,
    }])

    expect(mapPiNativeRetryEvent({
      type: 'auto_retry_end', success: false, outcome: 'cancelled', finalError: 'Retry cancelled', ...retryDetails,
    }, retryContext, 123)).toEqual([{
      status: 'cancelled',
      attempt: 2,
      maxAttempts: 8,
      totalAttempt: 5,
      maxTotalAttempts: 8,
      runStartedAt: 456,
      reason: 'Retry cancelled',
    }])
  })

  test('maps exhausted retry end by updating the existing retry attempt', () => {
    expect(mapPiNativeRetryEvent({
      type: 'auto_retry_end', success: false, outcome: 'exhausted', finalError: 'Failed to fetch', ...retryDetails,
    }, retryContext, 123)).toEqual([{
      status: 'failed',
      attempt: 2,
      maxAttempts: 8,
      totalAttempt: 5,
      maxTotalAttempts: 8,
      runStartedAt: 456,
      attemptData: {
        attempt: 2,
        totalAttempt: 5,
        maxTotalAttempts: 8,
        timestamp: 123,
        reason: 'Failed to fetch',
        errorMessage: 'Failed to fetch',
        delaySeconds: 4,
      },
    }])
  })
})
