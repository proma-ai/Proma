/**
 * Pi 模型注册与渠道兼容层。
 *
 * Pi SDK 需要把 Proma 渠道临时注册成 runtime provider；这里集中处理
 * ProviderType 到 Pi API 协议、baseUrl、认证头和模型 catalog 默认值的映射。
 */

import {
  extractZhipuCodingTeamApiToken,
  inferAgentSdkContextWindow,
  type CodexOAuthCredentials,
  type ProviderType,
} from '@proma/shared'
import {
  getPromaUserAgent,
  normalizeAnthropicBaseUrlForSdk,
  normalizeOpenAIBaseUrlForSdk,
  resolveAnthropicMessagesUrl,
} from '@proma/core'
import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai/compat'
import type { PiAgentQueryOptions } from './pi-agent-adapter'
import { supportsPiDeveloperRole } from './pi-provider-compat'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type PiAiCompat = typeof import('@earendil-works/pi-ai/compat')
type PiCatalogModel = Model<Api>
type PiModelCost = PiCatalogModel['cost']
type PiRequestHeaders = Record<string, string>
type PiCatalogModelPatch = Pick<PiCatalogModel, 'id'> & Partial<PiCatalogModel>

interface PiModelDefaults {
  reasoning: boolean
  input: PiCatalogModel['input']
  cost: PiModelCost
  contextWindow: number
  maxTokens: number
}

const ZERO_MODEL_COST: PiModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
export const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 64_000
const VOLCENGINE_GLM_52_MAX_TOKENS = 128_000
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const CODEX_MAX_TOKENS = 128_000
const CODEX_54_MINI_CONTEXT_WINDOW = 400_000
// ChatGPT Codex OAuth currently exposes a 272K context window for GPT-5.6 models.
// This differs from the 1.05M API model specification.
const CODEX_56_CONTEXT_WINDOW = 272_000
const CODEX_THINKING_LEVEL_MAP = { xhigh: 'xhigh', minimal: 'low' } as const

type CodexRuntimeCredential = CodexOAuthCredentials & {
  type: 'oauth'
  [key: string]: unknown
}

function createCodexRuntimeCredentialStore(
  initial: CodexOAuthCredentials,
  onRefreshed?: PiAgentQueryOptions['onCodexOAuthCredentialsRefreshed'],
) {
  let credential: CodexRuntimeCredential | undefined = { type: 'oauth', ...initial }

  return {
    async read(providerId: string): Promise<CodexRuntimeCredential | undefined> {
      return providerId === 'openai-codex' ? credential : undefined
    },
    async list(): Promise<readonly { providerId: string; type: 'oauth' }[]> {
      return credential ? [{ providerId: 'openai-codex', type: 'oauth' }] : []
    },
    async modify(
      providerId: string,
      fn: (current: CodexRuntimeCredential | undefined) => Promise<CodexRuntimeCredential | undefined>,
    ): Promise<CodexRuntimeCredential | undefined> {
      if (providerId !== 'openai-codex') return undefined
      const previous = credential
      credential = await fn(credential)

      if (credential && (
        previous?.access !== credential.access
        || previous?.refresh !== credential.refresh
        || previous?.expires !== credential.expires
        || previous?.accountId !== credential.accountId
      )) {
        try {
          await onRefreshed?.(credential)
        } catch (error) {
          console.warn('[Pi Codex OAuth] 刷新后的凭据回写失败，将在下次执行前重试:', error)
        }
      }
      return credential
    },
    async delete(providerId: string): Promise<void> {
      if (providerId === 'openai-codex') credential = undefined
    },
  }
}

const CODEX_MODEL_PATCHES: PiCatalogModelPatch[] = [
  {
    id: 'gpt-5.4',
    contextWindow: CODEX_56_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.4-mini',
    contextWindow: CODEX_54_MINI_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.5',
    contextWindow: CODEX_56_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: CODEX_56_CONTEXT_WINDOW,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
    contextWindow: CODEX_56_CONTEXT_WINDOW,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: CODEX_56_CONTEXT_WINDOW,
    maxTokens: CODEX_MAX_TOKENS,
  },
]

