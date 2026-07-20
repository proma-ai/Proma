import { describe, expect, test } from 'bun:test'
import { isPromaOfficialOpenAIReasoningModel } from './agent'

describe('Proma 官方 GPT 思考强度模型', () => {
  test.each([
    'gpt-5.4',
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ])('Given %s When checking official reasoning support Then returns true', (modelId) => {
    expect(isPromaOfficialOpenAIReasoningModel(modelId)).toBe(true)
  })

  test.each(['gpt-5-chat-latest', 'gpt-4.1', 'o4-mini', undefined])(
    'Given %s When checking official reasoning support Then returns false',
    (modelId) => {
      expect(isPromaOfficialOpenAIReasoningModel(modelId)).toBe(false)
    },
  )
})
