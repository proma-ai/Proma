import { describe, expect, test } from 'bun:test'
import {
  buildModel,
  getCodexAlignedGPT5Capabilities,
} from './pi-model-registry'

describe('third-party GPT-5 capability extrapolation', () => {
  test.each([
    ['gpt-5.4', 272_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.4-mini', 400_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.5', 272_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.6-sol', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-terra', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-luna', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
  ])('Given third-party %s When resolving capabilities Then aligns with Codex', (modelId, contextWindow, thinkingLevelMap) => {
    expect(getCodexAlignedGPT5Capabilities(modelId)).toEqual({ contextWindow, thinkingLevelMap })
  })

  test('Given a Codex-unmarked GPT-5 SKU When resolving capabilities Then preserves catalog ownership', () => {
    expect(getCodexAlignedGPT5Capabilities('gpt-5.4-pro')).toBeUndefined()
    expect(getCodexAlignedGPT5Capabilities('gpt-5.5-pro')).toBeUndefined()
  })
})

describe('Pi runtime 火山方舟 GLM-5.2 输出限制', () => {
  test.each([
    ['doubao', 'https://ark.cn-beijing.volces.com/api/v3'],
    ['ark-coding-plan', 'https://ark.cn-beijing.volces.com/api/plan'],
  ] as const)(
    'Given %s 的 GLM-5.2 When buildModel Then 使用 128000 输出上限',
    async (provider, baseUrl) => {
      const sdk = await import('@earendil-works/pi-coding-agent')
      const result = await buildModel(sdk, {
        sessionId: `session-${provider}-glm-52`,
        prompt: 'hi',
        apiKey: 'test-key',
        provider,
        baseUrl,
        model: 'glm-5.2',
        permissionMode: 'plan',
        systemPrompt: 'system',
        piAgentDir: '/tmp/pi-agent',
        piSessionDir: '/tmp/pi-session',
      })

      expect(result.model.maxTokens).toBe(128_000)
    },
  )
})
