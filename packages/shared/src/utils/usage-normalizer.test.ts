import { test, expect, describe } from 'bun:test'
import { normalizeUsage, isOpenAICompatibleProvider } from './usage-normalizer'
import type { AnthropicLikeUsage } from './usage-normalizer'

describe('normalizeUsage', () => {
  describe('OpenAI 兼容渠道（zhipu / openai / doubao / qwen / custom）', () => {
    test('从 input_tokens 中扣减 cache_read，避免下游公式重复计数', () => {
      // GLM 实际场景：prompt_tokens=100 含 80 命中缓存
      const usage: AnthropicLikeUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
      }
      const out = normalizeUsage(usage, 'zhipu')
      expect(out?.input_tokens).toBe(20)
      expect(out?.cache_read_input_tokens).toBe(80)
      expect(out?.output_tokens).toBe(50)
      // 归一化后：20 + 80 = 100 = 真实总输入
    })

    test('同时存在 cache_read 与 cache_creation 时一并扣减', () => {
      const usage: AnthropicLikeUsage = {
        input_tokens: 200,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 40,
      }
      const out = normalizeUsage(usage, 'openai')
      expect(out?.input_tokens).toBe(80) // 200 - 80 - 40
      // 归一化后：80 + 80 + 40 = 200
    })

    test('端点已按 Anthropic 口径上报（input < cached）时不扣减，尊重端点原值', () => {
      const usage: AnthropicLikeUsage = {
        input_tokens: 30,
        cache_read_input_tokens: 80,
      }
      const out = normalizeUsage(usage, 'zhipu')
      expect(out?.input_tokens).toBe(30)
    })

    test('无缓存字段时原样返回', () => {
      const usage: AnthropicLikeUsage = { input_tokens: 100, output_tokens: 50 }
      const out = normalizeUsage(usage, 'qwen')
      expect(out).toEqual(usage)
    })

    test('不修改入参对象', () => {
      const usage: AnthropicLikeUsage = {
        input_tokens: 100,
        cache_read_input_tokens: 80,
      }
      const snapshot = { ...usage }
      normalizeUsage(usage, 'zhipu')
      expect(usage).toEqual(snapshot)
    })

    test('所有 OpenAI 兼容 provider 都触发归一化', () => {
      for (const p of ['openai', 'zhipu', 'doubao', 'qwen', 'custom'] as const) {
        const out = normalizeUsage({ input_tokens: 100, cache_read_input_tokens: 80 }, p)
        expect(out?.input_tokens).toBe(20)
      }
    })
  })

  describe('Anthropic 原生 / 兼容渠道（不归一化）', () => {
    test('anthropic provider 原样返回', () => {
      const usage: AnthropicLikeUsage = {
        input_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 0,
      }
      const out = normalizeUsage(usage, 'anthropic')
      expect(out).toBe(usage)
    })

    test('zhipu-coding（走 Anthropic 兼容协议）原样返回', () => {
      const usage: AnthropicLikeUsage = {
        input_tokens: 20,
        cache_read_input_tokens: 80,
      }
      const out = normalizeUsage(usage, 'zhipu-coding')
      expect(out).toBe(usage)
    })

    test('kimi-coding / minimax / xiaomi 等 Anthropic 兼容渠道原样返回', () => {
      for (const p of ['kimi-coding', 'minimax', 'xiaomi', 'deepseek', 'anthropic-compatible'] as const) {
        const usage: AnthropicLikeUsage = { input_tokens: 100, cache_read_input_tokens: 80 }
        expect(normalizeUsage(usage, p)).toBe(usage)
      }
    })
  })

  describe('边界情况', () => {
    test('usage 为 undefined 时返回 undefined', () => {
      expect(normalizeUsage(undefined, 'zhipu')).toBeUndefined()
    })

    test('usage 为 null 时返回 null', () => {
      expect(normalizeUsage(null, 'zhipu')).toBeNull()
    })

    test('provider 为 undefined 时原样返回', () => {
      const usage: AnthropicLikeUsage = { input_tokens: 100, cache_read_input_tokens: 80 }
      expect(normalizeUsage(usage, undefined)).toBe(usage)
    })
  })
})

describe('isOpenAICompatibleProvider', () => {
  test('openai 系列返回 true', () => {
    expect(isOpenAICompatibleProvider('openai')).toBe(true)
    expect(isOpenAICompatibleProvider('zhipu')).toBe(true)
    expect(isOpenAICompatibleProvider('doubao')).toBe(true)
    expect(isOpenAICompatibleProvider('qwen')).toBe(true)
    expect(isOpenAICompatibleProvider('custom')).toBe(true)
  })

  test('Anthropic 兼容系列返回 false', () => {
    expect(isOpenAICompatibleProvider('anthropic')).toBe(false)
    expect(isOpenAICompatibleProvider('zhipu-coding')).toBe(false)
    expect(isOpenAICompatibleProvider('kimi-coding')).toBe(false)
    expect(isOpenAICompatibleProvider('minimax')).toBe(false)
  })

  test('空值返回 false', () => {
    expect(isOpenAICompatibleProvider(undefined)).toBe(false)
    expect(isOpenAICompatibleProvider(null)).toBe(false)
    expect(isOpenAICompatibleProvider('')).toBe(false)
  })
})
