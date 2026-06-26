import { test, expect, describe } from 'bun:test'
import {
  normalizeAnthropicBaseUrl,
  normalizeVersionedAnthropicBaseUrl,
  normalizeAnthropicBaseUrlForSdk,
  normalizeBaseUrl,
  normalizeAnthropicProviderUrl,
} from './url-utils.ts'

describe('normalizeAnthropicBaseUrl', () => {
  test('纯域名追加 /v1', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1')
  })

  test('已有 /v1 保持不变', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1')
  })

  test('去除尾部斜杠并保留版本号', () => {
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v2/')).toBe('https://proxy.example.com/v2')
  })

  test('去除误填的 /messages 后缀', () => {
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v1/messages')).toBe('https://proxy.example.com/v1')
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v1/messages/')).toBe('https://proxy.example.com/v1')
  })

  test('已有非版本路径保持原样（不追加 /v1）', () => {
    expect(normalizeAnthropicBaseUrl('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic')
  })
})

describe('normalizeVersionedAnthropicBaseUrl', () => {
  test('协议根路径追加 /v1', () => {
    expect(normalizeVersionedAnthropicBaseUrl('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/anthropic/v1',
    )
  })

  test('已含 /v1 的路径不重复追加', () => {
    expect(normalizeVersionedAnthropicBaseUrl('https://api.kimi.com/coding/v1')).toBe('https://api.kimi.com/coding/v1')
  })

  test('去除误填的 /messages 后缀并保留版本号', () => {
    expect(normalizeVersionedAnthropicBaseUrl('https://api.minimaxi.com/anthropic/v1/messages')).toBe(
      'https://api.minimaxi.com/anthropic/v1',
    )
  })

  test('纯域名追加 /v1', () => {
    expect(normalizeVersionedAnthropicBaseUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1')
  })
})

describe('normalizeAnthropicBaseUrlForSdk', () => {
  test('纯域名保持不变', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com')).toBe('https://api.anthropic.com')
  })

  test('去除 /v1 后缀', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com')
  })

  test('去除 /v1/messages 后缀', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com/v1/messages')).toBe('https://api.anthropic.com')
  })

  test('保留 /anthropic 协议根路径', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic/v1/messages')).toBe(
      'https://gateway.example.com/anthropic',
    )
    expect(normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic/')).toBe(
      'https://gateway.example.com/anthropic',
    )
  })
})

describe('normalizeBaseUrl', () => {
  test('仅去除尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })
})

describe('normalizeAnthropicProviderUrl', () => {
  // 回归测试：deepseek / kimi-api 的默认 /anthropic 端点必须补 /v1，
  // 否则 Chat 模式拼出 .../anthropic/messages 会 404。
  test('deepseek 默认端点补全 /v1', () => {
    const url = normalizeAnthropicProviderUrl('https://api.deepseek.com/anthropic', 'deepseek')
    expect(url).toBe('https://api.deepseek.com/anthropic/v1')
    // 拼接 /messages 后得到正确的完整端点
    expect(`${url}/messages`).toBe('https://api.deepseek.com/anthropic/v1/messages')
  })

  test('kimi-api 默认端点补全 /v1', () => {
    const url = normalizeAnthropicProviderUrl('https://api.moonshot.cn/anthropic', 'kimi-api')
    expect(url).toBe('https://api.moonshot.cn/anthropic/v1')
    expect(`${url}/messages`).toBe('https://api.moonshot.cn/anthropic/v1/messages')
  })

  test('kimi-coding 默认端点已含 /v1，不重复追加', () => {
    const url = normalizeAnthropicProviderUrl('https://api.kimi.com/coding/v1', 'kimi-coding')
    expect(url).toBe('https://api.kimi.com/coding/v1')
    expect(`${url}/messages`).toBe('https://api.kimi.com/coding/v1/messages')
  })

  test('用户手动填写不带 /v1 的 kimi-coding 地址也会补全', () => {
    const url = normalizeAnthropicProviderUrl('https://api.kimi.com/coding', 'kimi-coding')
    expect(url).toBe('https://api.kimi.com/coding/v1')
  })

  test('minimax 协议根路径补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://api.minimaxi.com/anthropic', 'minimax')).toBe(
      'https://api.minimaxi.com/anthropic/v1',
    )
  })

  test('anthropic-compatible 协议根路径补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://gateway.example.com/anthropic', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/anthropic/v1',
    )
  })

  test('qwen-anthropic 补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://dashscope.aliyuncs.com/apps/anthropic', 'qwen-anthropic')).toBe(
      'https://dashscope.aliyuncs.com/apps/anthropic/v1',
    )
  })

  test('xiaomi / xiaomi-token-plan 补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://api.xiaomimimo.com/anthropic', 'xiaomi')).toBe(
      'https://api.xiaomimimo.com/anthropic/v1',
    )
    expect(
      normalizeAnthropicProviderUrl('https://token-plan-cn.xiaomimimo.com/anthropic', 'xiaomi-token-plan'),
    ).toBe('https://token-plan-cn.xiaomimimo.com/anthropic/v1')
  })

  test('zhipu-coding 补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://open.bigmodel.cn/api/anthropic', 'zhipu-coding')).toBe(
      'https://open.bigmodel.cn/api/anthropic/v1',
    )
  })

  test('原生 anthropic 纯域名补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://api.anthropic.com', 'anthropic')).toBe('https://api.anthropic.com/v1')
  })

  test('原生 anthropic 已含 /v1 保持不变', () => {
    expect(normalizeAnthropicProviderUrl('https://api.anthropic.com/v1', 'anthropic')).toBe('https://api.anthropic.com/v1')
  })
})
