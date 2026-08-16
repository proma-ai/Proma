import { describe, expect, test } from 'bun:test'
import type { WebContents } from 'electron'
import type { AgentDeferredQueueMessageInput, AgentQueuedMessageStatus } from '@proma/shared'
import { AgentQueueCoordinator } from './agent-queue-coordinator'

const webContents = { isDestroyed: () => false } as unknown as WebContents

function input(id: string): AgentDeferredQueueMessageInput {
  return {
    queueMessageId: id,
    sessionId: 'session-1',
    userMessage: id,
    rawUserMessage: id,
    channelId: 'channel-1',
  }
}

describe('AgentQueueCoordinator', () => {
  test('waits for the active run and starts queued messages in order', async () => {
    let active = true
    const started: string[] = []
    const statuses: AgentQueuedMessageStatus[] = []
    const coordinator = new AgentQueueCoordinator({
      isActive: () => active,
      getWebContents: () => webContents,
      startRun: async (queued) => { started.push(queued.queueMessageId) },
      sendStarted: (_, status) => statuses.push(status),
    })

    coordinator.enqueue(input('first'))
    coordinator.enqueue(input('second'))
    expect(started).toEqual([])

    active = false
    coordinator.onRunComplete('session-1', undefined, false, false)
    await Promise.resolve()

    expect(started).toEqual(['first'])
    expect(statuses.map((status) => status.messageId)).toEqual(['first'])
    coordinator.onRunComplete('session-1', 'first', false, false)
    await Promise.resolve()
    expect(started).toEqual(['first', 'second'])
  })

  test('cancels and reorders messages without touching the active run', async () => {
    let active = true
    const started: string[] = []
    const coordinator = new AgentQueueCoordinator({
      isActive: () => active,
      getWebContents: () => webContents,
      startRun: async (queued) => { started.push(queued.queueMessageId) },
      sendStarted: () => undefined,
    })

    coordinator.enqueue(input('first'))
    coordinator.enqueue(input('second'))
    coordinator.enqueue(input('third'))
    expect(coordinator.move({
      sessionId: 'session-1',
      sourceId: 'third',
      targetId: 'first',
      placement: 'before',
    })).toBe(true)
    expect(coordinator.cancel({ sessionId: 'session-1', messageId: 'first' })).toBe(true)
    expect(coordinator.cancel({ sessionId: 'session-1', messageId: 'missing' })).toBe(false)

    active = false
    coordinator.onRunComplete('session-1', undefined, false, false)
    await Promise.resolve()
    expect(started).toEqual(['third'])
  })
})
