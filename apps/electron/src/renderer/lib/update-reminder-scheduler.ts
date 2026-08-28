/** 已下载更新的重复提醒间隔：每 4 小时一次。 */
export const UPDATE_REMINDER_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateReminderSchedulerOptions {
  remind: (version: string) => void
  intervalMs?: number
  setIntervalFn?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void
}

export interface UpdateReminderScheduler {
  /** 立即提醒，并开始对同一版本的定期提醒。重复 start 不会创建更多定时器。 */
  start(version: string): void
  /** 停止提醒；应用卸载、更新替换或用户已安排空闲安装时调用。 */
  stop(): void
}

/**
 * 将提醒调度从 React 状态中剥离，确保每个已下载版本最多只有一个计时器。
 */
export function createUpdateReminderScheduler({
  remind,
  intervalMs = UPDATE_REMINDER_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: UpdateReminderSchedulerOptions): UpdateReminderScheduler {
  let version: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = (): void => {
    if (timer) {
      clearIntervalFn(timer)
      timer = null
    }
    version = null
  }

  const start = (nextVersion: string): void => {
    if (version === nextVersion && timer) return

    stop()
    version = nextVersion
    remind(nextVersion)
    timer = setIntervalFn(() => {
      if (version) remind(version)
    }, intervalMs)
  }

  return { start, stop }
}
