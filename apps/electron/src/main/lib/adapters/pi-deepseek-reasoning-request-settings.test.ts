import { describe, expect, test } from 'bun:test'
import {
  injectDeepSeekReasoningLevel,
  resolveDeepSeekReasoningProfile,
} from './pi-deepseek-reasoning-request-settings'

describe('Proma 官方 DeepSeek V4 思考深度', () => {
  test('Given 官方 DeepSeek V4 Pro When resolve profile Then uses DeepSeek effort encoding', () => {
    const profile = resolveDeepSeekReasoningProfile('proma', 'deepseek-v4-pro')

    expect(profile?.id).toBe('deepseek-v4-pro')
    expect(profile?.encodings['anthropic-messages']?.kind).toBe('deepseek-output-effort')
  })

  test('Given 官方 DeepSeek V4 Pro and low thinking When inject Then sends its supported effort', () => {
    const profile = resolveDeepSeekReasoningProfile('proma', 'deepseek-v4-pro')

    expect(injectDeepSeekReasoningLevel({
      model: 'deepseek-v4-pro',
      messages: [],
      thinking: { type: 'enabled', budget_tokens: 8192 },
    }, { profile, thinkingLevel: 'low' })).toEqual({
      model: 'deepseek-v4-pro',
      messages: [],
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    })
  })

  test('Given 官方 Claude When resolve profile Then does not install DeepSeek request handling', () => {
    expect(resolveDeepSeekReasoningProfile('proma', 'claude-sonnet-5')).toBeUndefined()
  })
})
