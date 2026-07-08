import { test, expect, describe } from 'bun:test'
import {
  normalizeAnthropicBaseUrl,
  normalizeVersionedAnthropicBaseUrl,
  normalizeAnthropicBaseUrlForSdk,
  normalizeBaseUrl,
  normalizeAnthropicProviderUrl,
  resolveOpenAIChatCompletionsUrl,
  resolveOpenAIModelsUrl,
  resolveAnthropicMessagesUrl,
  resolveAnthropicModelsUrl,
  migrateCompatibleChannelBaseUrl,
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

  test('anthropic-compatible 不再走 versioned 分支（PR: 改为完整请求地址，运行时由 resolveAnthropicMessagesUrl 短路）', () => {
    // anthropic-compatible 已从 normalizeAnthropicProviderUrl 的 versioned 列表移除，
    // 落到通用 normalizeAnthropicBaseUrl：对已有非版本路径（/anthropic）不再追加 /v1。
    expect(normalizeAnthropicProviderUrl('https://gateway.example.com/anthropic', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/anthropic',
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

  test('ark-coding-plan 补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://ark.cn-beijing.volces.com/api/plan', 'ark-coding-plan')).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v1',
    )
  })

  test('原生 anthropic 纯域名补全 /v1', () => {
    expect(normalizeAnthropicProviderUrl('https://api.anthropic.com', 'anthropic')).toBe('https://api.anthropic.com/v1')
  })

  test('原生 anthropic 已含 /v1 保持不变', () => {
    expect(normalizeAnthropicProviderUrl('https://api.anthropic.com/v1', 'anthropic')).toBe('https://api.anthropic.com/v1')
  })
})

