import { describe, expect, test } from 'bun:test'
import { isRetryableAssistantError, retryAssistantCall, retryDelayMs, type AssistantMessage } from '@earendil-works/pi-ai/compat'
import {
  PI_NATIVE_MAX_DELAY_MS,
  PI_NATIVE_MAX_RETRIES,
  PI_NATIVE_RETRY_BASE_DELAY_MS,
} from './pi-agent-adapter'

function failedAssistant(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
  } as unknown as AssistantMessage
}

function totalRetryDelay(): number {
  return Array.from({ length: PI_NATIVE_MAX_RETRIES }, (_, index) => retryDelayMs({
    baseDelayMs: PI_NATIVE_RETRY_BASE_DELAY_MS,
    maxAgentDelayMs: PI_NATIVE_MAX_DELAY_MS,
  }, index + 1)).reduce((total, delay) => total + delay, 0)
}

describe('Pi native retry classifier', () => {
  test('keeps Proma retry budget near ten minutes while bounding each wait to one minute', () => {
    const policy = {
      baseDelayMs: PI_NATIVE_RETRY_BASE_DELAY_MS,
      maxAgentDelayMs: PI_NATIVE_MAX_DELAY_MS,
    }

    expect(retryDelayMs(policy, 6)).toBe(32_000)
    expect(retryDelayMs(policy, 7)).toBe(60_000)
    expect(totalRetryDelay()).toBe(543_000)
    expect(totalRetryDelay()).toBeLessThanOrEqual(600_000)
  })
  test('classifies an OpenAI Responses terminal-event stream interruption as retryable', () => {
    expect(isRetryableAssistantError(
      failedAssistant('OpenAI Responses stream ended before a terminal response event'),
    )).toBe(true)
  })

  test('classifies an OpenAI-compatible terminal-event stream interruption as retryable', () => {
    expect(isRetryableAssistantError(
      failedAssistant('Error Code undefined: Upstream Responses stream ended before a terminal event'),
    )).toBe(true)
  })

  test('classifies a corrupted upstream JSON response as retryable', () => {
    expect(isRetryableAssistantError(
      failedAssistant('Unexpected non-whitespace character after JSON at position 199 (line 2 column 1)'),
    )).toBe(true)
  })

  test.each([
    'peer closed connection',
    'incomplete chunked read',
    'peer closed connection without sending complete message body (incomplete chunked read)',
    'Connection error. Failed to fetch',
    'TypeError: Failed to fetch',
  ])('classifies transient transport interruption "%s" as retryable', (errorMessage) => {
    expect(isRetryableAssistantError(failedAssistant(errorMessage))).toBe(true)
  })

  test('retries Failed to fetch through Pi’s actual native retry loop', async () => {
    let calls = 0
    const result = await retryAssistantCall(async () => {
      calls += 1
      return calls === 1
        ? failedAssistant('TypeError: Failed to fetch')
        : { role: 'assistant', content: [], stopReason: 'stop' } as unknown as AssistantMessage
    }, { enabled: true, maxRetries: 1, baseDelayMs: 0 }, undefined)

    expect(calls).toBe(2)
    expect(result.stopReason).toBe('stop')
  })

  test('does not broadly retry unrelated stream-ended errors', () => {
    expect(isRetryableAssistantError(
      failedAssistant('stream ended before the model emitted a local marker'),
    )).toBe(false)
  })

  test('keeps non-transient quota failures non-retryable', () => {
    expect(isRetryableAssistantError(
      failedAssistant('429 insufficient_quota: billing limit reached'),
    )).toBe(false)
  })
})
