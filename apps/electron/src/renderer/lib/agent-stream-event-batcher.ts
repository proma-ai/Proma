import type { AgentStreamEvent } from '@proma/shared'

export interface AgentStreamEventBatcherOptions {
  dispatch: (event: AgentStreamEvent) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

function isPartialAssistantEvent(event: AgentStreamEvent): boolean {
  return event.payload.kind === 'sdk_delta'
    || (event.payload.kind === 'sdk_message'
      && (event.payload.message as Record<string, unknown>)._partial === true)
}

function mergePendingEvents(current: AgentStreamEvent, next: AgentStreamEvent): AgentStreamEvent {
  if (current.payload.kind !== 'sdk_delta' || next.payload.kind !== 'sdk_delta') return next
  if (current.payload.delta.uuid !== next.payload.delta.uuid) return next
  if (current.payload.delta.runStartedAt !== next.payload.delta.runStartedAt) return next
  return {
    ...next,
    payload: {
      kind: 'sdk_delta',
      delta: {
        ...next.payload.delta,
        deltas: [...current.payload.delta.deltas, ...next.payload.delta.deltas],
      },
    },
  }
}

/**
 * renderer 每帧最多处理每个会话的一组 Delta；非 Delta 会先交付尚未发送的增量。
 * 这样后台流即使抵达同一帧，也不会丢失 token 或覆盖状态事件顺序。
 */
export function createAgentStreamEventBatcher(options: AgentStreamEventBatcherOptions) {
  const pending = new Map<string, AgentStreamEvent>()
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame
  let frame: number | null = null

  const flush = (): void => {
    frame = null
    const events = [...pending.values()]
    pending.clear()
    for (const event of events) options.dispatch(event)
  }

  return {
    push(event: AgentStreamEvent): void {
      if (!isPartialAssistantEvent(event)) {
        const existing = pending.get(event.sessionId)
        if (existing) {
          pending.delete(event.sessionId)
          options.dispatch(existing)
        }
        options.dispatch(event)
        return
      }
      const existing = pending.get(event.sessionId)
      if (
        existing?.payload.kind === 'sdk_delta'
        && (event.payload.kind !== 'sdk_delta'
          || existing.payload.delta.uuid !== event.payload.delta.uuid
          || existing.payload.delta.runStartedAt !== event.payload.delta.runStartedAt)
      ) {
        pending.delete(event.sessionId)
        options.dispatch(existing)
      }
      pending.set(event.sessionId, existing ? mergePendingEvents(existing, event) : event)
      if (frame === null) frame = requestFrame(flush)
    },
    clear(sessionId: string): void {
      pending.delete(sessionId)
    },
    dispose(): void {
      if (frame !== null) cancelFrame(frame)
      frame = null
      pending.clear()
    },
  }
}
