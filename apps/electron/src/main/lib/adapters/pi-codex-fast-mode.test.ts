import { describe, expect, test } from 'bun:test'
import {
  injectCodexFastMode,
  injectOpenAIThinkingLevel,
  withCodexFastModeServiceTier,
} from './pi-codex-request-settings'
import { isOpenAIReasoningSupportedModel } from '@proma/shared'

describe('Pi Codex request settings', () => {
  test('Given OpenAI model IDs When checking reasoning support Then excludes non-reasoning GPT-4 models', () => {
    expect(isOpenAIReasoningSupportedModel('gpt-5.6')).toBe(true)
    expect(isOpenAIReasoningSupportedModel('o4-mini')).toBe(true)
    expect(isOpenAIReasoningSupportedModel('gpt-4o')).toBe(false)
    expect(isOpenAIReasoningSupportedModel('gpt-4.1')).toBe(false)
    expect(isOpenAIReasoningSupportedModel('gpt-5-chat-latest')).toBe(false)
    expect(isOpenAIReasoningSupportedModel('gpt-5.3-chat-latest')).toBe(false)
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
    expect(injectOpenAIThinkingLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'off' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'none' },
    })
  })

  test('Given direct Codex provider stream When injecting Then fills the selected non-off effort', () => {
    expect(injectOpenAIThinkingLevel({ model: 'gpt-5.5' }, { thinkingLevel: 'high' })).toEqual({
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
    })
  })

  test('Given an upstream reasoning mode When injecting Then strips mode from the request', () => {
    expect(injectOpenAIThinkingLevel({
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
