import { describe, expect, test } from 'bun:test'
import {
  shouldForcePiAdaptiveThinking,
  shouldForcePromaOfficialClaudeAdaptiveThinking,
} from './pi-model-registry'

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

  test('Given an official Claude model, when its Anthropic catalog entry requires adaptive thinking, then enables it', () => {
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('claude-sonnet-5', 'anthropic-messages', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true },
    })).toBe(true)
  })

  test('Given an official GPT or Kimi model, when a catalog entry has the flag, then never treats it as Claude adaptive thinking', () => {
    const adaptiveAnthropicCatalog = {
      api: 'anthropic-messages' as const,
      compat: { forceAdaptiveThinking: true },
    }
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('gpt-5.6-terra', 'openai-responses', adaptiveAnthropicCatalog)).toBe(false)
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('k3', 'anthropic-messages', adaptiveAnthropicCatalog)).toBe(false)
  })
})
