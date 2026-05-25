/**
 * 飞书 Agent run 的并发协调器。
 *
 * 两层并发控制：
 * 1. **per-scope 串行**：同一 scope（chatId 或 chatId:threadId）任一时刻
 *    只允许一个 Agent run。新消息在 ScopedQueue 里 block-accumulate，
 *    run 结束后 unblock 重新 quiet window 后合并 flush。
 * 2. **全局上限**：跨 scope 同时跑的 Agent 数不超过 maxConcurrent，
 *    超过则在 acquire() 处等待（队列化）。
 *
 * 设计参考 zara/feishu-claude-code-bridge `src/bot/active-runs.ts` +
 * `src/bot/process-pool.ts`，但本期不做"新消息打断旧 run"的抢占——
 * 飞书桥用 block-and-merge 模式更友好（参考 ScopedQueue 注释）。
 *
 * 抢占接口（abort）已留好，未来若加"用户主动抢占按钮"可直接复用。
 */

export interface ActiveRunHandle {
  scope: string
  sessionId: string
  startedAt: number
}

export class RunCoordinator {
  private readonly active = new Map<string, ActiveRunHandle>()
  private readonly maxConcurrent: () => number
  private readonly waiters: Array<() => void> = []

  constructor(maxConcurrent: number | (() => number)) {
    this.maxConcurrent = typeof maxConcurrent === 'function'
      ? maxConcurrent
      : () => maxConcurrent
  }

  /** 当前是否已有该 scope 的 run。 */
  isActive(scope: string): boolean {
    return this.active.has(scope)
  }

  /** 当前正在跑的 run 数量（跨 scope 总和）。 */
  size(): number {
    return this.active.size
  }

  /**
   * 申请一个并发槽位 + 注册 ActiveRun。返回 release 函数。
   * 槽位不足时排队等待，先到先得。
   *
   * 调用方约定：拿到 release 后必须放在 try/finally 里调用，否则
   * waiters 永远等不到唤醒。
   */
  async acquire(scope: string, sessionId: string): Promise<() => void> {
    while (this.active.size >= this.maxConcurrent()) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    const handle: ActiveRunHandle = { scope, sessionId, startedAt: Date.now() }
    this.active.set(scope, handle)
    let released = false
    return () => {
      if (released) return
      released = true
      const cur = this.active.get(scope)
      if (cur && cur.sessionId === sessionId) {
        this.active.delete(scope)
      }
      const next = this.waiters.shift()
      if (next) next()
    }
  }

  /**
   * 强制中止某个 scope 的 run（仅注销注册表，不杀 SDK；调用方需自行调
   * stopAgent）。供未来"用户抢占"按钮 / 命令使用，本期未启用。
   */
  abort(scope: string): ActiveRunHandle | undefined {
    const handle = this.active.get(scope)
    if (!handle) return undefined
    this.active.delete(scope)
    const next = this.waiters.shift()
    if (next) next()
    return handle
  }

  /** bridge stop 时调用：清空注册表 + 唤醒所有等待者（让它们 race 到 abort）。 */
  abortAll(): ActiveRunHandle[] {
    const handles = [...this.active.values()]
    this.active.clear()
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()
      if (w) w()
    }
    return handles
  }
}
