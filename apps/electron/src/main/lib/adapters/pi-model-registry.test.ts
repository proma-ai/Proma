import { describe, expect, test } from 'bun:test'
import {
  buildModel,
  getCodexAlignedGPT5Capabilities,
  resolvePiReasoningCapability,
} from './pi-model-registry'

describe('third-party GPT-5 capability extrapolation', () => {
  test.each([
    ['gpt-5.4', 272_000],
    ['gpt-5.4-mini', 400_000],
    ['gpt-5.5', 272_000],
    ['gpt-5.6-sol', 372_000],
    ['gpt-5.6-terra', 372_000],
    ['gpt-5.6-luna', 372_000],
  ])('Given third-party %s When resolving capabilities Then aligns its context window with Codex', (modelId, contextWindow) => {
    expect(getCodexAlignedGPT5Capabilities(modelId)).toEqual({ contextWindow })
  })

  test('Given a Codex-unmarked GPT-5 SKU When resolving capabilities Then preserves catalog ownership', () => {
    expect(getCodexAlignedGPT5Capabilities('gpt-5.4-pro')).toBeUndefined()
    expect(getCodexAlignedGPT5Capabilities('gpt-5.5-pro')).toBeUndefined()
  })
})

describe('Pi catalog reasoning capability fallback', () => {
  test.each([
    ['anthropic', 'claude-opus-4-6', ['off', 'minimal', 'low', 'medium', 'high', 'max']],
    ['deepseek', 'deepseek-v4-pro', ['off', 'high', 'max']],
    ['minimax', 'MiniMax-M2.7', ['off', 'minimal', 'low', 'medium', 'high']],
  ] as const)('Given %s catalog model %s When resolving Then exposes Pi-native levels', async (provider, modelId, levels) => {
    const capability = await resolvePiReasoningCapability(provider, modelId)

    expect(capability).toMatchObject({ source: 'pi-catalog', levels, defaultLevel: 'high' })
  })

  test.each([
    ['grok-4.5', ['low', 'medium', 'high']],
    ['deepseek-ai/DeepSeek-V4-Pro', ['high']],
    ['anthropic/claude-fable-5', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ] as const)('Given custom channel model %s When its id is catalog-native Then resolves the native levels', async (modelId, levels) => {
    const capability = await resolvePiReasoningCapability('custom', modelId)

    expect(capability).toMatchObject({ source: 'pi-catalog', levels, defaultLevel: 'high' })
  })

  test('Given an explicit K3 profile in the catalog When resolving Then keeps the specialized profile levels', async () => {
    const capability = await resolvePiReasoningCapability('kimi-coding', 'k3')

    expect(capability).toMatchObject({
      source: 'profile',
      levels: ['off', 'low', 'high', 'max'],
      defaultLevel: 'high',
    })
  })
})

describe('Pi runtime OpenAI reasoning profile compatibility', () => {
  test.each([
    ['gpt-5.5', { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.6-terra', { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
  ] as const)('Given %s over OpenAI When buildModel Then uses the shared effort map', async (model, thinkingLevelMap) => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: `session-openai-${model}`,
      prompt: 'hi',
      apiKey: 'test-key',
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model,
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.compat).toMatchObject({ supportsReasoningEffort: true })
    expect(result.model.thinkingLevelMap).toEqual(thinkingLevelMap)
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

describe('Pi runtime Zhipu GLM-5.2 thinking compatibility', () => {
  test('Given standard Zhipu GLM-5.2 When buildModel Then uses Z.AI thinking and effort fields', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-zhipu-glm-52',
      prompt: 'hi',
      apiKey: 'test-key',
      provider: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.2',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      thinkingFormat: 'zai',
    })
    expect(result.model.thinkingLevelMap).toEqual({
      minimal: null,
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
  })

  test('Given GLM-5.2 via an Anthropic channel When buildModel Then uses adaptive effort mapping', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-ark-glm-52',
      prompt: 'hi',
      apiKey: 'test-key',
      provider: 'ark-coding-plan',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      model: 'glm-5.2',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.compat).toMatchObject({ forceAdaptiveThinking: true })
    expect(result.model.thinkingLevelMap).toEqual({
      minimal: 'high',
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
      max: 'max',
    })
  })
})

describe('Pi runtime K3 thinking compatibility', () => {
  test.each(['k3', 'k3-256k'])(
    'Given Kimi Coding %s When buildModel Then configures adaptive thinking with Kimi effort mappings',
    async (model) => {
      const sdk = await import('@earendil-works/pi-coding-agent')
      const result = await buildModel(sdk, {
        sessionId: `session-kimi-coding-${model}`,
        prompt: 'hi',
        apiKey: 'test-key',
        provider: 'kimi-coding',
        baseUrl: 'https://api.kimi.com/coding/v1',
        model,
        permissionMode: 'plan',
        systemPrompt: 'system',
        piAgentDir: '/tmp/pi-agent',
        piSessionDir: '/tmp/pi-session',
      })

      expect(result.model.compat).toMatchObject({ forceAdaptiveThinking: true })
      expect(result.model.thinkingLevelMap).toEqual({
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      })
    },
  )

  test('Given K3 via an OpenAI channel When buildModel Then uses OpenAI reasoning effort', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-openai-kimi-k3',
      prompt: 'hi',
      apiKey: 'test-key',
      provider: 'opencode-go-openai',
      baseUrl: 'https://example.test/v1',
      model: 'kimi-k3',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.compat).toMatchObject({ supportsReasoningEffort: true })
    expect(result.model.compat).not.toHaveProperty('forceAdaptiveThinking')
  })
})
