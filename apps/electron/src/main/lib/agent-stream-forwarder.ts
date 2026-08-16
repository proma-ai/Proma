import type { AgentStreamEvent, AgentStreamPayload, SDKMessage } from '@proma/shared'

export const FOREGROUND_PARTIAL_INTERVAL_MS = 50
export const BACKGROUND_PARTIAL_INTERVAL_MS = 250

type TimerHandle = ReturnType<typeof setTimeout>

interface PendingPartial {
  event: AgentStreamEvent
  send: (event: AgentStreamEvent) => void
  timer?: TimerHandle
}

export interface AgentStreamForwarderOptions {
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
}

function isPartialAssistantPayload(payload: AgentStreamPayload): boolean {
  return payload.kind === 'sdk_message'
    && (payload.message as SDKMessage & { _partial?: unknown })._partial === true
}

/**
 * 在 main → renderer 边界合并 Pi 的累计 partial 消息。
 *
 * 前台会话保持 20fps，后台会话降为 4fps；终态消息直接发送并丢弃旧 partial，
 * 从而不会在 final 后倒灌一个过期快照。
 */
export class AgentStreamForwarder {
  private readonly pending = new Map<string, PendingPartial>()
  private readonly lastSentAt = new Map<string, number>()
  private readonly now: () => number
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle
  private readonly cancel: (timer: TimerHandle) => void

  constructor(options: AgentStreamForwarderOptions = {}) {
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancel = options.cancel ?? clearTimeout
  }

  forward(
    event: AgentStreamEvent,
    send: (event: AgentStreamEvent) => void,
    foreground: boolean,
  ): void {
    const { sessionId, payload } = event
    if (!isPartialAssistantPayload(payload)) {
      this.clear(sessionId)
      send(event)
      return
    }

    const existing = this.pending.get(sessionId)
    if (existing) {
      existing.event = event
      existing.send = send
      return
    }

    const pending: PendingPartial = { event, send }
    this.pending.set(sessionId, pending)
    this.schedulePending(sessionId, pending, foreground)
  }

  /** 会话切换前后台时按新频率重排尚未发送的快照。 */
  reprioritize(sessionId: string, foreground: boolean): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return
    if (pending.timer) this.cancel(pending.timer)
    this.schedulePending(sessionId, pending, foreground)
  }

  /** 当前会话切到前台时立即交付已合并快照，避免等待后台的 250ms 窗口。 */
  promote(sessionId: string): void {
    if (this.pending.has(sessionId)) this.emit(sessionId)
  }

  clear(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (pending?.timer) this.cancel(pending.timer)
    this.pending.delete(sessionId)
    this.lastSentAt.delete(sessionId)
  }

  private schedulePending(sessionId: string, pending: PendingPartial, foreground: boolean): void {
    const intervalMs = foreground ? FOREGROUND_PARTIAL_INTERVAL_MS : BACKGROUND_PARTIAL_INTERVAL_MS
    const elapsed = this.now() - (this.lastSentAt.get(sessionId) ?? 0)
    pending.timer = this.schedule(() => this.emit(sessionId), Math.max(0, intervalMs - elapsed))
  }

  private emit(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return
    this.pending.delete(sessionId)
    if (pending.timer) this.cancel(pending.timer)
    this.lastSentAt.set(sessionId, this.now())
    pending.send(pending.event)
  }
}
