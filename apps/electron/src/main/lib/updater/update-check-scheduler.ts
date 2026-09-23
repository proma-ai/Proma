/**
 * 低负载更新检查调度器。
 *
 * 更新清单属于低频元数据：周期检查使用抖动，窗口重新活跃或系统恢复时可
 * 尽快检查，但由冷却时间和 single-flight 保护，避免焦点切换或网络恢复造成
 * 集中请求。更新器本身仍在 auto-updater.ts 中负责签名校验、下载与状态机。
 */

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000
export const UPDATE_CHECK_JITTER_RATIO = 0.1
export const UPDATE_CHECK_COOLDOWN_MS = 15 * 60 * 1_000
export const INITIAL_CHECK_MIN_DELAY_MS = 10 * 1_000
export const INITIAL_CHECK_MAX_DELAY_MS = 60 * 1_000

export interface UpdateCheckSchedulerOptions {
  check: () => Promise<void>
  intervalMs?: number
  jitterRatio?: number
  cooldownMs?: number
  initialMinDelayMs?: number
  initialMaxDelayMs?: number
  now?: () => number
  random?: () => number
  setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void
}

export interface UpdateCheckScheduler {
  /** 安排一次带抖动的首次检查及后续周期检查；重复调用安全。 */
  start(): void
  /** 前台恢复、系统恢复等事件触发的即时检查。 */
  notifyActive(): void
  /** 网络恢复事件触发的即时检查。 */
  notifyOnline(): void
  /** 释放全部计时器，忽略正在执行检查的后续调度。 */
  dispose(): void
}

export function createUpdateCheckScheduler({
  check,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  jitterRatio = UPDATE_CHECK_JITTER_RATIO,
  cooldownMs = UPDATE_CHECK_COOLDOWN_MS,
  initialMinDelayMs = INITIAL_CHECK_MIN_DELAY_MS,
  initialMaxDelayMs = INITIAL_CHECK_MAX_DELAY_MS,
  now = Date.now,
  random = Math.random,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: UpdateCheckSchedulerOptions): UpdateCheckScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let started = false
  let disposed = false
  let lastCompletedAt: number | null = null
  let inFlight: Promise<void> | null = null

  const clearTimer = (): void => {
    if (!timer) return
    clearTimeoutFn(timer)
    timer = null
  }

  const jitteredDelay = (): number => {
    const factor = 1 + ((random() * 2 - 1) * jitterRatio)
    return Math.max(0, Math.round(intervalMs * factor))
  }

  const initialDelay = (): number => {
    const min = Math.max(0, initialMinDelayMs)
    const max = Math.max(min, initialMaxDelayMs)
    return Math.round(min + (max - min) * random())
  }

  const schedulePeriodicCheck = (): void => {
    if (disposed) return
    clearTimer()
    timer = setTimeoutFn(() => {
      timer = null
      void runCheck().finally(schedulePeriodicCheck)
    }, jitteredDelay())
  }

  const runCheck = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (inFlight) return inFlight

    inFlight = Promise.resolve()
      .then(check)
      .catch((error: unknown) => {
        // check() already transitions the updater UI into an error state. Keep this
        // scheduler alive instead of leaking an unhandled rejection from a timer.
        console.warn('[更新] 定时检查未完成，将在下个周期重试:', error)
      })
      .finally(() => {
        lastCompletedAt = now()
        inFlight = null
      })
    return inFlight
  }

  const shouldSkipRecoveryCheck = (): boolean => {
    if (inFlight) return false
    return lastCompletedAt !== null && now() - lastCompletedAt < cooldownMs
  }

  const notifyRecovery = (): void => {
    if (disposed || !started || shouldSkipRecoveryCheck()) return
    void runCheck()
  }

  const start = (): void => {
    if (started || disposed) return
    started = true
    timer = setTimeoutFn(() => {
      timer = null
      void runCheck().finally(schedulePeriodicCheck)
    }, initialDelay())
  }

  const dispose = (): void => {
    disposed = true
    clearTimer()
  }

  return {
    start,
    notifyActive: notifyRecovery,
    notifyOnline: notifyRecovery,
    dispose,
  }
}
