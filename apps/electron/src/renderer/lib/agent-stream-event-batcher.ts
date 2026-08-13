import type { AgentStreamEvent } from '@proma/shared'

export interface AgentStreamEventBatcherOptions {
  dispatch: (event: AgentStreamEvent) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

function isPartialAssistantEvent(event: AgentStreamEvent): boolean {
  return event.payload.kind === 'sdk_message'
    && (event.payload.message as Record<string, unknown>)._partial === true
}

/**
 * renderer 每帧最多处理每个会话的一条 partial；非 partial 直接通过并替换等待中的快照。
 * 这样后台流即使抵达同一帧，也不会在主线程重复执行 live/legacy 两套状态归约。
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
        pending.delete(event.sessionId)
        options.dispatch(event)
        return
      }
      pending.set(event.sessionId, event)
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
