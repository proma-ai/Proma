import { describe, expect, test } from 'bun:test'
import { shouldForcePiAdaptiveThinking } from './pi-model-registry'

describe('shouldForcePiAdaptiveThinking', () => {
  test('Given Anthropic Messages Claude catalog requires adaptive thinking, when Proma re-registers it, then preserves the flag', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
    })).toBe(true)
  })

  test('Given a missing flag or non-Anthropic catalog, when resolving compat, then does not inherit adaptive thinking', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'anthropic-messages',
      compat: { supportsStrictTools: true },
    })).toBe(false)
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'openai-responses',
      compat: { forceAdaptiveThinking: true },
    })).toBe(false)
  })

  test('Given an OpenAI runtime model, when a catalog entry contains the Claude flag, then does not leak it across protocols', () => {
    expect(shouldForcePiAdaptiveThinking('openai-responses', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true },
    })).toBe(false)
  })
})
