import { describe, expect, test } from 'bun:test'
import { OpenAIAdapter } from './openai-adapter.ts'

describe('OpenAIAdapter', () => {
  test('Given 自建模型推理档位 When buildStreamRequest Then 编码 reasoning_effort', () => {
    const request = new OpenAIAdapter().buildStreamRequest({
      baseUrl: 'http://localhost:8001/v1',
      apiKey: 'test',
      modelId: 'qwen3.8-27b-q8',
      history: [],
      userMessage: '你好',
      readImageAttachments: () => [],
      reasoningEffort: 'low',
    })

    expect(JSON.parse(request.body)).toMatchObject({ reasoning_effort: 'low' })
  })
})