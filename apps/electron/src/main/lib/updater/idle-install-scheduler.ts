/**
 * 空闲安装调度器
 *
 * 将「更新已下载」与「所有 Agent 已结束」两个条件串联：只要仍有 Agent
 * 处于运行状态，就保留请求并定期重试；条件满足后只执行一次安装回调。
 */

export interface IdleInstallSchedulerOptions {
  /** 当前是否允许安装更新（例如更新仍处于 downloaded 状态且无活跃 Agent） */
  canInstall: () => boolean
  /** 条件满足时执行安装 */
  install: () => void
  /** 轮询间隔，默认 1 秒 */
  intervalMs?: number
  /** 注入时钟以便测试 */
  setIntervalFn?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  /** 注入时钟以便测试 */
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void
}

export interface IdleInstallScheduler {
  /** 请求在安全空闲时安装；重复请求不会重复调度。 */
  request(): void
  /** 取消尚未执行的空闲安装请求。 */
  cancel(): void
  /** 释放定时器。 */
  dispose(): void
}

export function createIdleInstallScheduler({
  canInstall,
  install,
  intervalMs = 1_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: IdleInstallSchedulerOptions): IdleInstallScheduler {
  let requested = false
  let timer: ReturnType<typeof setInterval> | null = null

  const clearTimer = (): void => {
    if (!timer) return
    clearIntervalFn(timer)
    timer = null
  }

  const attemptInstall = (): void => {
    if (!requested) return
    if (!canInstall()) return

    requested = false
    clearTimer()
    install()
  }

  const request = (): void => {
    if (requested) return
    requested = true
    attemptInstall()
    if (requested && !timer) {
      timer = setIntervalFn(attemptInstall, intervalMs)
    }
  }

  const cancel = (): void => {
    requested = false
    clearTimer()
  }

  return { request, cancel, dispose: cancel }
}
