import { describe, expect, test } from 'bun:test'
import { CODEX_GPT_56_CONTEXT_WINDOW } from '@proma/shared'
import {
  buildCodexModel,
  buildModel,
  resolvePiApi,
  resolvePiImageInputCapability,
  shouldForcePiAdaptiveThinking,
  shouldForcePromaOfficialClaudeAdaptiveThinking,
  supportsPiNativeImageInput,
} from './pi-model-registry'

describe('shouldForcePiAdaptiveThinking', () => {
  test('Given Anthropic Messages Claude catalog requires adaptive thinking, when Proma re-registers it, then preserves the flag', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true, supportsStrictTools: true },
    })).toBe(true)
  })

  test('Given a missing flag, when resolving compat, then does not inherit adaptive thinking', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'anthropic-messages',
      compat: { supportsStrictTools: true },
    })).toBe(false)
  })

  test('Given an Anthropic runtime with a stale non-Anthropic catalog API, when the catalog requires adaptive thinking, then preserves the runtime-safe flag', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', {
      api: 'openai-responses',
      compat: { forceAdaptiveThinking: true },
    })).toBe(true)
  })

  test('Given Fable 5.1 is missing from the bundled catalog, when its Anthropic runtime is resolved, then uses adaptive thinking', () => {
    expect(shouldForcePiAdaptiveThinking('anthropic-messages', undefined, 'claude-fable-5-1')).toBe(true)
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('claude-fable-5-1', 'anthropic-messages', undefined)).toBe(true)
  })

  test('Given an OpenAI runtime model, when a catalog entry contains the Claude flag, then does not leak it across protocols', () => {
    expect(shouldForcePiAdaptiveThinking('openai-responses', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true },
    })).toBe(false)
  })

  test('Given an official Claude model, when its Anthropic catalog entry requires adaptive thinking, then enables it', () => {
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('claude-sonnet-5', 'anthropic-messages', {
      api: 'anthropic-messages',
      compat: { forceAdaptiveThinking: true },
    })).toBe(true)
  })

  test('Given an official GPT or Kimi model, when a catalog entry has the flag, then never treats it as Claude adaptive thinking', () => {
    const adaptiveAnthropicCatalog = {
      api: 'anthropic-messages' as const,
      compat: { forceAdaptiveThinking: true },
    }
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('gpt-5.6-terra', 'openai-responses', adaptiveAnthropicCatalog)).toBe(false)
    expect(shouldForcePromaOfficialClaudeAdaptiveThinking('k3', 'anthropic-messages', adaptiveAnthropicCatalog)).toBe(false)
  })
})

describe('DeepSeek V4 native image input', () => {
  test('Given an official Flash model absent from Pi catalog, when resolving capability, then treats it as supported', async () => {
    expect(supportsPiNativeImageInput('deepseek-v4-flash[1m]')).toBe(true)
    await expect(resolvePiImageInputCapability('proma', 'deepseek-v4-flash')).resolves.toBe('supported')
  })

  test('Given official DeepSeek V4 Pro, when resolving capability, then preserves the Vision Relay-only boundary', async () => {
    expect(supportsPiNativeImageInput('deepseek-v4-pro')).toBe(false)
    await expect(resolvePiImageInputCapability('proma', 'deepseek-v4-pro')).resolves.toBe('unsupported')
  })
})

describe('MiMo V2.6 native image input', () => {
  test.each(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'])
    ('Given catalog lacks %s When resolving image capability Then treats it as supported', async (modelId) => {
      expect(supportsPiNativeImageInput(modelId)).toBe(true)
      await expect(resolvePiImageInputCapability('xiaomi', modelId)).resolves.toBe('supported')
      await expect(resolvePiImageInputCapability('xiaomi-token-plan', modelId)).resolves.toBe('supported')
    })

  test('Given a future MiMo-like ID When resolving image capability Then does not grant V2.6 support', () => {
    expect(supportsPiNativeImageInput('mimo-v2.60-pro')).toBe(false)
  })

  test.each(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'])
    ('Given bundled Pi catalog contains %s When building the model Then preserves its official 1M and 128K limits', async (modelId) => {
      let registeredModels: Array<Record<string, unknown>> = []
      const sdkRuntimeRecorder = {
        ModelRuntime: {
          create: async () => ({
            registerProvider: (_provider: string, config: { models: Array<Record<string, unknown>> }) => {
              registeredModels = config.models
            },
            getModel: (_provider: string, id: string) => registeredModels.find((model) => model.id === id),
          }),
        },
      } as never

      const { model } = await buildModel(sdkRuntimeRecorder, {
        provider: 'xiaomi',
        model: modelId,
        apiKey: 'test-key',
        baseUrl: 'https://api.xiaomimimo.com/anthropic',
        sessionId: 'mimo-capability-test',
        permissionMode: 'bypassPermissions',
        systemPrompt: '',
        piAgentDir: '/tmp',
        piSessionDir: '/tmp',
      } as never)

      expect(model).toMatchObject({
        id: modelId,
        input: ['text', 'image'],
        // Pi catalog uses binary token units: 1M = 1,048,576 and 128K = 131,072.
        contextWindow: 1_048_576,
        maxTokens: 131_072,
      })
    })
})

describe('Codex Astra family fallback', () => {
  const credentials = {
    access: 'test-access-token',
    refresh: 'test-refresh-token',
    expires: Date.now() + 60_000,
  }
  const sdkWithoutAstraCatalog = {
    ModelRuntime: {
      create: async () => ({
        getModels: () => [],
      }),
    },
  } as never

  test.each(['gpt-6-astra-1', 'gpt-6-astra-az'])(
    'Given Pi catalog lacks %s When building a Codex model Then preserves the Astra request contract',
    async (modelId) => {
      const { model } = await buildCodexModel(sdkWithoutAstraCatalog, {
        model: modelId,
        codexOAuthCredentials: credentials,
      })
      expect(model).toMatchObject({
        id: modelId,
        api: 'openai-codex-responses',
        baseUrl: 'https://chatgpt.com/backend-api',
        contextWindow: CODEX_GPT_56_CONTEXT_WINDOW,
        input: ['text', 'image'],
      })
    },
  )

  test.each(['gpt-6-astral', 'gpt-6-astrafoo', 'gpt-6-astra_', 'gpt-6-astra-', 'gpt-6-astro'])(
    'Given non-Astra model %s When building a Codex model Then rejects it',
    async (model) => {
      await expect(buildCodexModel(sdkWithoutAstraCatalog, {
        model,
        codexOAuthCredentials: credentials,
      })).rejects.toThrow('未找到指定的 ChatGPT (Codex) 模型')
    },
  )
})

describe('resolvePiApi', () => {
  test('Given an official model protocol from the backend, when resolving, then it overrides model-name inference', () => {
    expect(resolvePiApi('proma', undefined, 'internal-gpt-alias', 'openai-responses')).toBe('openai-responses')
  })
})
