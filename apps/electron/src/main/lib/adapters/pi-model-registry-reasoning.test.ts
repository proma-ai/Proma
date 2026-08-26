import { describe, expect, test } from 'bun:test'
import { compilePiChannelReasoningCapabilities, resolvePiReasoningCapability } from './pi-model-registry'

describe('自建模型推理能力', () => {
  const reasoning = {
    levels: ['off', 'low', 'medium', 'high'] as const,
    defaultLevel: 'high' as const,
    thinkingLevelMap: { off: 'none' },
  }

  test('OpenAI 兼容模型注册 reasoning_effort 与档位映射', () => {
    expect(compilePiChannelReasoningCapabilities('openai-completions', {
      ...reasoning,
      levels: [...reasoning.levels],
    })).toEqual({
      compat: { supportsReasoningEffort: true, supportsStrictMode: false },
      thinkingLevelMap: { off: 'none' },
    })
  })

  test('频道声明为目录外模型提供会话级滑杆能力', async () => {
    await expect(resolvePiReasoningCapability('openai', 'qwen3.8-27b-q8', {
      ...reasoning,
      levels: [...reasoning.levels],
    })).resolves.toEqual({
      source: 'channel',
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
    })
  })

  test('Anthropic transport 不应用 OpenAI 推理声明', () => {
    expect(compilePiChannelReasoningCapabilities('anthropic-messages', {
      ...reasoning,
      levels: [...reasoning.levels],
    })).toBeUndefined()
  })

  test('内置模型的已验证 profile 优先于频道声明', async () => {
    await expect(resolvePiReasoningCapability('openai', 'gpt-5.5', {
      levels: ['off', 'high'],
      defaultLevel: 'high',
    })).resolves.toEqual({
      source: 'profile',
      levels: ['off', 'low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'high',
    })
  })
})