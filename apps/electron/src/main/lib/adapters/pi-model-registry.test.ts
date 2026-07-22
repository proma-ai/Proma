import { describe, expect, test } from 'bun:test'
import { buildModel } from './pi-model-registry'

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
