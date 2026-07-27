import { describe, expect, test } from 'bun:test'
import {
  injectCodexFastMode,
  withCodexFastModeServiceTier,
} from './pi-codex-request-settings'
import { injectOpenAIReasoningLevel } from './pi-openai-reasoning-request-settings'
import { resolveReasoningProfile } from '@proma/shared'

describe('Pi Codex request settings', () => {
  test('Given OpenAI model IDs When resolving profiles Then separates standard, max, and non-reasoning models', () => {
    expect(resolveReasoningProfile({ modelId: 'gpt-5.5', transport: 'openai-responses' })?.id).toBe('openai-reasoning-standard')
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6-terra', transport: 'openai-responses' })?.id).toBe('openai-reasoning-max')
    expect(resolveReasoningProfile({ modelId: 'gpt-4o', transport: 'openai-responses' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: 'gpt-5-chat-latest', transport: 'openai-responses' })).toBeUndefined()
  })

  test.each(['gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'Given supported %s When injecting Then requests priority tier',
    (model) => {
      expect(injectCodexFastMode({ model })).toEqual({ model, service_tier: 'priority' })
    },
  )

  test('Given unsupported model When injecting Then leaves payload unchanged', () => {
    const payload = { model: 'gpt-5.4-mini' }
    expect(injectCodexFastMode(payload)).toBe(payload)
  })

  test('Given existing service tier When injecting Then Fast Mode overrides it', () => {
    expect(injectCodexFastMode({ model: 'gpt-5.6-terra', service_tier: 'flex' })).toEqual({
      model: 'gpt-5.6-terra',
      service_tier: 'priority',
    })
  })

  test('Given provider stream options When applying Fast Mode Then preserves priority tier for cost accounting', () => {
    expect(withCodexFastModeServiceTier({ transport: 'websocket' })).toEqual({
      transport: 'websocket',
      serviceTier: 'priority',
    })
  })

  test('Given thinking is disabled When injecting Then explicitly sends none', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'off' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'none' },
    })
  })

  test('Given direct Codex provider stream When injecting Then fills the selected non-off effort', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'high' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
    })
  })

  test('Given GPT-5.6 max thinking When injecting Then preserves max effort', () => {
    expect(injectOpenAIReasoningLevel({ model: 'gpt-5.6-terra' }, { thinkingLevel: 'max' })).toEqual({
      model: 'gpt-5.6-terra',
      reasoning: { effort: 'max' },
    })
  })

  test('Given an upstream reasoning mode When injecting Then strips mode from the request', () => {
    expect(injectOpenAIReasoningLevel({
      model: 'gpt-5.6',
      reasoning: { effort: 'high', mode: 'pro', summary: 'auto' },
    }, { thinkingLevel: 'high' })).toEqual({
      model: 'gpt-5.6',
      reasoning: { effort: 'high', summary: 'auto' },
    })
  })

  test('Given non-object payload When injecting Then leaves payload unchanged', () => {
    expect(injectCodexFastMode('not-a-request')).toBe('not-a-request')
  })
})
