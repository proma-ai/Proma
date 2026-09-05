import { describe, expect, test } from 'bun:test'
import {
  buildCodexModel,
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
        contextWindow: 1_000_000,
        input: ['text', 'image'],
      })
    },
  )

  test('Given a similarly named model When building a Codex model Then rejects it', async () => {
    await expect(buildCodexModel(sdkWithoutAstraCatalog, {
      model: 'gpt-6-astral',
      codexOAuthCredentials: credentials,
    })).rejects.toThrow('未找到指定的 ChatGPT (Codex) 模型')
  })
})

describe('resolvePiApi', () => {
  test('Given OpenCode Go catalog APIs, when resolving, then preserves each model protocol', () => {
    expect(resolvePiApi('opencode-go-openai', 'openai-completions')).toBe('openai-completions')
    expect(resolvePiApi('opencode-go-openai', 'openai-responses')).toBe('openai-responses')
    expect(resolvePiApi('opencode-go-openai', 'anthropic-messages')).toBe('anthropic-messages')
  })

  test('Given an official model protocol from the backend, when resolving, then it overrides model-name inference', () => {
    expect(resolvePiApi('proma', undefined, 'internal-gpt-alias', 'openai-responses')).toBe('openai-responses')
  })
})
