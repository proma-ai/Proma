import { describe, expect, test } from 'bun:test'
import {
  buildModel,
  buildPiRequestHeaders,
  getCodexAlignedGPT5Capabilities,
  getCodexCatalogModels,
  listCodexModels,
  requiresPromaUserAgent,
  resolvePiApiKey,
  stripAgentSdkContextSuffix,
} from './pi-model-registry'

describe('Pi runtime 智谱团队版认证', () => {
  test('Given 团队版复合凭据 When resolvePiApiKey Then 提取出真实 apiKey', () => {
    const secret = 'apiKey=model-key; bigmodel_organization=org; bigmodel_project=proj'

    expect(resolvePiApiKey('zhipu-coding-team', secret)).toBe('model-key')
  })

  test('Given 团队版 JSON 凭据 When resolvePiApiKey Then 提取出真实 apiKey', () => {
    const secret = '{"apiKey":"model-key","organization":"org","project":"proj"}'

    expect(resolvePiApiKey('zhipu-coding-team', secret)).toBe('model-key')
  })

  test('Given 团队版复合凭据 When buildPiRequestHeaders Then Bearer 头只含真实 token 且带 Proma UA', () => {
    const secret = 'apiKey=model-key; bigmodel_organization=org'
    const resolved = resolvePiApiKey('zhipu-coding-team', secret)

    const headers = buildPiRequestHeaders('zhipu-coding-team', resolved)

    expect(headers?.Authorization).toBe('Bearer model-key')
    expect(headers?.Authorization).not.toContain('organization')
    expect(headers?.['User-Agent']).toBeDefined()
    expect(headers?.['X-Proma-Agent-Runtime']).toBeUndefined()
  })

  test('Given zhipu-coding-team When requiresPromaUserAgent Then true', () => {
    expect(requiresPromaUserAgent('zhipu-coding-team')).toBe(true)
  })

  test.each(['kimi-coding', 'zhipu-coding', 'xiaomi-token-plan', 'qwen-token-plan'] as const)(
    'Given %s When requiresPromaUserAgent Then true',
    (provider) => {
      expect(requiresPromaUserAgent(provider)).toBe(true)
    },
  )

  test('Given qwen Token Plan When buildPiRequestHeaders Then 使用 Bearer 与 Proma User-Agent', () => {
    const headers = buildPiRequestHeaders('qwen-token-plan', 'model-key')

    expect(headers?.Authorization).toBe('Bearer model-key')
    expect(headers?.['User-Agent']).toBeDefined()
  })

  test('Given 普通 anthropic 渠道 When resolvePiApiKey Then 原样返回', () => {
    expect(resolvePiApiKey('anthropic', 'plain-key')).toBe('plain-key')
    expect(requiresPromaUserAgent('anthropic')).toBe(false)
  })

  test('Given Proma Cloud Responses model When build headers Then it marks Pi runtime', () => {
    const headers = buildPiRequestHeaders('proma', 'test-key', 'openai-responses', 'https://api.proma.cool/api/v1')
    expect(headers).toEqual({ 'X-Proma-Agent-Runtime': 'pi' })
  })

  test.each([
    'https://api.proma.cool/api/v1',
    'https://online-dev-api.proma.cool/api/v1',
  ])('Given Proma API host %s When build headers Then it marks Pi runtime', (baseUrl) => {
    const headers = buildPiRequestHeaders('proma', 'test-key', 'openai-responses', baseUrl)
    expect(headers).toEqual({ 'X-Proma-Agent-Runtime': 'pi' })
  })

  test('Given third-party Responses channel When build headers Then it does not send Proma runtime header', () => {
    const headers = buildPiRequestHeaders('openai', 'test-key', 'openai-responses', 'https://api.example.com/v1')
    expect(headers).toBeUndefined()
  })
})

describe('Pi runtime 模型 ID [1m] 剥离', () => {
  test('Given 带 [1m] 后缀的模型 ID When strip Then 剥离后缀', () => {
    expect(stripAgentSdkContextSuffix('glm-5.2[1m]')).toBe('glm-5.2')
  })

  test('Given 大写 [1M] 后缀 When strip Then 大小写不敏感剥离', () => {
    expect(stripAgentSdkContextSuffix('glm-5.2[1M]')).toBe('glm-5.2')
  })

  test('Given 无后缀模型 ID When strip Then 原样返回', () => {
    expect(stripAgentSdkContextSuffix('glm-4.6')).toBe('glm-4.6')
  })

  test('Given [1m] 出现在中间(非结尾) When strip Then 不剥离', () => {
    expect(stripAgentSdkContextSuffix('foo[1m]-bar')).toBe('foo[1m]-bar')
  })

  test('Given undefined When strip Then 返回 undefined', () => {
    expect(stripAgentSdkContextSuffix(undefined)).toBeUndefined()
  })
})