let piAiCompatPromise: Promise<PiAiCompat> | undefined

function loadPiAiCompat(): Promise<PiAiCompat> {
  piAiCompatPromise ??= import('@earendil-works/pi-ai/compat')
  return piAiCompatPromise
}

function normalizePiApi(provider: ProviderType): Api {
  switch (provider) {
    case 'openai':
    case 'zhipu':
    case 'doubao':
    case 'qwen':
    case 'custom':
      return 'openai-completions'
    case 'openai-responses':
      return 'openai-responses'
    case 'google':
      return 'google-generative-ai'
    default:
      return 'anthropic-messages'
  }
}

function candidatePiProviders(provider: ProviderType): KnownProvider[] {
  switch (provider) {
    case 'anthropic':
      return ['anthropic']
    case 'openai':
    case 'openai-responses':
      return ['openai']
    case 'deepseek':
      return ['deepseek']
    case 'google':
      return ['google']
    case 'kimi-api':
      return ['moonshotai-cn', 'moonshotai']
    case 'kimi-coding':
      return ['kimi-coding', 'moonshotai-cn', 'moonshotai']
    case 'zhipu':
      return ['zai']
    case 'zhipu-coding':
      return ['zai-coding-cn', 'zai']
    case 'minimax':
      return ['minimax', 'minimax-cn']
    case 'xiaomi':
      return ['xiaomi']
    case 'xiaomi-token-plan':
      return ['xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'xiaomi']
    default:
      return []
  }
}

function findCatalogModelById(models: readonly PiCatalogModel[], modelId: string): PiCatalogModel | undefined {
  const normalized = modelId.toLowerCase()
  return models.find((model) =>
    model.id.toLowerCase() === normalized || model.name.toLowerCase() === normalized)
}

async function getCatalogModels(provider: KnownProvider): Promise<readonly PiCatalogModel[]> {
  try {
    const { getModels } = await loadPiAiCompat()
    return getModels(provider as Parameters<typeof getModels>[0])
  } catch {
    return []
  }
}

async function findPiCatalogModel(provider: ProviderType, modelId: string): Promise<PiCatalogModel | undefined> {
  const checked = new Set<string>()
  for (const candidate of candidatePiProviders(provider)) {
    checked.add(candidate)
    const model = findCatalogModelById(await getCatalogModels(candidate as KnownProvider), modelId)
    if (model) return model
  }

  // 兼容自定义代理和 Anthropic-compatible：模型 id 常常仍是官方 id。
  const { getProviders } = await loadPiAiCompat()
  for (const candidate of getProviders()) {
    if (checked.has(candidate)) continue
    const model = findCatalogModelById(await getCatalogModels(candidate), modelId)
    if (model) return model
  }
  return undefined
}

async function resolvePiModelDefaults(input: PiAgentQueryOptions): Promise<PiModelDefaults> {
  const catalogModel = input.model ? await findPiCatalogModel(input.provider, input.model) : undefined
  const isVolcengineGlm52 = input.provider === 'doubao' && input.model?.toLowerCase() === 'glm-5.2'
  const catalogContextWindow = catalogModel?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const inferredContextWindow = inferAgentSdkContextWindow(input.model, input.provider) ?? DEFAULT_CONTEXT_WINDOW
  return {
    reasoning: catalogModel?.reasoning ?? true,
    input: catalogModel ? [...catalogModel.input] : ['text', 'image'],
    cost: catalogModel ? { ...catalogModel.cost } : { ...ZERO_MODEL_COST },
    // Provider catalogues may omit or under-report newer models; never lower Proma's verified model capability.
    contextWindow: Math.max(catalogContextWindow, inferredContextWindow),
    // Pi 的智谱目录将 GLM-5.2 标为 131072，但火山方舟兼容端点上限为 128000。
    maxTokens: isVolcengineGlm52
      ? VOLCENGINE_GLM_52_MAX_TOKENS
      : (catalogModel?.maxTokens ?? DEFAULT_MAX_TOKENS),
  }
}

function normalizePiBaseUrl(baseUrl: string | undefined, provider: ProviderType): string | undefined {
  if (!baseUrl) return undefined
  if (normalizePiApi(provider) === 'anthropic-messages') {
    return normalizeAnthropicBaseUrlForSdk(resolveAnthropicMessagesUrl(baseUrl, provider))
  }
  if (provider === 'custom' || provider === 'openai-responses') {
    return normalizeOpenAIBaseUrlForSdk(baseUrl)
  }
  return baseUrl.trim().replace(/\/$/, '')
}

export function requiresPromaUserAgent(provider: ProviderType): boolean {
  return provider === 'kimi-coding'
    || provider === 'xiaomi-token-plan'
    || provider === 'qwen-token-plan'
    || provider === 'zhipu-coding'
    || provider === 'zhipu-coding-team'
}

function usesBearerOnlyAnthropicAuth(provider: ProviderType): boolean {
  return requiresPromaUserAgent(provider) || provider === 'minimax' || provider === 'qwen-anthropic'
}

export function buildPiRequestHeaders(provider: ProviderType, apiKey: string): PiRequestHeaders | undefined {
  if (normalizePiApi(provider) !== 'anthropic-messages') return undefined

  const headers: PiRequestHeaders = {
    Authorization: `Bearer ${apiKey}`,
  }

  if (requiresPromaUserAgent(provider)) {
    headers['User-Agent'] = getPromaUserAgent()
  }

  return headers
}

function shouldUseRuntimeApiKey(provider: ProviderType): boolean {
  return !usesBearerOnlyAnthropicAuth(provider)
}

/**
 * 解析出用于 Pi runtime 认证的真实 API token。
 *
 * 智谱团队版（zhipu-coding-team）的凭据是复合串（形如
 * `apiKey=xxx; bigmodel_organization=yyy; bigmodel_project=zzz`），
 * 必须先提取其中的 apiKey，否则整串会被塞进 `Authorization: Bearer` 头导致 401。
 * 与 Claude runtime 的 applyAgentSdkAuthEnv 保持一致。
 */
export function resolvePiApiKey(provider: ProviderType, apiKey: string): string {
  return provider === 'zhipu-coding-team' ? extractZhipuCodingTeamApiToken(apiKey) : apiKey
}

/**
 * 剥离模型 ID 上的 `[1m]` 扩展上下文后缀。
 *
 * `[1m]` 是 Claude Agent SDK 专用的扩展上下文变体，pi runtime 及其对接的
 * 端点（智谱等）并不识别，带后缀会被判为「模型不存在」（智谱 1211）。
 * pi 模式统一剥离该后缀，保证注册与请求使用干净的模型 ID。
 */
export function stripAgentSdkContextSuffix(modelId: string | undefined): string | undefined {
  return modelId?.replace(/\[1m\]$/i, '')
}

function mergeCodexModels(models: readonly PiCatalogModel[]): PiCatalogModel[] {
  const merged = models.map((model) => ({ ...model }))
  const indexById = new Map(merged.map((model, index) => [model.id, index]))
  for (const patch of CODEX_MODEL_PATCHES) {
    const existingIndex = indexById.get(patch.id)
    const existing = existingIndex !== undefined ? merged[existingIndex] : undefined
    if (existingIndex !== undefined && existing) {
      merged[existingIndex] = { ...existing, ...patch }
    } else if (isCompleteCatalogModel(patch)) {
      indexById.set(patch.id, merged.length)
      merged.push(patch)
    }
  }
  return merged
}

function isCompleteCatalogModel(model: PiCatalogModelPatch): model is PiCatalogModel {
  return Boolean(
    model.name
      && model.api
      && model.provider
      && model.baseUrl
      && model.input
      && model.cost
      && model.contextWindow
      && model.maxTokens,
  )
}

export async function getCodexCatalogModels(): Promise<PiCatalogModel[]> {
  const { getModels } = await loadPiAiCompat()
  return mergeCodexModels(getModels('openai-codex'))
}

/**
 * 为 ChatGPT (Codex) OAuth 渠道构建模型。
 *
 * openai-codex 是 Pi SDK 的内置 KnownProvider：模型目录、baseUrl 和
 * `openai-codex-responses` 协议全部内置，无需（也不能）手工构造 models 或 baseUrl。
 * Pi 0.80.10 将它声明为 OAuth-only provider；runtime API key 不会参与其认证解析。
 * 因此将 Proma 已刷新过的完整凭据放入一次性内存 OAuth credential store，
 * 按真实 expires 刷新并回写 Proma，避免读写全局 ~/.pi 认证文件。
 */
async function buildCodexModel(sdk: PiSdk, input: PiAgentQueryOptions) {
  if (!input.codexOAuthCredentials) {
    throw new Error('ChatGPT (Codex) OAuth 凭据缺失，请重新登录')
  }

  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: createCodexRuntimeCredentialStore(
      input.codexOAuthCredentials,
      input.onCodexOAuthCredentialsRefreshed,
    ),
    allowModelNetwork: false,
  })

  const resolvedModelId = stripAgentSdkContextSuffix(input.model)
  const codexModels = await getCodexCatalogModels()
  const model = (resolvedModelId ? modelRuntime.getModel('openai-codex', resolvedModelId) : undefined)
    ?? (resolvedModelId ? findCatalogModelById(codexModels, resolvedModelId) : undefined)
    // 指定模型缺失时回退到首个内置 codex 模型，避免因模型 ID 漂移直接失败。
    ?? modelRuntime.getModels('openai-codex')[0]
  if (!model) {
    throw new Error('未找到可用的 ChatGPT (Codex) 模型，请确认已登录并升级 Pi 运行时')
  }
  return { modelRuntime, model }
}

