import { describe, expect, test } from 'bun:test'
import { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import { createPiAssistantUuidTracker } from './pi-agent-adapter'

interface NativeRetrySettings {
  enabled: boolean
  maxRetries: number
  baseDelayMs: number
  jitterRatio: number
  maxTotalRetries: number
  maxTotalDelayMs: number
}

interface NativeRetryEvent {
  type: string
  [key: string]: unknown
}

interface TestAgent {
  state: { messages: Array<{ role: string }> }
  prompt: (messages: unknown) => Promise<void>
  continue: () => Promise<void>
  hasQueuedMessages: () => boolean
}

interface TestAgentSession {
  agent: TestAgent
  settingsManager: { getRetrySettings: () => NativeRetrySettings }
  _retryAttempt: number
  _retryRunAttempts: number
  _retryRunDelayMs: number
  _pendingRetryAttemptStart?: NativeRetryEvent
  _lastAssistantMessage?: AssistantMessage
  _emit: (event: NativeRetryEvent) => void
  _isRetryableError: (message: AssistantMessage) => boolean
  _checkCompaction: (message: AssistantMessage) => Promise<boolean>
  _flushPendingBashMessages: () => void
  _emitAgentSettled: () => Promise<void>
  _runAgentPrompt: (messages: unknown) => Promise<void>
  _prepareRetry: (message: AssistantMessage) => Promise<boolean>
  _willRetryAfterAgentEnd: (event: { messages: Array<{ role: string }> }) => boolean
}

function failedAssistant(errorMessage = 'TypeError: Failed to fetch'): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
  } as unknown as AssistantMessage
}

function successfulAssistant(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'stop',
  } as unknown as AssistantMessage
}

function abortedAssistant(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'aborted',
  } as unknown as AssistantMessage
}

function createTestSession(settings: NativeRetrySettings): {
  session: TestAgentSession
  events: NativeRetryEvent[]
  getContinueCalls: () => number
} {
  const events: NativeRetryEvent[] = []
  let continueCalls = 0
  const session = Object.create(AgentSession.prototype) as TestAgentSession
  const agent: TestAgent = {
    state: { messages: [] },
    prompt: async () => {
      const failed = failedAssistant()
      agent.state.messages = [failed]
      session._lastAssistantMessage = failed
    },
    continue: async () => {
      continueCalls += 1
      session._lastAssistantMessage = successfulAssistant()
    },
    hasQueuedMessages: () => false,
  }

  session.agent = agent
  session.settingsManager = { getRetrySettings: () => settings }
  session._retryAttempt = 0
  session._retryRunAttempts = 0
  session._retryRunDelayMs = 0
  session._emit = (event) => { events.push(event) }
  session._isRetryableError = (message) => message.stopReason === 'error'
  session._checkCompaction = async () => false
  session._flushPendingBashMessages = () => {}
  session._emitAgentSettled = async () => {}

  return { session, events, getContinueCalls: () => continueCalls }
}

