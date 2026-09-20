export const UTILITY_PROCESS_START_RETRY_DELAYS_MS = [25, 100] as const
export const UTILITY_PROCESS_START_CANCELLED_CODE = 'UTILITY_PROCESS_START_CANCELLED'

type UtilityProcessStartupCancelledError = Error & {
  code: typeof UTILITY_PROCESS_START_CANCELLED_CODE
  cause?: unknown
}

function createUtilityProcessStartupCancelledError(cause?: unknown): UtilityProcessStartupCancelledError {
  const error = new Error('Utility process startup cancelled') as UtilityProcessStartupCancelledError
  error.code = UTILITY_PROCESS_START_CANCELLED_CODE
  if (cause !== undefined) error.cause = cause
  return error
}

export function isUtilityProcessStartupCancelledError(error: unknown): error is UtilityProcessStartupCancelledError {
  return !!error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === UTILITY_PROCESS_START_CANCELLED_CODE
}

type UtilityProcessStartupOptions = {
  platform?: NodeJS.Platform
  sleep?: (milliseconds: number) => Promise<void>
  shouldContinue?: () => boolean
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isRetryableUtilityProcessStartupError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return false
  if (!error || typeof error !== 'object') return false

  const candidate = error as { code?: unknown; message?: unknown }
  return candidate.code === 'ENOTCONN'
    || (typeof candidate.message === 'string' && /\bENOTCONN\b/.test(candidate.message))
}

/**
 * Electron utilityProcess.fork can synchronously throw Windows ENOTCONN while
 * Node wraps its freshly-created stdio handles. Retry that transient startup
 * failure locally; all other errors retain their existing failure semantics.
 */
export async function startUtilityProcessWithRetry<T>(
  start: () => T,
  options: UtilityProcessStartupOptions = {},
): Promise<T> {
  const platform = options.platform ?? process.platform
  const sleep = options.sleep ?? defaultSleep
  const shouldContinue = options.shouldContinue ?? (() => true)

  for (let attempt = 0; ; attempt++) {
    if (!shouldContinue()) throw createUtilityProcessStartupCancelledError()
    try {
      return start()
    } catch (error) {
      const delay = UTILITY_PROCESS_START_RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !isRetryableUtilityProcessStartupError(error, platform)) throw error
      await sleep(delay)
      if (!shouldContinue()) throw createUtilityProcessStartupCancelledError(error)
    }
  }
}
