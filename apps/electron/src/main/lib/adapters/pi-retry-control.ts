import type { RetryAttempt } from '@proma/shared'

export type PiRetryUpdate =
  | { status: 'starting'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string }
  | { status: 'attempt'; attemptData: RetryAttempt }
  | { status: 'cleared' }
  | { status: 'failed'; attemptData: RetryAttempt }

type PiNativeRetryEvent =
  | { type: 'auto_retry_start'; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }

/**
 * Pi native retry 的终态事件门控。
 *
 * Pi 在判定可重试时会先结束一次失败的 agent loop，再在同一 transcript 上 continue。
 * 在确认 `willRetry` 前，调用方不能把 error 或 result 当作最终状态交给外层编排器。
 */
export function createPiRetryTerminalGate<T>(): {
  defer: (error: T) => void
  settle: (willRetry: boolean) => T | undefined
} {
  let pendingError: T | undefined

  return {
    defer(error) {
      pendingError = error
    },
    settle(willRetry) {
      const terminalError = willRetry ? undefined : pendingError
      pendingError = undefined
      return terminalError
    },
  }
}

/** 将 Pi 的 native retry 生命周期转换为 Proma UI 已识别的 retry 事件。 */
export function mapPiNativeRetryEvent(
  event: PiNativeRetryEvent,
  timestamp = Date.now(),
): PiRetryUpdate[] {
  if (event.type === 'auto_retry_start') {
    const delaySeconds = event.delayMs / 1_000
    const attemptData: RetryAttempt = {
      attempt: event.attempt,
      timestamp,
      reason: event.errorMessage,
      errorMessage: event.errorMessage,
      delaySeconds,
    }
    return [
      {
        status: 'starting',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delaySeconds,
        reason: event.errorMessage,
      },
      { status: 'attempt', attemptData },
    ]
  }

  if (event.success) return [{ status: 'cleared' }]
  const error = event.finalError ?? '未知错误'
  return [{
    status: 'failed',
    attemptData: {
      attempt: event.attempt,
      timestamp,
      reason: error,
      errorMessage: error,
      delaySeconds: 0,
    },
  }]
}
