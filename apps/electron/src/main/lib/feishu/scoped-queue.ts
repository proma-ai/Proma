/**
 * Per-scope 防抖累积队列。
 *
 * Scope 通常是 chatId（p2p / 普通群）或 `chatId:threadId`（话题群），
 * 同一 scope 内的消息在 quiet window 内会被合并成一个 batch 一起处理。
 *
 * 关键语义（参考 zara/feishu-claude-code-bridge `src/bot/pending-queue.ts`）：
 * - push: 加消息到队列，arm/重置 quiet window timer
 * - block: Agent run 期间禁止 timer 触发，新消息继续累积
 * - unblock: run 结束后重新 arm 一次 quiet window，让"run 期间累积的消息"
 *   再次走 quiet window 才合并 flush（避免用户刚发完 Agent 就立刻抢答）
 *
 * 这个模式解决两个真实痛点：
 *   1. 用户连发 3 条 → 不会触发 3 个并行 Agent
 *   2. Agent 跑期间用户又发了 → 不打断当前 run，等结束再合并处理新消息
 */

export interface QueuedMessage<T> {
  scope: string
  payload: T
  enqueuedAt: number
}

export type FlushHandler<T> = (scope: string, batch: T[]) => void

interface PendingEntry<T> {
  messages: T[]
  timer?: NodeJS.Timeout
}

export class ScopedQueue<T> {
  private readonly map = new Map<string, PendingEntry<T>>()
  private readonly blocked = new Set<string>()
  private readonly delayMs: number
  private readonly onFlush: FlushHandler<T>

  constructor(delayMs: number, onFlush: FlushHandler<T>) {
    this.delayMs = delayMs
    this.onFlush = onFlush
  }

  /**
   * 累积一条消息到 scope 队列，重置 quiet window timer。
   * 若该 scope 已 block，timer 不会被 arm（消息只累积，不 flush）。
   * 返回当前队列里同一 scope 的消息数量（含本次）。
   */
  push(scope: string, payload: T): number {
    const existing = this.map.get(scope)
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer)
      existing.messages.push(payload)
      existing.timer = this.blocked.has(scope) ? undefined : this.armTimer(scope)
      return existing.messages.length
    }
    this.map.set(scope, {
      messages: [payload],
      timer: this.blocked.has(scope) ? undefined : this.armTimer(scope),
    })
    return 1
  }

  /**
   * 取消 scope 的待 flush 队列并返回当前累积的消息。
   * 用于命令直通场景：命令应跳过防抖立即处理，同时丢弃此前累积的普通消息。
   */
  cancel(scope: string): T[] {
    const entry = this.map.get(scope)
    if (!entry) return []
    if (entry.timer) clearTimeout(entry.timer)
    this.map.delete(scope)
    return entry.messages
  }

  /**
   * 清空所有 scope 的队列与 block 标记。bridge stop 时调用。
   */
  cancelAll(): void {
    for (const entry of this.map.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.map.clear()
    this.blocked.clear()
  }

  /**
   * 暂停 scope 的 timer：累积仍在，但不会触发 flush。
   * Agent run 开始时调用。
   */
  block(scope: string): void {
    if (this.blocked.has(scope)) return
    this.blocked.add(scope)
    const entry = this.map.get(scope)
    if (entry?.timer) {
      clearTimeout(entry.timer)
      entry.timer = undefined
    }
  }

  /**
   * 恢复 scope 的 timer：若期间累积了消息，arm 一个全新的 quiet window。
   * Agent run 结束时调用。
   */
  unblock(scope: string): void {
    if (!this.blocked.has(scope)) return
    this.blocked.delete(scope)
    const entry = this.map.get(scope)
    if (!entry || entry.messages.length === 0) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = this.armTimer(scope)
  }

  /** 当前 scope 是否还有待 flush 的消息。 */
  hasPending(scope: string): boolean {
    return (this.map.get(scope)?.messages.length ?? 0) > 0
  }

  private armTimer(scope: string): NodeJS.Timeout {
    return setTimeout(() => this.flush(scope), this.delayMs)
  }

  private flush(scope: string): void {
    const entry = this.map.get(scope)
    if (!entry) return
    this.map.delete(scope)
    try {
      this.onFlush(scope, entry.messages)
    } catch (err) {
      console.error('[飞书 ScopedQueue] flush 处理失败', { scope, err })
    }
  }
}