describe('resolveOpenAIChatCompletionsUrl', () => {
  test('custom 原样使用完整端点（去尾斜杠）', () => {
    expect(resolveOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
    expect(resolveOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions/', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  test('custom 不向用户填写的地址追加后缀', () => {
    expect(resolveOpenAIChatCompletionsUrl('https://api.example.com/v1', 'custom')).toBe('https://api.example.com/v1')
  })

  test('内置 openai 协议根地址补全 /chat/completions', () => {
    expect(resolveOpenAIChatCompletionsUrl('https://api.openai.com/v1', 'openai')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  test('内置 openai 已是完整端点不重复追加', () => {
    expect(resolveOpenAIChatCompletionsUrl('https://api.openai.com/v1/chat/completions', 'openai')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  test('保留查询参数', () => {
    expect(resolveOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions?api-version=2024', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions?api-version=2024',
    )
  })
})

describe('resolveOpenAIModelsUrl', () => {
  test('完整 chat/completions 端点回到同级 /models', () => {
    expect(resolveOpenAIModelsUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/models',
    )
  })

  test('协议根地址推导 /models', () => {
    expect(resolveOpenAIModelsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models')
  })

  test('保留查询参数', () => {
    expect(resolveOpenAIModelsUrl('https://api.example.com/v1/chat/completions?x=1')).toBe(
      'https://api.example.com/v1/models?x=1',
    )
  })
})

describe('resolveAnthropicMessagesUrl', () => {
  test('anthropic-compatible 原样使用完整端点', () => {
    expect(resolveAnthropicMessagesUrl('https://gateway.example.com/v1/messages', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/messages',
    )
    expect(resolveAnthropicMessagesUrl('https://gateway.example.com/v1/messages/', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/messages',
    )
  })

  test('anthropic-compatible 不向用户填写的地址追加后缀', () => {
    expect(resolveAnthropicMessagesUrl('https://gateway.example.com/custom-path', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/custom-path',
    )
  })

  test('内置 minimax 协议根地址补全 /v1/messages', () => {
    expect(resolveAnthropicMessagesUrl('https://api.minimaxi.com/anthropic', 'minimax')).toBe(
      'https://api.minimaxi.com/anthropic/v1/messages',
    )
  })

  test('火山方舟 Coding Plan 协议根地址补全 /v1/messages', () => {
    expect(resolveAnthropicMessagesUrl('https://ark.cn-beijing.volces.com/api/plan', 'ark-coding-plan')).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v1/messages',
    )
  })

  test('内置 anthropic 已是完整端点不重复追加', () => {
    expect(resolveAnthropicMessagesUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
  })
})

describe('resolveAnthropicModelsUrl', () => {
  test('anthropic-compatible 从完整 messages 端点推导同级 /models', () => {
    expect(resolveAnthropicModelsUrl('https://gateway.example.com/v1/messages', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/models',
    )
  })

  test('anthropic-compatible 协议根地址推导 /models', () => {
    expect(resolveAnthropicModelsUrl('https://gateway.example.com/v1', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/models',
    )
  })

  test('anthropic-compatible 推导模型端点时保留查询参数', () => {
    expect(resolveAnthropicModelsUrl('https://gateway.example.com/v1/messages?api-version=2024', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/models?api-version=2024',
    )
  })

  test('内置完整 messages 端点回到同级 /models', () => {
    expect(resolveAnthropicModelsUrl('https://api.anthropic.com/v1/messages', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/models',
    )
  })

  test('内置协议根地址推导 /models', () => {
    expect(resolveAnthropicModelsUrl('https://api.minimaxi.com/anthropic', 'minimax')).toBe(
      'https://api.minimaxi.com/anthropic/v1/models',
    )
  })

  test('火山方舟 Coding Plan 协议根地址推导 /v1/models', () => {
    expect(resolveAnthropicModelsUrl('https://ark.cn-beijing.volces.com/api/plan', 'ark-coding-plan')).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v1/models',
    )
  })
})

describe('migrateCompatibleChannelBaseUrl', () => {
  // 迁移目标 = 复现 PR 之前旧代码「实际请求过」的完整 URL，保证升级后运行时行为不变。

  test('custom: 旧 Base URL 补全为 /chat/completions（与旧 OpenAIAdapter 一致）', () => {
    expect(migrateCompatibleChannelBaseUrl('https://api.example.com/v1', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  test('custom: 去尾斜杠后再补全', () => {
    expect(migrateCompatibleChannelBaseUrl('https://api.example.com/v1/', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  test('custom: 幂等 —— 已是完整端点不重复追加', () => {
    expect(migrateCompatibleChannelBaseUrl('https://api.example.com/v1/chat/completions', 'custom')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  test('anthropic-compatible: 协议根地址补全为 /v1/messages（与旧 versioned 分支一致）', () => {
    // 旧代码：normalizeAnthropicProviderUrl 把 anthropic-compatible 走 versioned 分支 → 补 /v1 再拼 /messages
    expect(migrateCompatibleChannelBaseUrl('https://gateway.example.com/anthropic', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/anthropic/v1/messages',
    )
  })

  test('anthropic-compatible: 已含 /v1 的地址只补 /messages', () => {
    expect(migrateCompatibleChannelBaseUrl('https://gateway.example.com/v1', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/messages',
    )
  })

  test('anthropic-compatible: 幂等 —— 已是完整端点不重复追加', () => {
    expect(migrateCompatibleChannelBaseUrl('https://gateway.example.com/v1/messages', 'anthropic-compatible')).toBe(
      'https://gateway.example.com/v1/messages',
    )
  })

  test('迁移后的 anthropic-compatible 端点经 SDK 归一化可还原为升级前的根地址', () => {
    // 关键不变量：channel.baseUrl 同时被 Agent SDK 路径消费（normalizeAnthropicBaseUrlForSdk 剥除 /v\d+/messages）
    const migrated = migrateCompatibleChannelBaseUrl('https://gateway.example.com/anthropic', 'anthropic-compatible')
    expect(normalizeAnthropicBaseUrlForSdk(migrated)).toBe(
      normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic'),
    )
  })

  test('空 Base URL 原样返回（未配置渠道不迁移）', () => {
    expect(migrateCompatibleChannelBaseUrl('', 'custom')).toBe('')
    expect(migrateCompatibleChannelBaseUrl('   ', 'anthropic-compatible')).toBe('   ')
  })

  test('非通用兼容 provider 原样返回（语义未变）', () => {
    expect(migrateCompatibleChannelBaseUrl('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1')
    expect(migrateCompatibleChannelBaseUrl('https://api.deepseek.com/anthropic', 'deepseek')).toBe(
      'https://api.deepseek.com/anthropic',
    )
  })
})
