import { describe, expect, test } from 'bun:test'
import { AgentQueueCoordinator } from './agent-queue-coordinator'
import type { WebContents } from 'electron'
import type { AgentDeferredQueueMessageInput, AgentQueuedMessageStatus } from '@proma/shared'

interface FakeWebContents {
  destroyed: boolean
  isDestroyed(): boolean
}

function createInput(sessionId: string, queueMessageId: string): AgentDeferredQueueMessageInput {
  return {
    sessionId,
    queueMessageId,
    userMessage: `message-${queueMessageId}`,
    channelId: 'channel',
  }
}

function createCoordinator(options?: {
  active?: boolean
  startRun?: (input: AgentDeferredQueueMessageInput, webContents: WebContents) => Promise<void>
  sendStarted?: (webContents: WebContents, status: AgentQueuedMessageStatus) => void
  webContentsAvailable?: boolean
  reserveRunGeneration?: (sessionId: string) => number
}) {
  const fakeWebContents: FakeWebContents = {
    destroyed: false,
    isDestroyed: () => fakeWebContents.destroyed,
  }
  const webContents = fakeWebContents as unknown as WebContents
  const started: AgentQueuedMessageStatus[] = []
  let active = options?.active ?? false
  let targetAvailable = options?.webContentsAvailable ?? true
  let nextRunGeneration = 0
  const coordinator = new AgentQueueCoordinator({
    isActive: () => active,
    getWebContents: () => targetAvailable ? webContents : null,
    startRun: options?.startRun ?? (async () => {}),
    sendStarted: options?.sendStarted ?? ((_webContents, status) => started.push(status)),
    reserveRunGeneration: options?.reserveRunGeneration ?? (() => ++nextRunGeneration),
  })
  return {
    coordinator,
    started,
    setActive: (value: boolean) => { active = value },
    setTargetAvailable: (value: boolean) => { targetAvailable = value },
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('AgentQueueCoordinator', () => {
  test('requeues the message and releases dispatching when notifying the renderer that it started throws', () => {
    let shouldThrow = true
    const { coordinator, started } = createCoordinator({
      startRun: () => new Promise<void>(() => {}),
      sendStarted: (_webContents, status) => {
        if (shouldThrow) throw new Error('renderer was destroyed')
        started.push(status)
      },
    })
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('queued')
    expect(coordinator.isDispatching('session-a')).toBe(false)
    expect(coordinator.hasPending('session-a')).toBe(true)

    shouldThrow = false
    coordinator.onTargetAvailable('session-a')

    expect(started).toHaveLength(1)
    expect(started[0]?.messageId).toBe('message-a')
    expect(coordinator.isDispatching('session-a')).toBe(true)
  })

  test('releases a rejected start run and dispatches the next queued message without an unhandled rejection', async () => {
    let resolveSecondRun: (() => void) | undefined
    const { coordinator, started } = createCoordinator({
      startRun: (input) => {
        if (input.queueMessageId === 'message-a') return Promise.reject(new Error('run failed'))
        return new Promise<void>((resolve) => {
          resolveSecondRun = resolve
        })
      },
    })

    expect(coordinator.enqueue(createInput('session-a', 'message-a'))).toBe('started')
    expect(coordinator.enqueue(createInput('session-a', 'message-b'))).toBe('queued')

    await flushPromises()

    expect(started.map((status) => status.messageId)).toEqual(['message-a', 'message-b'])
    expect(coordinator.isDispatching('session-a')).toBe(true)

    resolveSecondRun?.()
    await flushPromises()

    expect(coordinator.isDispatching('session-a')).toBe(false)
    expect(coordinator.hasPending('session-a')).toBe(false)
  })

  test('reports started when enqueue immediately dispatches, so renderer can remove its optimistic projection', () => {
    const { coordinator, started } = createCoordinator()
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('started')
    expect(started).toHaveLength(1)
    expect(started[0]?.messageId).toBe('message-a')
    expect(coordinator.hasPending('session-a')).toBe(true)
    expect(coordinator.cancel({ sessionId: 'session-a', messageId: 'message-a' })).toBe(false)
  })

  test('uses the lifecycle owner generation for the started projection and run input', async () => {
    const started: AgentQueuedMessageStatus[] = []
    let runInput: AgentDeferredQueueMessageInput | undefined
    const { coordinator } = createCoordinator({
      reserveRunGeneration: () => 42,
      sendStarted: (_webContents, status) => started.push(status),
      startRun: async (input) => { runInput = input },
    })

    expect(coordinator.enqueue(createInput('session-a', 'message-a'))).toBe('started')
    await flushPromises()

    expect(started[0]?.runGeneration).toBe(42)
    expect(runInput?.runGeneration).toBe(42)
  })

  test('reports queued while another run is active and later starts the message', () => {
    const { coordinator, started, setActive } = createCoordinator({ active: true })
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('queued')
    expect(started).toHaveLength(0)
    expect(coordinator.cancel({ sessionId: 'session-a', messageId: 'message-a' })).toBe(true)
    expect(coordinator.hasPending('session-a')).toBe(false)

    coordinator.enqueue(input)
    setActive(false)
    coordinator.onRunComplete('session-a', undefined, false, false)
    expect(started).toHaveLength(1)
    expect(started[0]?.messageId).toBe('message-a')
  })

  test('a queued message remains cancellable when no renderer target is available', () => {
    const coordinator = new AgentQueueCoordinator({
      isActive: () => false,
      getWebContents: () => null,
      startRun: async () => {},
      sendStarted: () => {},
      reserveRunGeneration: () => 1,
    })
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('queued')
    expect(coordinator.cancel({ sessionId: 'session-a', messageId: 'message-a' })).toBe(true)
    expect(coordinator.hasPending('session-a')).toBe(false)
  })

  test('dispatches a queued message when a renderer target becomes available', () => {
    const { coordinator, started, setTargetAvailable } = createCoordinator({ webContentsAvailable: false })
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('queued')
    expect(started).toHaveLength(0)

    setTargetAvailable(true)
    coordinator.onTargetAvailable('session-a')

    expect(started).toHaveLength(1)
    expect(started[0]?.messageId).toBe('message-a')
  })

  test('does not dispatch on target availability while a run is active', () => {
    const { coordinator, started, setActive, setTargetAvailable } = createCoordinator({
      active: true,
      webContentsAvailable: false,
    })
    const input = createInput('session-a', 'message-a')

    expect(coordinator.enqueue(input)).toBe('queued')
    setTargetAvailable(true)
    coordinator.onTargetAvailable('session-a')

    expect(started).toHaveLength(0)
    expect(coordinator.hasPending('session-a')).toBe(true)

    setActive(false)
    coordinator.onRunComplete('session-a', undefined, false, false)
    expect(started).toHaveLength(1)
  })
})
