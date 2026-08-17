import type { RetryAttempt } from '@proma/shared'

/** 前 N 次 Pi native retry 不通知 UI，与 Claude runtime 的自动恢复体验保持一致。 */
export const PI_RETRY_VISIBILITY_THRESHOLD = 5

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
  maxAttempts?: number
  delayMs?: number
  errorMessage?: string
}

type PiNativeRetryEvent =
  | ({ type: 'auto_retry_start' } & PiNativeRetryDetails)
  | ({ type: 'auto_retry_end'; success: boolean; finalError?: string } & PiNativeRetryDetails)

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
    maxAttempts: event.maxAttempts ?? event.attempt,
    totalAttempt: event.attempt,
    maxTotalAttempts: event.maxAttempts ?? event.attempt,
    runStartedAt: context.runStartedAt,
  }
}

function retryAttempt(event: PiNativeRetryDetails, timestamp: number, errorMessage: string): RetryAttempt {
  return {
    attempt: event.attempt,
    totalAttempt: event.attempt,
    maxTotalAttempts: event.maxAttempts ?? event.attempt,
    timestamp,
    reason: errorMessage,
    errorMessage,
    // 这里记录的是本次 retry 实际开始前已经等待的退避时间。
    delaySeconds: (event.delayMs ?? 0) / 1_000,
  }
}

/** Pi 0.84 只暴露连续失败段的 attempt；超过前五次才向 UI 展示重试生命周期。 */
function shouldExposePiRetry(event: PiNativeRetryDetails): boolean {
  return event.attempt > PI_RETRY_VISIBILITY_THRESHOLD
}

/**
 * 将 Pi native retry 生命周期转换为 Proma UI 已识别的 retry 事件。
 * 前五次恢复的完整生命周期都会被过滤；若最终未恢复，终态 assistant error 仍会正常展示。
 */
export function mapPiNativeRetryEvent(
  event: PiNativeRetryEvent,
  context: PiRetryEventContext,
  timestamp = Date.now(),
): PiRetryUpdate[] {
  if (!shouldExposePiRetry(event)) return []

  const metadata = retryMetadata(event, context)

  if (event.type === 'auto_retry_start') {
    return [{
      status: 'starting',
      ...metadata,
      scheduledAt: timestamp,
      delaySeconds: (event.delayMs ?? 0) / 1_000,
      reason: event.errorMessage ?? '未知错误',
    }]
  }

  if (event.type === 'auto_retry_end' && event.success) {
    return [{ status: 'cleared', ...metadata }]
  }

  const error = event.type === 'auto_retry_end' ? event.finalError ?? '未知错误' : 'Retry cancelled'
  return [{
    status: 'failed',
    ...metadata,
    attemptData: retryAttempt(event, timestamp, error),
  }]
}
