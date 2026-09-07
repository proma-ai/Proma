import { describe, expect, test } from 'bun:test'
import { isCodexFastModeSupportedModel, isPromaOfficialOpenAIReasoningModel } from './agent'

describe('Proma 官方 GPT 思考强度模型', () => {
  test.each([
    'gpt-5.4',
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-6-astra',
    'gpt-6-astra-1',
    'gpt-6-astra-az',
  ])('Given %s When checking official reasoning support Then returns true', (modelId) => {
    expect(isPromaOfficialOpenAIReasoningModel(modelId)).toBe(true)
  })

  test.each(['gpt-5-chat-latest', 'gpt-4.1', 'gpt-6-astral', 'gpt-6-astrafoo', 'gpt-6-astra_', 'gpt-6-astra-', 'gpt-6-astro', 'o4-mini', undefined])(
    'Given %s When checking official reasoning support Then returns false',
    (modelId) => {
      expect(isPromaOfficialOpenAIReasoningModel(modelId)).toBe(false)
    },
  )

  test.each(['gpt-6-astra', 'gpt-6-astra-1', 'gpt-6-astra-az'])(
    'Given Astra family model %s When checking Codex Fast Mode Then returns true',
    (modelId) => {
      expect(isCodexFastModeSupportedModel(modelId)).toBe(true)
    },
  )

  test.each(['gpt-6-astral', 'gpt-6-astrafoo', 'gpt-6-astra_', 'gpt-6-astra-', 'gpt-6-astro'])(
    'Given non-Astra model %s When checking Codex Fast Mode Then returns false',
    (modelId) => {
      expect(isCodexFastModeSupportedModel(modelId)).toBe(false)
    },
  )
})
