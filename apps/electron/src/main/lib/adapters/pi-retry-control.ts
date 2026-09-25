import type { AgentRetryReasonKind, RetryAttempt } from '@proma/shared'

/** 第一次自动恢复即应告知用户，避免无反馈的长时间等待。 */
export const PI_RETRY_VISIBILITY_THRESHOLD = 0

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
  | ({ status: 'starting'; delaySeconds: number; reason: string; reasonKind: AgentRetryReasonKind; scheduledAt: number } & PiRetryMetadata)
  | ({ status: 'attempt'; attemptData: RetryAttempt } & PiRetryMetadata)
  | ({ status: 'cleared' } & PiRetryMetadata)
  | ({ status: 'failed'; attemptData: RetryAttempt } & PiRetryMetadata)
  | ({ status: 'cancelled'; reason: string; reasonKind: AgentRetryReasonKind } & PiRetryMetadata)

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

function extractExplicitHttpStatus(message: string): number | undefined {
  const patterns = [
    /\b(?:api|http)\s+(?:error|status|code)?\s*:?\s*(\d{3})\b/i,
    /\b(?:error|status|code)\s*:\s*(\d{3})\b/i,
    /\b(\d{3})\s+(?:internal server error|bad gateway|service unavailable|gateway timeout)\b/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(message)
    if (match?.[1]) return Number(match[1])
  }
  return undefined
}

export function classifyPiRetryReason(errorMessage: string): AgentRetryReasonKind {
  const message = errorMessage.toLowerCase()
  const status = extractExplicitHttpStatus(errorMessage)
  if (status === 429 || /rate.?limit|too many requests/.test(message)) return 'rate_limited'
  if (status != null && status >= 500 && status <= 599) return 'service'
  if (/stream.*(?:ended|interrupted|closed)|(?:ended|interrupted|closed).*stream|incomplete chunked|terminal (?:event|response)/.test(message)) return 'stream_interrupted'
  if (/unexpected (?:token|non-whitespace)|invalid (?:json|response)|json.*(?:parse|syntax)/.test(message)) return 'response_malformed'
  if (/service unavailable|bad gateway|gateway timeout/.test(message)) return 'service'
  if (/connection|network|failed to fetch|fetch failed|socket|econn|etimedout|enotfound|dns|peer closed|connect timeout/.test(message)) return 'connection'
  return 'unknown'
}

function retryAttempt(event: PiNativeRetryDetails, timestamp: number, errorMessage: string): RetryAttempt {
  return {
    attempt: event.attempt,
    totalAttempt: event.attempt,
    maxTotalAttempts: event.maxAttempts ?? event.attempt,
    timestamp,
    reason: errorMessage,
    reasonKind: classifyPiRetryReason(errorMessage),
    errorMessage,
    // 这里记录的是本次 retry 实际开始前已经等待的退避时间。
    delaySeconds: (event.delayMs ?? 0) / 1_000,
  }
}

/** Pi 只暴露当前连续失败段的 attempt；从第一次起向 UI 展示。 */
function shouldExposePiRetry(event: PiNativeRetryDetails): boolean {
  return event.attempt > PI_RETRY_VISIBILITY_THRESHOLD
}

/**
 * 将 Pi native retry 生命周期转换为 Proma UI 已识别的 retry 事件。
 * Pi 只报告连续失败段，因此 attempt 不能被解释为整个顶层 run 的总预算。
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
      reasonKind: classifyPiRetryReason(event.errorMessage ?? '未知错误'),
    }]
  }

  if (event.type === 'auto_retry_end' && event.success) {
    return [{ status: 'cleared', ...metadata }]
  }

  const error = event.type === 'auto_retry_end' ? event.finalError ?? '未知错误' : 'Retry cancelled'
  if (event.type === 'auto_retry_end' && /(?:retry\s+)?cancelled/i.test(error)) {
    return [{
      status: 'cancelled',
      ...metadata,
      reason: error,
      reasonKind: classifyPiRetryReason(error),
    }]
  }
  return [{
    status: 'failed',
    ...metadata,
    attemptData: retryAttempt(event, timestamp, error),
  }]
}