/** 列出 Pi SDK 内置的 ChatGPT (Codex) 模型 ID，供渲染层"模型拉取"使用。 */
export async function listCodexModels(): Promise<{ id: string; name: string }[]> {
  return (await getCodexCatalogModels()).map((m) => ({ id: m.id, name: m.name }))
}

export async function buildModel(sdk: PiSdk, input: PiAgentQueryOptions) {
  if (input.provider === 'openai-codex') {
    return buildCodexModel(sdk, input)
  }
  const providerName = `proma-${input.provider}-${input.sessionId}`
  const resolvedApiKey = resolvePiApiKey(input.provider, input.apiKey)
  // pi runtime 统一剥离 `[1m]` 后缀：无论上游从哪条路径传入，注册与查找都用干净 ID。
  const resolvedModelId = stripAgentSdkContextSuffix(input.model)
  const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
  const api = normalizePiApi(input.provider)
  const modelDefaults = await resolvePiModelDefaults({ ...input, model: resolvedModelId })
  const baseUrl = normalizePiBaseUrl(input.baseUrl, input.provider)
  if (!baseUrl) {
    throw new Error(`渠道 ${input.channelName ?? input.provider} 缺少 Base URL`)
  }
  const headers = buildPiRequestHeaders(input.provider, resolvedApiKey)
  modelRuntime.registerProvider(providerName, {
    name: input.channelName ?? providerName,
    apiKey: resolvedApiKey,
    ...(headers ? { headers } : {}),
    api,
    baseUrl,
    models: [{
      id: resolvedModelId ?? 'default',
      name: resolvedModelId ?? 'Default',
      api,
      baseUrl,
      reasoning: modelDefaults.reasoning,
      input: modelDefaults.input,
      cost: modelDefaults.cost,
      contextWindow: modelDefaults.contextWindow,
      maxTokens: modelDefaults.maxTokens,
      ...(supportsPiDeveloperRole(input.provider) ? {} : {
        compat: { supportsDeveloperRole: false },
      }),
    }],
  })
  const model = modelRuntime.getModel(providerName, resolvedModelId ?? 'default')
  if (!model) throw new Error(`Pi model registration failed: ${resolvedModelId ?? 'default'}`)
  return { modelRuntime, model }
}
