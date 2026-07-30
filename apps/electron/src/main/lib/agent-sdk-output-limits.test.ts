import { describe, expect, test } from 'bun:test'
import { getAgentSdkMaxOutputTokens } from './agent-sdk-output-limits'

describe('Agent SDK 输出 token 上限', () => {
  test('Given 模型名包含 claude When 构建 SDK env Then 注入 64K 输出上限', () => {
    expect(getAgentSdkMaxOutputTokens('claude-sonnet-4-6')).toBe('64000')
    expect(getAgentSdkMaxOutputTokens('vendor/Claude-Opus-4-8')).toBe('64000')
  })

  test.each(['glm-5.2', 'kimi-k2.7-code', 'deepseek-v4-pro', 'qwen3.7-plus', undefined] as const)(
    'Given 非 Claude 模型 %s When 构建 SDK env Then 不注入 max output token 覆盖',
    (modelId) => {
      expect(getAgentSdkMaxOutputTokens(modelId)).toBeUndefined()
    },
  )

  // issue #1159：模型名仅**包含** claude 子串时不应命中
  test.each([
    // 用户自定义模型名，并非 Claude
    'my-not-claude-fork',
    // 第三方网关别名，实际后端并非 Claude
    'gateway/claude-proxy',
    'claude-proxy',
    // 仅有 claude 字样、不带任何系列名
    'claude',
    'my-claude',
    'claude-mini',
  ] as const)(
    'Given 模型名仅包含 claude 子串但无系列名 %s When 构建 SDK env Then 不注入 max output token 覆盖',
    (modelId) => {
      expect(getAgentSdkMaxOutputTokens(modelId)).toBeUndefined()
    },
  )

  // 真实 Claude 模型的各种别名形态必须继续命中（避免修复过度收窄）
  test.each([
    // 系列名在前（4.x 起的命名）
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-haiku-4-5',
    'claude-fable-5',
    'claude-mythos-preview',
    // 厂商前缀 / provider 作用域形态
    'vendor/Claude-Opus-4-8',
    'anthropic.claude-opus-4-6-v1',
    // Agent SDK 的 [1m] 扩展上下文后缀
    'claude-sonnet-4-6[1m]',
    // 版本号在前的 3.x 旧命名
    'claude-3-opus-20240229',
    'claude-3-5-sonnet-20241022',
  ] as const)(
    'Given 真实 Claude 模型 %s When 构建 SDK env Then 注入 64K 输出上限',
    (modelId) => {
      expect(getAgentSdkMaxOutputTokens(modelId)).toBe('64000')
    },
  )

  test('Given 空模型名 When 构建 SDK env Then 不注入 max output token 覆盖', () => {
    expect(getAgentSdkMaxOutputTokens('')).toBeUndefined()
  })
})
