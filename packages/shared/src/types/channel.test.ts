import { describe, expect, test } from 'bun:test'
import { isAgentCompatibleProvider } from './channel'

describe('Agent 渠道协议兼容性', () => {
  test('Given OpenAI Chat Completions 的自定义地址 When 判断 Claude Agent 兼容性 Then 不加入白名单', () => {
    expect(isAgentCompatibleProvider('custom')).toBe(false)
  })

  test('Given Anthropic Messages 兼容端点 When 判断 Claude Agent 兼容性 Then 可加入白名单', () => {
    expect(isAgentCompatibleProvider('anthropic-compatible')).toBe(true)
  })

  test.each(['openai-responses', 'openai-codex'] as const)(
    'Given %s When 判断 Claude Agent 兼容性 Then 不加入白名单',
    (provider) => {
      expect(isAgentCompatibleProvider(provider)).toBe(false)
    },
  )
})