describe('patched Pi AgentSession retry policy', () => {
  test('emits scheduled before actual retry start and preserves native continue', async () => {
    const { session, events, getContinueCalls } = createTestSession({
      enabled: true,
      maxRetries: 8,
      maxTotalRetries: 8,
      baseDelayMs: 0,
      maxTotalDelayMs: 300_000,
      jitterRatio: 0.2,
    })

    await session._runAgentPrompt('hello')

    expect(events.map((event) => event.type)).toEqual([
      'auto_retry_start',
      'auto_retry_attempt_start',
    ])
    expect(getContinueCalls()).toBe(1)
    expect(events[0]).toMatchObject({ attempt: 1, totalAttempt: 1, delayMs: 0 })
    expect(events[1]).toMatchObject({ attempt: 1, totalAttempt: 1, delayMs: 0 })
  })

  test('applies bounded jitter and caps cumulative retry wait budget', async () => {
    const originalRandom = Math.random
    Math.random = () => 1
    try {
      const { session, events } = createTestSession({
        enabled: true,
        maxRetries: 8,
        maxTotalRetries: 8,
        baseDelayMs: 10,
        maxTotalDelayMs: 15,
        jitterRatio: 0.2,
      })
      const failed = failedAssistant()
      session.agent.state.messages = [failed]

      expect(await session._prepareRetry(failed)).toBe(true)
      expect(events[0]).toMatchObject({ type: 'auto_retry_start', delayMs: 12, totalDelayMs: 12 })

      // 模拟一段成功响应：连续失败段归零，但本轮累计预算保持。
      session._retryAttempt = 0
      session.agent.state.messages = [failed]
      expect(await session._prepareRetry(failed)).toBe(true)
      expect(events[1]).toMatchObject({ type: 'auto_retry_start', delayMs: 3, totalDelayMs: 15 })
    } finally {
      Math.random = originalRandom
    }
  })

  test('refuses a new retry when the top-level run budget is exhausted before agent_end', async () => {
    const { session } = createTestSession({
      enabled: true,
      maxRetries: 8,
      maxTotalRetries: 1,
      baseDelayMs: 0,
      maxTotalDelayMs: 300_000,
      jitterRatio: 0,
    })
    const failed = failedAssistant()
    session.agent.state.messages = [failed]

    expect(await session._prepareRetry(failed)).toBe(true)
    session._retryAttempt = 0 // 模拟前一段 retry 已成功恢复

    expect(session._willRetryAfterAgentEnd({ messages: [failed] })).toBe(false)
    expect(await session._prepareRetry(failed)).toBe(false)
  })

  test('keeps a partial assistant UUID through native recovery and releases it after the final response', () => {
    let nextUuid = 0
    const tracker = createPiAssistantUuidTracker(() => `assistant-${++nextUuid}`)

    const partialUuid = tracker.get()
    // retryable message_end + agent_end.willRetry=true：adapter 保留 tracker，
    // 所以恢复后的 message_update 会原地替换此前的 partial。
    expect(tracker.get()).toBe(partialUuid)

    // 成功的最终 assistant frame 收束这条流，下一次回答才会分配新 UUID。
    tracker.reset()
    expect(tracker.get()).toBe('assistant-2')
  })

  test('maps an abort during an actual retry request to cancelled instead of succeeded', async () => {
    const prototype = AgentSession.prototype as unknown as Record<string, unknown>
    const originalInstallToolHooks = prototype._installAgentToolHooks
    const originalInstallNextTurnRefresh = prototype._installAgentNextTurnRefresh
    const originalBuildRuntime = prototype._buildRuntime
    prototype._installAgentToolHooks = () => {}
    prototype._installAgentNextTurnRefresh = () => {}
    prototype._buildRuntime = () => {}

    try {
      const events: NativeRetryEvent[] = []
      const session = new AgentSession({
        agent: {
          state: { messages: [] },
          subscribe: () => () => {},
        },
        sessionManager: { appendMessage: () => {} },
        settingsManager: {
          getRetrySettings: () => ({
            enabled: true,
            maxRetries: 8,
            maxTotalRetries: 8,
            baseDelayMs: 0,
            maxTotalDelayMs: 300_000,
            jitterRatio: 0,
          }),
        },
        resourceLoader: {},
        cwd: process.cwd(),
        modelRuntime: {},
      } as never) as unknown as TestAgentSession & {
        _handleAgentEvent: (event: unknown) => Promise<void>
        _emitExtensionEvent: (event: unknown) => Promise<void>
      }

      session._emit = (event) => { events.push(event) }
      session._emitExtensionEvent = async () => {}
      session._retryAttempt = 1
      session._retryRunAttempts = 1

      await session._handleAgentEvent({ type: 'message_end', message: abortedAssistant() })

      expect(events).toContainEqual(expect.objectContaining({
        type: 'auto_retry_end',
        success: false,
        outcome: 'cancelled',
        attempt: 1,
        totalAttempt: 1,
      }))
    } finally {
      prototype._installAgentToolHooks = originalInstallToolHooks
      prototype._installAgentNextTurnRefresh = originalInstallNextTurnRefresh
      prototype._buildRuntime = originalBuildRuntime
    }
  })
})
