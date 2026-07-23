import { describe, expect, test } from 'bun:test'
import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import type { SDKAssistantMessage } from '@proma/shared'
import {
  convertPiMessage,
  convertResultMessage,
  getPiAssistantErrorDetails,
  hasPiAssistantTextContent,
  stripPiAssistantError,
} from './pi-message-adapter'

function writeToolCall(content: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: 'tool-call-1',
      name: 'write',
      arguments: {
        path: 'C:\\Users\\WNI10\\.proma\\agent-workspaces\\moneybull\\workspace-files\\large.md',
        content,
      },
    }],
  } as unknown as AssistantMessage
}

describe('convertPiMessage', () => {
  test('omits cumulative write content from partial tool-call frames', () => {
    const message = convertPiMessage(writeToolCall('x'.repeat(10_240)), 'session-1', undefined, {
      final: false,
      uuid: 'assistant-1',
    }) as { _partial?: boolean; message: { content: Array<{ input?: unknown }> } }

    expect(message._partial).toBe(true)
    expect(message.message.content[0]?.input).toEqual({})
    expect(JSON.stringify(message).length).toBeLessThan(1_000)
  })

  test('keeps complete write input in the final tool-call frame', () => {
    const content = 'x'.repeat(10_240)
    const message = convertPiMessage(writeToolCall(content), 'session-1', undefined, {
      final: true,
      uuid: 'assistant-1',
    }) as { message: { content: Array<{ input?: Record<string, unknown> }> } }

    expect(message.message.content[0]?.input).toEqual({
      path: 'C:\\Users\\WNI10\\.proma\\agent-workspaces\\moneybull\\workspace-files\\large.md',
      file_path: 'C:\\Users\\WNI10\\.proma\\agent-workspaces\\moneybull\\workspace-files\\large.md',
      content,
    })
    expect(JSON.stringify(message).length).toBeGreaterThan(content.length)
  })

  test('only persists errors for terminal Pi failures', () => {
    const providerError = 'stream ended before a terminal response event'
    const partialStop = convertPiMessage({
      role: 'assistant', content: [], stopReason: 'stop', errorMessage: providerError,
    } as unknown as AssistantMessage, 'session-1') as { error?: unknown }
    const terminalError = convertPiMessage({
      role: 'assistant', content: [], stopReason: 'error', errorMessage: providerError,
    } as unknown as AssistantMessage, 'session-1') as { error?: { message?: string; errorType?: string } }

    expect(partialStop.error).toBeUndefined()
    expect(terminalError.error).toEqual({
      message: providerError,
      errorType: 'network_error',
    })
  })

  test('keeps non-network terminal Pi errors as provider_error', () => {
    const terminalError = convertPiMessage({
      role: 'assistant', content: [], stopReason: 'error', errorMessage: '529 overloaded',
    } as unknown as AssistantMessage, 'session-1') as { error?: { message?: string; errorType?: string } }

    expect(terminalError.error).toEqual({ message: '529 overloaded', errorType: 'provider_error' })
  })

  test.each([
    'peer closed connection',
    'incomplete chunked read',
    'peer closed connection without sending complete message body (incomplete chunked read)',
  ])('classifies terminal Pi transport error "%s" as network_error', (errorMessage) => {
    const terminalError = convertPiMessage({
      role: 'assistant', content: [], stopReason: 'error', errorMessage,
    } as unknown as AssistantMessage, 'session-1') as { error?: { message?: string; errorType?: string } }

    expect(terminalError.error).toEqual({ message: errorMessage, errorType: 'network_error' })
  })

  test('keeps generated text separate from a terminal transport error', () => {
    const body = 'Generated assistant output must not appear inside the error card.'
    const transportError = 'peer closed connection without sending complete message body (incomplete chunked read)'
    const terminalError = convertPiMessage({
      role: 'assistant',
      content: [{ type: 'text', text: body }],
      stopReason: 'error',
      errorMessage: transportError,
    } as unknown as AssistantMessage, 'session-1') as SDKAssistantMessage

    expect(getPiAssistantErrorDetails(terminalError)).toEqual({
      detailedMessage: transportError,
      originalError: transportError,
    })
    expect(hasPiAssistantTextContent(terminalError)).toBe(true)
    expect(stripPiAssistantError(terminalError).error).toBeUndefined()
    expect(terminalError.message.content).toEqual([{ type: 'text', text: body }])
    expect(terminalError.error).toEqual({ message: transportError, errorType: 'network_error' })
  })

  test('only reports result errors for terminal Pi failures', () => {
    const providerError = 'stream ended before a terminal response event'
    const partialStop = convertResultMessage([{
      role: 'assistant', content: [], stopReason: 'stop', errorMessage: providerError,
    } as unknown as AssistantMessage], 'session-1') as { subtype?: string; errors?: string[] }
    const terminalError = convertResultMessage([{
      role: 'assistant', content: [], stopReason: 'error', errorMessage: providerError,
    } as unknown as AssistantMessage], 'session-1') as { subtype?: string; errors?: string[] }

    expect(partialStop.subtype).toBe('success')
    expect(partialStop.errors).toBeUndefined()
    expect(terminalError.subtype).toBe('error_during_execution')
    expect(terminalError.errors).toEqual([providerError])
  })
})
