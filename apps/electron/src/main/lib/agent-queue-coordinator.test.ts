import { describe, expect, test } from 'bun:test'
import { AgentQueueCoordinator } from './agent-queue-coordinator'

describe('Agent deferred queue', () => {
  test('Given a queued message When checking migration eligibility Then reports the session as pending', () => {
    const coordinator = new AgentQueueCoordinator({
      isActive: () => true,
      getWebContents: () => null,
      startRun: async () => {},
      sendStarted: () => {},
    })

    coordinator.enqueue({
      queueMessageId: 'queued-1',
      sessionId: 'session-1',
      userMessage: 'continue',
      channelId: 'channel-1',
    })

    expect(coordinator.hasPending('session-1')).toBe(true)
    coordinator.clear('session-1')
    expect(coordinator.hasPending('session-1')).toBe(false)
  })
})
