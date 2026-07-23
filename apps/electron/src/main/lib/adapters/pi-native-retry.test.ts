import { describe, expect, test } from 'bun:test'
import { isRetryableAssistantError, type AssistantMessage } from '@earendil-works/pi-ai/compat'

function failedAssistant(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
  } as unknown as AssistantMessage
}

describe('Pi native retry classifier', () => {
  test('classifies an OpenAI Responses terminal-event stream interruption as retryable', () => {
    expect(isRetryableAssistantError(
      failedAssistant('OpenAI Responses stream ended before a terminal response event'),
    )).toBe(true)
  })

  test.each([
    'peer closed connection',
    'incomplete chunked read',
    'peer closed connection without sending complete message body (incomplete chunked read)',
  ])('classifies chunked stream interruption "%s" as retryable', (errorMessage) => {
    expect(isRetryableAssistantError(failedAssistant(errorMessage))).toBe(true)
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