describe('Proma 官方渠道 Pi runtime 注册', () => {
  test.each([
    ['claude-opus-4-6', 'anthropic-messages', 'https://api.proma.cool'],
    ['deepseek-v4-pro', 'anthropic-messages', 'https://api.proma.cool'],
    ['glm-5.2', 'anthropic-messages', 'https://api.proma.cool'],
    ['gpt-5.2', 'openai-responses', 'https://api.proma.cool/v1'],
    ['openai/gpt-oss-120b', 'openai-responses', 'https://api.proma.cool/v1'],
  ])(
    'Given Proma 官方模型 %s When buildModel Then 使用对应 Pi protocol',
    async (modelId, expectedApi, expectedBaseUrl) => {
      const sdk = await import('@earendil-works/pi-coding-agent')
      const result = await buildModel(sdk, {
        sessionId: 'session-proma',
        prompt: 'hi',
        apiKey: 'system-key',
        baseUrl: 'https://api.proma.cool/api/v1',
        provider: 'proma',
        model: modelId,
        permissionMode: 'plan',
        systemPrompt: 'system',
        piAgentDir: '/tmp/pi-agent',
        piSessionDir: '/tmp/pi-session',
      })

      expect(result.model.api).toBe(expectedApi)
      expect(result.model.baseUrl).toBe(expectedBaseUrl)
    },
  )

  test('Given 后端显式下发 Responses 协议 When buildModel Then 优先使用服务端契约', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-proma-protocol',
      prompt: 'hi',
      apiKey: 'system-key',
      baseUrl: 'https://api.proma.cool/api/v1',
      provider: 'proma',
      model: 'internal-gpt-alias',
      modelApiProtocol: 'openai-responses',      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.api).toBe('openai-responses')
    expect(result.model.baseUrl).toBe('https://api.proma.cool/v1')
  })

  test.each([
    [
      'gpt-5.5',
      272_000,
      32_000,
    ],
    [
      'gpt-5.6-terra',
      1_000_000,
      64_000,
    ],
  ])('Given 官方服务端下发 %s 窗口 When buildModel Then 覆盖 catalog 与 200K fallback', async (model, contextWindow, maxTokens) => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: `session-proma-context-${model}`,
      prompt: 'hi',
      apiKey: 'system-key',
      baseUrl: 'https://api.proma.cool/api/v1',
      provider: 'proma',
      model,
      modelApiProtocol: 'openai-responses',
      modelContextWindow: contextWindow,
      modelMaxOutputTokens: maxTokens,
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.contextWindow).toBe(contextWindow)
    expect(result.model.maxTokens).toBe(maxTokens)
  })

  test.each([
    'https://api.proma.cool',
    'https://api.proma.cool/v1',
    'https://api.proma.cool/api/v1',
  ])(
    'Given Proma Cloud baseUrl %s When GPT responses model Then 归一到 /v1',
    async (baseUrl) => {
      const sdk = await import('@earendil-works/pi-coding-agent')
      const result = await buildModel(sdk, {
        sessionId: 'session-proma',
        prompt: 'hi',
        apiKey: 'system-key',
        baseUrl,
        provider: 'proma',
        model: 'gpt-5.2',
        permissionMode: 'plan',
        systemPrompt: 'system',
        piAgentDir: '/tmp/pi-agent',
        piSessionDir: '/tmp/pi-session',
      })

      expect(result.model.api).toBe('openai-responses')
      expect(result.model.baseUrl).toBe('https://api.proma.cool/v1')
    },
  )})

describe('Pi runtime 通义千问 Token Plan 渠道', () => {
  test('保留完整端点、Bearer 认证和 1M 上下文', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-qwen-token-plan', prompt: 'hi', apiKey: 'sk-test', provider: 'qwen-token-plan',
      baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic/v1/messages',
      model: 'qwen3.8-max-preview', permissionMode: 'plan', systemPrompt: 'system', piAgentDir: '/tmp/pi-agent', piSessionDir: '/tmp/pi-session',
    })
    expect(result.model.api).toBe('anthropic-messages')
    expect(result.model.baseUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic')
    expect(result.model.contextWindow).toBe(1_000_000)
  })
})

