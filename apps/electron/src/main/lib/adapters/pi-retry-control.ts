import type { RetryAttempt } from '@proma/shared'

/** 将 Pi native retry 与当前 renderer stream 绑定，拒绝迟到事件污染下一轮。 */
export interface PiRetryEventContext {
  runStartedAt: number
}

interface PiRetryMetadata {
  attempt: number
  maxAttempts: number
  totalAttempt: number
  maxTotalAttempts: number
  runStartedAt: number
}

export type PiRetryUpdate =
  | ({ status: 'starting'; delaySeconds: number; reason: string; scheduledAt: number } & PiRetryMetadata)
  | ({ status: 'attempt'; attemptData: RetryAttempt } & PiRetryMetadata)
  | ({ status: 'cleared' } & PiRetryMetadata)
  | ({ status: 'failed'; attemptData: RetryAttempt } & PiRetryMetadata)
  | ({ status: 'cancelled'; reason: string } & PiRetryMetadata)

type PiNativeRetryDetails = {
  attempt: number
  maxAttempts: number
  totalAttempt?: number
  maxTotalAttempts?: number
  delayMs: number
  totalDelayMs?: number
  maxTotalDelayMs?: number
  errorMessage?: string
}

type PiNativeRetryEvent =
  | ({ type: 'auto_retry_start' } & PiNativeRetryDetails)
  | ({ type: 'auto_retry_attempt_start' } & PiNativeRetryDetails)
  | ({ type: 'auto_retry_end'; success: boolean; outcome?: 'succeeded' | 'exhausted' | 'cancelled'; finalError?: string } & PiNativeRetryDetails)

/**
 * Pi native retry 的终态事件门控。
 *
 * Pi 在判定可重试时会先结束一次失败的 agent loop，再在同一 transcript 上 continue。
 * 在确认 `willRetry` 前，调用方不能把 error 或 result 当作最终状态交给外层编排器。
 */
export function createPiRetryTerminalGate<T>(): {
  defer: (error: T) => void
  peek: () => T | undefined
  settle: (willRetry: boolean) => T | undefined
} {
  let pendingError: T | undefined

  return {
    defer(error) {
      pendingError = error
    },
    peek() {
      return pendingError
    },
    settle(willRetry) {
      const terminalError = willRetry ? undefined : pendingError
      pendingError = undefined
      return terminalError
    },
  }
}

function retryMetadata(event: PiNativeRetryDetails, context: PiRetryEventContext): PiRetryMetadata {
  return {
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    totalAttempt: event.totalAttempt ?? event.attempt,
    maxTotalAttempts: event.maxTotalAttempts ?? event.maxAttempts,
    runStartedAt: context.runStartedAt,
  }
}

function retryAttempt(event: PiNativeRetryDetails, timestamp: number, errorMessage: string): RetryAttempt {
  return {
    attempt: event.attempt,
    totalAttempt: event.totalAttempt ?? event.attempt,
    maxTotalAttempts: event.maxTotalAttempts ?? event.maxAttempts,
    timestamp,
    reason: errorMessage,
    errorMessage,
    // 这里记录的是本次 retry 实际开始前已经等待的退避时间。
    delaySeconds: event.delayMs / 1_000,
  }
}

/** 将 Pi native retry 生命周期转换为 Proma UI 已识别的 retry 事件。 */
export function mapPiNativeRetryEvent(
  event: PiNativeRetryEvent,
  context: PiRetryEventContext,
  timestamp = Date.now(),
): PiRetryUpdate[] {
  const metadata = retryMetadata(event, context)

  if (event.type === 'auto_retry_start') {
    return [{
      status: 'starting',
      ...metadata,
      scheduledAt: timestamp,
      delaySeconds: event.delayMs / 1_000,
      reason: event.errorMessage ?? '未知错误',
    }]
  }

  if (event.type === 'auto_retry_attempt_start') {
    const errorMessage = event.errorMessage ?? '未知错误'
    return [{
      status: 'attempt',
      ...metadata,
      attemptData: retryAttempt(event, timestamp, errorMessage),
    }]
  }

  if (event.success || event.outcome === 'succeeded') {
    return [{ status: 'cleared', ...metadata }]
  }

  const error = event.finalError ?? '未知错误'
  if (event.outcome === 'cancelled' || error === 'Retry cancelled') {
    return [{ status: 'cancelled', ...metadata, reason: error }]
  }

  return [{
    status: 'failed',
    ...metadata,
    attemptData: retryAttempt(event, timestamp, error),
  }]
}
