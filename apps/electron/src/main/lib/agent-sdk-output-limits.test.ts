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
})
