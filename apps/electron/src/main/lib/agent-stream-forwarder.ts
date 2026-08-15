import type {
  AgentAssistantDeltaOperation,
  AgentAssistantMessageDelta,
  AgentRunEvent,
  AgentStreamPayload,
} from '@proma/shared'

export const FOREGROUND_PARTIAL_INTERVAL_MS = 50
export const BACKGROUND_PARTIAL_INTERVAL_MS = 250

type TimerHandle = ReturnType<typeof setTimeout>
type AppendOperation = Extract<AgentAssistantDeltaOperation, {
  type: 'append_text' | 'append_thinking'
}>
type ThrottlablePartial = AgentAssistantMessageDelta & { operations: AppendOperation[] }

interface PendingPartial {
  event: AgentRunEvent
  send: (event: AgentRunEvent) => void
  foreground: boolean
  timer?: TimerHandle
}

export interface AgentStreamForwarderOptions {
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
}

function isAppendOperation(operation: AgentAssistantDeltaOperation): operation is AppendOperation {
  return operation.type === 'append_text' || operation.type === 'append_thinking'
}

function isThrottlablePartial(payload: AgentStreamPayload): payload is ThrottlablePartial {
  return payload.kind === 'assistant_message_delta'
    && !payload.reset
    && payload.operations.length > 0
    && payload.operations.every(isAppendOperation)
}

function mergeAppendOperations(
  previous: AppendOperation[],
  next: AppendOperation[],
): AppendOperation[] {
  const merged: AppendOperation[] = []
  for (const operation of [...previous, ...next]) {
    const last = merged[merged.length - 1]
    if (
      last
      && last.type === operation.type
      && last.blockIndex === operation.blockIndex
    ) {
      if (operation.type === 'append_text' && last.type === 'append_text') {
        merged[merged.length - 1] = { ...last, text: last.text + operation.text }
      } else if (operation.type === 'append_thinking' && last.type === 'append_thinking') {
        merged[merged.length - 1] = { ...last, thinking: last.thinking + operation.thinking }
      }
    } else {
      merged.push(operation)
    }
  }
  return merged
}

function mergePartialEvents(
  previous: PendingPartial,
  incoming: AgentRunEvent,
): AgentRunEvent | null {
  const previousPayload = previous.event.payload
  const incomingPayload = incoming.payload
  if (!isThrottlablePartial(previousPayload) || !isThrottlablePartial(incomingPayload)) return null
  if (
    previousPayload.runId !== incomingPayload.runId
    || previousPayload.messageId !== incomingPayload.messageId
  ) return null

  const payload: AgentAssistantMessageDelta = {
    ...incomingPayload,
    operations: mergeAppendOperations(previousPayload.operations, incomingPayload.operations),
    // Renderer 只需要知道这是完整合并后的操作集，不应再要求 sequence 连续。
    coalesced: true,
  }
  return { ...incoming, payload }
}

/**
 * main -> renderer 的按会话流式调度器。
 *
 * Pi-native 已经在 adapter 内把原始字符串合并到 50ms，但后台会话仍不应
 * 以相同频率占用 renderer。这里只合并可安全拼接的文本操作；结构变化、reset
 * 和所有控制/终态事件先 flush，再立即发送。
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

  forward(event: AgentRunEvent, send: (event: AgentRunEvent) => void, foreground: boolean): void {
    const { sessionId, payload } = event
    if (!isThrottlablePartial(payload)) {
      this.emit(sessionId)
      this.lastSentAt.delete(sessionId)
      send(event)
      return
    }

    const existing = this.pending.get(sessionId)
    if (existing) {
      const mergedEvent = mergePartialEvents(existing, event)
      if (mergedEvent) {
        existing.event = mergedEvent
        return
      }
      this.emit(sessionId)
    }

    const pending: PendingPartial = {
      event,
      send,
      foreground,
    }
    this.pending.set(sessionId, pending)
    this.schedulePending(sessionId, pending)
  }

  /** 会话切换前后台时重新安排尚未发送的 partial。 */
  reprioritize(sessionId: string, foreground: boolean): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return
    pending.foreground = foreground
    if (pending.timer) this.cancel(pending.timer)
    this.schedulePending(sessionId, pending)
  }

  /** 切入会话时立即交付已合并快照。 */
  promote(sessionId: string): void {
    this.emit(sessionId)
  }

  /** 终态通知前交付当前 session 尚未发送的最新 partial。 */
  flush(sessionId: string): void {
    this.emit(sessionId)
    this.lastSentAt.delete(sessionId)
  }

  clear(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (pending?.timer) this.cancel(pending.timer)
    this.pending.delete(sessionId)
    this.lastSentAt.delete(sessionId)
  }

  dispose(): void {
    for (const sessionId of this.pending.keys()) this.clear(sessionId)
  }

  private schedulePending(sessionId: string, pending: PendingPartial): void {
    const intervalMs = pending.foreground
      ? FOREGROUND_PARTIAL_INTERVAL_MS
      : BACKGROUND_PARTIAL_INTERVAL_MS
    const lastSentAt = this.lastSentAt.get(sessionId)
    const elapsed = lastSentAt == null ? 0 : this.now() - lastSentAt
    pending.timer = this.schedule(
      () => this.emit(sessionId),
      Math.max(0, intervalMs - elapsed),
    )
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
