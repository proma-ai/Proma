import { describe, expect, test } from 'bun:test'
import {
  normalizeReasoningCapabilityLevel,
  normalizeReasoningLevel,
  resolveReasoningCapability,
  resolveReasoningProfile,
} from './reasoning-profile'

describe('reasoning profile registry', () => {
  test.each(['k3', 'k3-256k', 'kimi-k3'])(
    'Given K3 model %s over Anthropic When resolving Then selects adaptive effort profile',
    (modelId) => {
      const profile = resolveReasoningProfile({ modelId, transport: 'anthropic-messages' })

      expect(profile?.id).toBe('kimi-k3')
      expect(profile?.levels).toEqual(['off', 'low', 'high', 'max'])
      expect(profile?.encodings['anthropic-messages']?.kind).toBe('adaptive-effort')
      expect(normalizeReasoningLevel(profile, 'xhigh')).toBe('max')
    },
  )

  test('Given GLM-5.2 over OpenAI When resolving Then selects Z.AI effort encoding', () => {
    const profile = resolveReasoningProfile({
      modelId: 'glm-5.2',
      transport: 'openai-completions',
    })

    expect(profile?.id).toBe('glm-5.2')
    expect(profile?.levels).toEqual(['off', 'high', 'max'])
    expect(profile?.encodings['openai-completions']?.kind).toBe('zai-thinking-effort')
    expect(normalizeReasoningLevel(profile, 'low')).toBe('high')
  })

  test('Given standard OpenAI reasoning model When resolving Then exposes the standard levels', () => {
    const profile = resolveReasoningProfile({
      modelId: 'o4-mini',
      transport: 'openai-responses',
    })

    expect(profile?.id).toBe('openai-reasoning-standard')
    expect(profile?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh'])
    expect(normalizeReasoningLevel(profile, 'max')).toBe('xhigh')
  })

  test('Given GPT-5.6 When resolving Then exposes max reasoning level', () => {
    const profile = resolveReasoningProfile({
      modelId: 'gpt-5.6-terra',
      transport: 'openai-completions',
    })

    expect(profile?.id).toBe('openai-reasoning-max')
    expect(profile?.levels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('Given chat-latest model When resolving Then does not expose a profile', () => {
    expect(resolveReasoningProfile({
      modelId: 'gpt-5.6-chat-latest',
      transport: 'openai-responses',
    })).toBeUndefined()
  })

  test('Given unsupported transport When resolving Then does not expose a profile', () => {
    expect(resolveReasoningProfile({
      modelId: 'glm-5.2',
      transport: 'openai-responses',
    })).toBeUndefined()
  })
})

describe('Pi catalog reasoning capability', () => {
  test('Given catalog-native adaptive thinking When resolving Then exposes Pi-supported levels', () => {
    expect(resolveReasoningCapability({
      catalog: { reasoning: true, thinkingLevelMap: { off: null, max: 'max' } },
    })).toEqual({
      source: 'pi-catalog',
      levels: ['minimal', 'low', 'medium', 'high', 'max'],
      defaultLevel: 'high',
    })
  })

  test('Given a catalog model without reasoning When resolving Then does not expose a session control', () => {
    expect(resolveReasoningCapability({ catalog: { reasoning: false } })).toBeUndefined()
  })

  test('Given a catalog model with only off When resolving Then does not expose a session control', () => {
    expect(resolveReasoningCapability({
      catalog: { reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null, high: null } },
    })).toBeUndefined()
  })

  test('Given a sparse catalog map When normalizing Then follows Pi upward-then-downward clamping', () => {
    const capability = resolveReasoningCapability({
      catalog: { reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: 'high', max: 'max' } },
    })

    expect(normalizeReasoningCapabilityLevel(capability, 'low')).toBe('high')
    expect(normalizeReasoningCapabilityLevel(capability, 'xhigh')).toBe('max')
    expect(normalizeReasoningCapabilityLevel(capability, 'off')).toBe('high')
  })

  test('Given an explicit profile and catalog metadata When resolving Then profile remains authoritative', () => {
    const profile = resolveReasoningProfile({ modelId: 'k3', transport: 'anthropic-messages' })
    expect(resolveReasoningCapability({
      profile,
      catalog: { reasoning: true, thinkingLevelMap: { low: null, high: null } },
    })).toEqual({
      source: 'profile',
      levels: ['off', 'low', 'high', 'max'],
      defaultLevel: 'high',
    })
  })
})
