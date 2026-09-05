import { describe, expect, test } from 'bun:test'
import { resolvePiOpenAIReasoningProfile } from './pi-agent-adapter'

describe('Proma official OpenAI Responses reasoning', () => {
  test.each(['gpt-6-astra', 'gpt-6-astra-1', 'gpt-6-astra-az'])(
    'Given official Astra family model %s When resolving its Pi request profile Then uses Responses reasoning',
    (modelId) => {
      expect(resolvePiOpenAIReasoningProfile('proma', modelId)?.id).toBe('openai-reasoning-astra')
    },
  )

  test('Given an official backend Responses declaration When resolving its Pi request profile Then honors the protocol', () => {
    expect(resolvePiOpenAIReasoningProfile('proma', 'gpt-5.6-variant', 'openai-responses')?.id)
      .toBe('openai-reasoning-max')
  })

  test('Given an official Anthropic model When resolving its Pi request profile Then does not inject OpenAI reasoning', () => {
    expect(resolvePiOpenAIReasoningProfile('proma', 'claude-sonnet-5', 'anthropic-messages')).toBeUndefined()
  })

  test.each(['openai', 'custom'] as const)(
    'Given third-party %s channel with an Astra ID but no Responses protocol When resolving Then does not inject Responses reasoning',
    (provider) => {
      expect(resolvePiOpenAIReasoningProfile(provider, 'gpt-6-astra-az')).toBeUndefined()
    },
  )
})
