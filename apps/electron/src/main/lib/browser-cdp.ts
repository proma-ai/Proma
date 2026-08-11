export const BROWSER_CDP_COMMAND_TIMEOUT_MS = 8_000
export const BROWSER_OBSERVE_TIMEOUT_MS = 5_000
export const BROWSER_OBSERVE_AX_DEPTH = 8
export const BROWSER_OBSERVE_EXTENDED_AX_DEPTH = 16

/**
 * 高预算 Observe 不应仍被浅层 AX tree 截断；默认值保持紧凑，
 * 只有明确请求超过默认容量时才读取更深层的树，避免常规页面观察退化。
 */
export function resolveBrowserObserveAxDepth(maxElements: number): number {
  return maxElements > 240 ? BROWSER_OBSERVE_EXTENDED_AX_DEPTH : BROWSER_OBSERVE_AX_DEPTH
}

export class BrowserCdpTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`浏览器页面未在 ${Math.ceil(timeoutMs / 1_000)} 秒内响应 ${method}，请稍后重试或重新加载页面。`)
    this.name = 'BrowserCdpTimeoutError'
  }
}

/** 已发出的 DevTools 命令无法撤销；该错误只保证不再执行后续页面动作。 */
export class BrowserOperationAbortedError extends Error {
  constructor() {
    super('浏览器操作已停止。已发送的页面指令可能已执行，页面状态请重新观察确认。')
    this.name = 'BrowserOperationAbortedError'
  }
}

export function throwIfBrowserOperationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BrowserOperationAbortedError()
}

/**
 * Electron Debugger 的 sendCommand 在目标页面卡死或 DevTools 通道异常时可能永不 settle。
 * 超时/中止只负责让调用方继续执行；底层 command 后续 settle 时会被安全忽略。
 */
export function withBrowserCdpTimeout<T>(command: () => Promise<T>, method: string, timeoutMs = BROWSER_CDP_COMMAND_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => settle(() => reject(new BrowserOperationAbortedError()))
    const timer = setTimeout(() => settle(() => reject(new BrowserCdpTimeoutError(method, timeoutMs))), timeoutMs)
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    void Promise.resolve()
      .then(command)
      .then((value) => settle(() => resolve(value)))
      .catch((error: unknown) => settle(() => reject(error)))
  })
}