describe('Pi runtime OpenAI Responses 渠道', () => {
  test('Given openai-responses 渠道 When buildModel Then 注册为 Pi openai-responses 协议', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-responses',
      prompt: 'hi',
      apiKey: 'sk-test',
      provider: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1/responses',
      model: 'gpt-5.1',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.id).toBe('gpt-5.1')
    expect(result.model.api).toBe('openai-responses')
    expect(result.model.baseUrl).toBe('https://api.openai.com/v1')
  })
})

describe('Pi runtime 火山方舟模型限制', () => {
  test('Given 火山方舟的 GLM-5.2 When buildModel Then 使用其 128000 输出上限', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-volcengine-glm-52',
      prompt: 'hi',
      apiKey: 'test-key',
      provider: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'glm-5.2',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.maxTokens).toBe(128_000)
  })
})

describe('ChatGPT Codex 模型目录补丁', () => {
  test('Given Pi SDK 内置目录缺少 5.6 When listCodexModels Then 补齐 5.6 系列', async () => {
    const models = await listCodexModels()
    const ids = models.map((model) => model.id)

    expect(ids).toContain('gpt-5.6-sol')
    expect(ids).toContain('gpt-5.6-terra')
    expect(ids).toContain('gpt-5.6-luna')
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('Given 选择 SDK 未收录的 5.6 模型 When buildModel Then 保留用户选择的模型 ID', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: 'session-1',
      prompt: 'hi',
      apiKey: 'oauth-access-token',
      codexOAuthCredentials: {
        access: 'oauth-access-token',
        refresh: 'oauth-refresh-token',
        expires: Date.now() + 3_600_000,
      },
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      permissionMode: 'plan',
      systemPrompt: 'system',
      piAgentDir: '/tmp/pi-agent',
      piSessionDir: '/tmp/pi-session',
    })

    expect(result.model.id).toBe('gpt-5.6-terra')
    expect(result.model.provider).toBe('openai-codex')
  })

  test('Given Codex 补丁模型 When 读取目录 Then 使用 Codex Responses 协议和百万上下文', async () => {
    const models = await getCodexCatalogModels()
    const terra = models.find((model) => model.id === 'gpt-5.6-terra')

    expect(terra?.api).toBe('openai-codex-responses')
    expect(terra?.baseUrl).toBe('https://chatgpt.com/backend-api')
    expect(terra?.contextWindow).toBe(372_000)
    expect(terra?.maxTokens).toBe(128_000)
  })

  test('Given Pi SDK 内置 Codex 模型上下文过旧 When 读取目录 Then 使用当前 OpenAI 规格覆盖', async () => {
    const models = await getCodexCatalogModels()
    const byId = new Map(models.map((model) => [model.id, model.contextWindow]))

    expect(byId.get('gpt-5.4')).toBe(272_000)
    expect(byId.get('gpt-5.4-mini')).toBe(400_000)
    expect(byId.get('gpt-5.5')).toBe(272_000)
  })
})


describe('third-party GPT-5 capability extrapolation', () => {
  test.each([
    ['gpt-5.4', 272_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.4-mini', 400_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.5', 272_000, { off: 'none', xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.6-sol', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-terra', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-luna', 372_000, { off: 'none', xhigh: 'xhigh', minimal: 'low', max: 'max' }],
  ])('aligns %s with the Codex capability map', (modelId, contextWindow, thinkingLevelMap) => {
    expect(getCodexAlignedGPT5Capabilities(modelId)).toEqual({ contextWindow, thinkingLevelMap })
  })
  test('does not extrapolate unmarked GPT-5 SKUs', () => {
    expect(getCodexAlignedGPT5Capabilities('gpt-5.4-pro')).toBeUndefined()
    expect(getCodexAlignedGPT5Capabilities('gpt-5.5-pro')).toBeUndefined()
  })
})

describe('Pi runtime Ark GLM-5.2 output limit', () => {
  test.each([['doubao', 'https://ark.cn-beijing.volces.com/api/v3'], ['ark-coding-plan', 'https://ark.cn-beijing.volces.com/api/plan']] as const)('caps %s GLM-5.2 output at 128K', async (provider, baseUrl) => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const result = await buildModel(sdk, {
      sessionId: `session-${provider}-glm-52`, prompt: 'hi', apiKey: 'test-key',
      provider, baseUrl, model: 'glm-5.2',
      permissionMode: 'plan', systemPrompt: 'system', piAgentDir: '/tmp/pi-agent', piSessionDir: '/tmp/pi-session',
    })
    expect(result.model.maxTokens).toBe(128_000)
  })
})
