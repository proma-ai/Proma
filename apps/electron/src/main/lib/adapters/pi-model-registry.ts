/**
 * Pi 模型注册与渠道兼容层。
 *
 * Pi SDK 需要把 Proma 渠道临时注册成 runtime provider；这里集中处理
 * ProviderType 到 Pi API 协议、baseUrl、认证头和模型 catalog 默认值的映射。
 */

import {
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  CODEX_GPT_56_CONTEXT_WINDOW,
  extractZhipuCodingTeamApiToken,
  inferContextWindow,
  inferCodexAlignedGPT5ContextWindow,
  resolveReasoningCapability,
  resolveReasoningProfile,
  type CodexOAuthCredentials,
  type XaiOAuthCredentials,
  type ReasoningCapability,
  type ReasoningTransport,
  type ProviderType,
} from '@proma/shared'
import {
  getPromaUserAgent,
  normalizeAnthropicBaseUrlForSdk,
  normalizeOpenAIBaseUrlForSdk,
  normalizeVersionedAnthropicBaseUrl,
  resolveAnthropicMessagesUrl,
} from '@proma/core'
import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai/compat'
import type { PiAgentQueryOptions } from './pi-agent-adapter'
import { rememberXaiOAuthCredentials, refreshXaiOAuthCredentialsSerial } from '../xai-oauth-credentials'
import { supportsPiDeveloperRole } from './pi-provider-compat'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type PiAiCompat = typeof import('@earendil-works/pi-ai/compat')
type PiCatalogModel = Model<Api>
type PiModelCost = PiCatalogModel['cost']
type PiRequestHeaders = Record<string, string>
type PiCatalogModelPatch = Pick<PiCatalogModel, 'id'> & Partial<PiCatalogModel>

export interface PiModelDefaults {
  api: Api
  reasoning: boolean
  thinkingLevelMap?: PiCatalogModel['thinkingLevelMap']
  compat?: PiCatalogModel['compat']
  input: PiCatalogModel['input']
  cost: PiModelCost
  contextWindow: number
  maxTokens: number
}

const ZERO_MODEL_COST: PiModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
export const DEFAULT_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_TOKENS = 64_000
const VOLCENGINE_GLM_MAX_TOKENS = 128_000
/**
 * 当 Pi catalog 尚未包含 GLM-5.3 时，补回其官方最大输出上限，避免落到默认 64K。
 * 智谱官方文档标注 GLM-5.3 最大输出 128K，与目录中 GLM-5.2 的 131072 同一口径。
 */
const GLM_53_MAX_TOKENS = 131_072
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
const CODEX_MAX_TOKENS = 128_000
/**
 * 将 Codex 已标记的 GPT-5.x 上下文窗口外推到同名第三方模型。
 *
 * reasoning 档位由 shared reasoning profile 管理；未被 Codex 标记的 Pro/Nano SKU
 * 仍保留 catalog 的上下文窗口。
 */
export function getCodexAlignedGPT5Capabilities(modelId: string | undefined): Pick<PiModelDefaults, 'contextWindow'> | undefined {
  const contextWindow = inferCodexAlignedGPT5ContextWindow(modelId)
  if (contextWindow === undefined) return undefined
  return { contextWindow }
}

function toReasoningTransport(api: Api): ReasoningTransport {
  switch (api) {
    case 'anthropic-messages':
      return 'anthropic-messages'
    case 'openai-completions':
      return 'openai-completions'
    case 'openai-responses':
      return 'openai-responses'
    default:
      return 'other'
  }
}

/** 将共享 reasoning profile 编译为 Pi SDK 的 model compatibility patch。 */
function compilePiReasoningCapabilities(
  api: Api,
  modelId: string | undefined,
): Pick<PiModelDefaults, 'compat' | 'thinkingLevelMap'> | undefined {
  const transport = toReasoningTransport(api)
  const profile = resolveReasoningProfile({ modelId, transport })
  const encoding = profile?.encodings[transport]
  if (!encoding) return undefined

  const thinkingLevelMap = encoding.effortMap as PiCatalogModel['thinkingLevelMap']
  switch (encoding.kind) {
    case 'adaptive-effort':
      return {
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap,
      }
    // DeepSeek V4's Anthropic-compatible protocol is not adaptive thinking.
    // Pi's generic stream emits a legacy budget; the runtime request extension
    // replaces it with `thinking: enabled` + `output_config.effort`.
    case 'deepseek-output-effort':
      return { thinkingLevelMap }
    case 'openai-reasoning-effort':
      return {
        compat: { supportsReasoningEffort: true },
        thinkingLevelMap,
      }
    case 'zai-thinking-effort':
      return {
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          thinkingFormat: 'zai',
          zaiToolStream: true,
        },
        thinkingLevelMap,
      }
  }
}

/**
 * Proma re-registers every non-OAuth channel as an ephemeral Pi provider. Preserve
 * only this protocol-safe catalog flag: current Claude models require adaptive
 * thinking, while copying the complete catalog compat object could leak unrelated
 * tool/sampling behaviour across provider protocols.
 */
export function shouldForcePiAdaptiveThinking(
  api: Api,
  catalogModel: { api: Api, compat?: unknown } | undefined,
): boolean {
  if (api !== 'anthropic-messages' || catalogModel?.api !== 'anthropic-messages') return false
  return (catalogModel.compat as { forceAdaptiveThinking?: unknown } | undefined)?.forceAdaptiveThinking === true
}

const CODEX_56_THINKING_LEVEL_MAP = compilePiReasoningCapabilities('openai-responses', 'gpt-5.6')?.thinkingLevelMap

type CodexRuntimeCredential = CodexOAuthCredentials & {
  type: 'oauth'
  [key: string]: unknown
}

/** Pi 内置 Codex provider 所需的最小模型与 OAuth 输入。 */
export interface CodexModelInput {
  model?: string
  codexOAuthCredentials?: CodexOAuthCredentials
  onCodexOAuthCredentialsRefreshed?: (credentials: CodexOAuthCredentials) => void | Promise<void>
}

/** Pi 内置 xAI provider 所需的最小模型与 OAuth 输入。 */
export interface XaiModelInput {
  channelId?: string
  model?: string
  xaiOAuthCredentials?: XaiOAuthCredentials
  onXaiOAuthCredentialsRefreshed?: (credentials: XaiOAuthCredentials) => void | Promise<void>
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

type XaiRuntimeCredential = XaiOAuthCredentials & {
  type: 'oauth'
  [key: string]: unknown
}

function createXaiRuntimeCredentialStore(
  channelId: string,
  initial: XaiOAuthCredentials,
  onRefreshed?: PiAgentQueryOptions['onXaiOAuthCredentialsRefreshed'],
) {
  let credential: XaiRuntimeCredential | undefined = { type: 'oauth', ...rememberXaiOAuthCredentials(channelId, initial) }

  return {
    async read(providerId: string): Promise<XaiRuntimeCredential | undefined> {
      return providerId === 'xai' ? credential : undefined
    },
    async list(): Promise<readonly { providerId: string; type: 'oauth' }[]> {
      return credential ? [{ providerId: 'xai', type: 'oauth' }] : []
    },
    async modify(
      providerId: string,
      fn: (current: XaiRuntimeCredential | undefined) => Promise<XaiRuntimeCredential | undefined>,
    ): Promise<XaiRuntimeCredential | undefined> {
      if (providerId !== 'xai' || !credential) return undefined
      const previous = credential
      const refreshed = await refreshXaiOAuthCredentialsSerial(
        channelId,
        credential,
        async (latest) => {
          const next = await fn({ type: 'oauth', ...latest })
          if (!next) throw new Error('Pi xAI OAuth 刷新未返回凭据')
          return { access: next.access, refresh: next.refresh, expires: next.expires }
        },
      )
      credential = { type: 'oauth', ...refreshed }
      if (
        previous.access !== credential.access
        || previous.refresh !== credential.refresh
        || previous.expires !== credential.expires
      ) {
        try {
          await onRefreshed?.(credential)
        } catch (error) {
          console.warn('[Pi xAI OAuth] 刷新后的凭据回写失败，将在下次执行前重试:', error)
        }
      }
      return credential
    },
    async delete(providerId: string): Promise<void> {
      if (providerId === 'xai') credential = undefined
    },
  }
}

const CODEX_MODEL_PATCHES: PiCatalogModelPatch[] = [
  {
    id: 'gpt-5.4',
    contextWindow: CODEX_GPT_54_55_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.4-mini',
    contextWindow: CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.5',
    contextWindow: CODEX_GPT_54_55_CONTEXT_WINDOW,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_56_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: CODEX_GPT_56_CONTEXT_WINDOW,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_56_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
    contextWindow: CODEX_GPT_56_CONTEXT_WINDOW,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: CODEX_56_THINKING_LEVEL_MAP,
    input: ['text', 'image'],
    cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: CODEX_GPT_56_CONTEXT_WINDOW,
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
    case 'xai':
    case 'opencode-go-openai':
    case 'zhipu':
    case 'doubao':
    case 'doubao-api':
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

/**
 * OpenCode Go 在同一渠道提供多种协议，必须以模型目录声明为准。
 * 未命中目录时保留历史 OpenAI Chat Completions 默认值。
 */
export function resolvePiApi(provider: ProviderType, catalogApi?: Api): Api {
  if (provider === 'opencode-go-openai' && catalogApi) return catalogApi
  return normalizePiApi(provider)
}

function candidatePiProviders(provider: ProviderType): KnownProvider[] {
  switch (provider) {
    case 'anthropic':
      return ['anthropic']
    case 'openai':
    case 'openai-responses':
      return ['openai']
    case 'xai':
      return ['xai']
    case 'deepseek':
      return ['deepseek']
    case 'google':
      return ['google']
    case 'kimi-api':
      return ['moonshotai-cn', 'moonshotai']
    case 'kimi-coding':
      return ['kimi-coding', 'moonshotai-cn', 'moonshotai']
    case 'opencode-go-openai':
      return ['opencode-go']
    case 'zhipu':
      return ['zai']
    case 'zhipu-coding':
    case 'zhipu-coding-team':
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
  // ID 是渠道实际发送到上游的稳定标识；同名展示名称只能在没有 ID 命中时兜底。
  return models.find((model) => model.id.toLowerCase() === normalized)
    ?? models.find((model) => model.name.toLowerCase() === normalized)
}

/**
 * Extract an unambiguous Claude family/version key from common provider aliases.
 *
 * Catalogs vary between `claude-opus-4-6`, `Claude Opus 4.6`, and provider-scoped
 * forms such as `anthropic.claude-opus-4-6-v1`. The fallback intentionally requires
 * a family plus full major/minor version. Major-only matching is only allowed for
 * Fable, catalog entries, or an explicit `-promo` alias.
 */
function getClaudeFamilyKey(modelRef: string, allowMajorOnly = false): string | undefined {
  const normalized = modelRef.toLowerCase()
  const familyFirst = normalized.match(/claude[\s._:/-]+(opus|sonnet|haiku|fable)[\s._:/-]+(\d+)(?:[\s._:/-]+(\d+))?/)
  const versionFirst = normalized.match(/claude[\s._:/-]+(\d+)(?:[\s._:/-]+(\d+))?[\s._:/-]+(opus|sonnet|haiku)/)
  const family = familyFirst?.[1] ?? versionFirst?.[3]
  const major = familyFirst?.[2] ?? versionFirst?.[1]
  const minor = familyFirst?.[3] ?? versionFirst?.[2]
  const isPromoAlias = /[\s._:/-]promo$/.test(normalized)
  if (!family || !major || (!minor && family !== 'fable' && !allowMajorOnly && !isPromoAlias)) return undefined
  return `${family}-${major}${minor ? `-${minor}` : ''}`
}

function findClaudeCatalogModel(models: readonly PiCatalogModel[], modelId: string): PiCatalogModel | undefined {
  const familyKey = getClaudeFamilyKey(modelId)
  if (!familyKey) return undefined
  return models.find((model) =>
    getClaudeFamilyKey(model.id, true) === familyKey || getClaudeFamilyKey(model.name, true) === familyKey)
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
  if (provider === 'openai-codex') {
    return findCatalogModelById(await getCodexCatalogModels(), modelId)
  }
  if (provider === 'xai') {
    return findCatalogModelById(await getXaiCatalogModels(), modelId)
  }

  const preferredProviders = candidatePiProviders(provider)
  const { getProviders } = await loadPiAiCompat()
  const checked = new Set(preferredProviders)
  const fallbackProviders = getProviders().filter((candidate) => !checked.has(candidate))

  // The configured provider owns both exact and safe Claude-family matching.
  for (const candidate of preferredProviders) {
    const model = findCatalogModelById(await getCatalogModels(candidate), modelId)
    if (model) return model
  }

  const claudeFamilyKey = getClaudeFamilyKey(modelId)
  if (claudeFamilyKey) {
    for (const candidate of preferredProviders) {
      const model = findClaudeCatalogModel(await getCatalogModels(candidate), modelId)
      if (model) return model
    }
  }

  // Generic/custom channels can still match a provider-scoped catalog ID exactly.
  for (const candidate of fallbackProviders) {
    const model = findCatalogModelById(await getCatalogModels(candidate), modelId)
    if (model) return model
  }

  // Only relax aliases after every exact lookup has failed.
  if (claudeFamilyKey) {
    for (const candidate of fallbackProviders) {
      const model = findClaudeCatalogModel(await getCatalogModels(candidate), modelId)
      if (model) return model
    }
  }
  return undefined
}

/**
 * 解析模型图片输入能力。未知模型保持 unknown，由调用方决定是否保守拒绝。
 * 视觉助手等会产生数据外发的功能必须仅接受 confirmed supported。
 */
export async function resolvePiImageInputCapability(
  provider: ProviderType,
  modelId: string | undefined,
): Promise<'supported' | 'unsupported' | 'unknown'> {
  const resolvedModelId = stripLegacyAgentSdkContextSuffix(modelId)
  if (!resolvedModelId) return 'unknown'
  const catalogModel = await findPiCatalogModel(provider, resolvedModelId)
  if (!catalogModel) return 'unknown'
  return catalogModel.input.includes('image') ? 'supported' : 'unsupported'
}

/**
 * Vision Relay 的实际请求路由。
 *
 * OpenCode Go 的同一渠道同时提供 OpenAI 和 Anthropic Messages 模型；因此必须以
 * Pi catalog 中该模型声明的 API 与 Base URL 为准，不能只按渠道类型固定走 OpenAI。
 */
export interface PiVisionRelayRoute {
  adapterProvider: ProviderType
  baseUrl?: string
}

export async function resolvePiVisionRelayRoute(
  provider: ProviderType,
  modelId: string | undefined,
): Promise<PiVisionRelayRoute | undefined> {
  const resolvedModelId = stripLegacyAgentSdkContextSuffix(modelId)
  if (!resolvedModelId) return undefined
  const catalogModel = await findPiCatalogModel(provider, resolvedModelId)
  if (!catalogModel?.input.includes('image')) return undefined

  if (provider !== 'opencode-go-openai') {
    return { adapterProvider: provider }
  }

  switch (catalogModel.api) {
    case 'anthropic-messages':
      return {
        // Anthropic-compatible adapter 接收完整 messages 端点，避免误套 OpenAI 协议。
        adapterProvider: 'anthropic-compatible',
        baseUrl: `${normalizeVersionedAnthropicBaseUrl(catalogModel.baseUrl)}/messages`,
      }
    case 'openai-completions':
      return {
        adapterProvider: 'opencode-go-openai',
        baseUrl: catalogModel.baseUrl,
      }
    case 'openai-responses':
      return {
        adapterProvider: 'openai-responses',
        baseUrl: catalogModel.baseUrl,
      }
    default:
      return undefined
  }
}

/**
 * 解析 Pi runtime 的会话级 reasoning capability。
 *
 * 专属 profile 先匹配，保证 K3 / GLM / GPT-o 的协议映射不被 catalog 覆盖；
 * 其他模型直接采用 Pi catalog 声明的可用档位。
 */
export async function resolvePiReasoningCapability(
  provider: ProviderType,
  modelId: string | undefined,
): Promise<ReasoningCapability | undefined> {
  const resolvedModelId = stripLegacyAgentSdkContextSuffix(modelId)
  const catalogModel = resolvedModelId
    ? await findPiCatalogModel(provider, resolvedModelId)
    : undefined
  const profile = resolveReasoningProfile({
    modelId: resolvedModelId,
    transport: provider === 'openai-codex' || provider === 'xai'
      ? 'openai-responses'
      : toReasoningTransport(resolvePiApi(provider, catalogModel?.api)),
  })
  return resolveReasoningCapability({
    profile,
    catalog: catalogModel && {
      reasoning: catalogModel.reasoning,
      thinkingLevelMap: catalogModel.thinkingLevelMap,
    },
  })
}

async function resolvePiModelDefaults(input: PiAgentQueryOptions): Promise<PiModelDefaults> {
  const catalogModel = input.model ? await findPiCatalogModel(input.provider, input.model) : undefined
  const codexAlignedCapabilities = getCodexAlignedGPT5Capabilities(input.model)
  const api = resolvePiApi(input.provider, catalogModel?.api)
  const providerSpecificCapabilities = compilePiReasoningCapabilities(api, input.model)
  const glmModelId = input.model?.toLowerCase()
  const isVolcengineGlm5x = (input.provider === 'doubao' || input.provider === 'doubao-api' || input.provider === 'ark-coding-plan')
    && (glmModelId === 'glm-5.2' || glmModelId === 'glm-5.3')
  const isCatalogMissingGlm53 = !catalogModel && glmModelId === 'glm-5.3'
  const catalogContextWindow = catalogModel?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const inferredContextWindow = inferContextWindow(input.model) ?? DEFAULT_CONTEXT_WINDOW
  const shouldForceAdaptiveThinking = shouldForcePiAdaptiveThinking(api, catalogModel)
  return {
    api,
    reasoning: catalogModel?.reasoning ?? true,
    thinkingLevelMap: providerSpecificCapabilities?.thinkingLevelMap
      ?? catalogModel?.thinkingLevelMap,
    compat: shouldForceAdaptiveThinking
      ? { ...providerSpecificCapabilities?.compat, forceAdaptiveThinking: true }
      : providerSpecificCapabilities?.compat,
    input: catalogModel ? [...catalogModel.input] : ['text', 'image'],
    cost: catalogModel ? { ...catalogModel.cost } : { ...ZERO_MODEL_COST },
    // Codex 对齐策略优先；其他模型仍保留 catalog 与 shared inference 中更大的已验证能力。
    contextWindow: codexAlignedCapabilities?.contextWindow ?? Math.max(catalogContextWindow, inferredContextWindow),
    // Pi 的智谱目录将 GLM-5.2 标为 131072，但火山方舟兼容端点上限为 128000；GLM-5.3 同理。
    maxTokens: isVolcengineGlm5x
      ? VOLCENGINE_GLM_MAX_TOKENS
      : (catalogModel?.maxTokens ?? (isCatalogMissingGlm53 ? GLM_53_MAX_TOKENS : DEFAULT_MAX_TOKENS)),
  }
}

function normalizePiBaseUrl(baseUrl: string | undefined, provider: ProviderType, api = normalizePiApi(provider)): string | undefined {
  if (!baseUrl) return undefined
  if (api === 'anthropic-messages') {
    return normalizeAnthropicBaseUrlForSdk(resolveAnthropicMessagesUrl(baseUrl, provider))
  }
  if (api === 'openai-responses' || provider === 'custom') {
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
 * 与渠道认证解析保持一致。
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
export function stripLegacyAgentSdkContextSuffix(modelId: string | undefined): string | undefined {
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
export async function buildCodexModel(sdk: PiSdk, input: CodexModelInput) {
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

  const resolvedModelId = stripLegacyAgentSdkContextSuffix(input.model)
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

export async function getXaiCatalogModels(): Promise<PiCatalogModel[]> {
  const { getModels } = await loadPiAiCompat()
  return [...getModels('xai')]
}

/**
 * 为 xAI（Grok/X 订阅）OAuth 渠道构建 Pi 内置模型。
 *
 * xAI 的 device-code token 不等同于 xAI API key，必须注入内存 CredentialStore
 * 并使用内置 `xai` provider，不能退回 registerProvider() 的 API key 路径。
 */
export async function buildXaiModel(sdk: PiSdk, input: XaiModelInput) {
  if (!input.xaiOAuthCredentials || !input.channelId) {
    throw new Error('xAI OAuth 凭据或渠道标识缺失，请重新登录')
  }
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: createXaiRuntimeCredentialStore(
      input.channelId,
      input.xaiOAuthCredentials,
      input.onXaiOAuthCredentialsRefreshed,
    ),
    allowModelNetwork: false,
  })
  const resolvedModelId = stripLegacyAgentSdkContextSuffix(input.model)
  const xaiModels = await getXaiCatalogModels()
  const model = (resolvedModelId ? modelRuntime.getModel('xai', resolvedModelId) : undefined)
    ?? (resolvedModelId ? findCatalogModelById(xaiModels, resolvedModelId) : undefined)
    ?? modelRuntime.getModels('xai')[0]
  if (!model) {
    throw new Error('未找到可用的 xAI（Grok）模型，请确认订阅已授权并升级 Pi 运行时')
  }
  return { modelRuntime, model }
}

/** 列出 Pi SDK 内置的 xAI（Grok）模型 ID，供订阅登录后拉取模型使用。 */
export async function listXaiModels(): Promise<{ id: string; name: string }[]> {
  return (await getXaiCatalogModels()).map((m) => ({ id: m.id, name: m.name }))
}

export async function buildModel(sdk: PiSdk, input: PiAgentQueryOptions) {
  if (input.provider === 'openai-codex') {
    return buildCodexModel(sdk, input)
  }
  if (input.provider === 'xai') {
    return buildXaiModel(sdk, input)
  }
  const providerName = `proma-${input.provider}-${input.sessionId}`
  const resolvedApiKey = resolvePiApiKey(input.provider, input.apiKey)
  // pi runtime 统一剥离历史 `[1m]` 后缀：无论上游从哪条路径传入，注册与查找都用干净 ID。
  const resolvedModelId = stripLegacyAgentSdkContextSuffix(input.model)
  const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
  const modelDefaults = await resolvePiModelDefaults({ ...input, model: resolvedModelId })
  const api = modelDefaults.api
  const baseUrl = normalizePiBaseUrl(input.baseUrl, input.provider, api)
  if (!baseUrl) {
    throw new Error(`渠道 ${input.channelName ?? input.provider} 缺少 Base URL`)
  }
  const headers = buildPiRequestHeaders(input.provider, resolvedApiKey)
  const compat = {
    ...modelDefaults.compat,
    ...(supportsPiDeveloperRole(input.provider) ? {} : { supportsDeveloperRole: false }),
  }
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
      ...(modelDefaults.thinkingLevelMap ? { thinkingLevelMap: modelDefaults.thinkingLevelMap } : {}),
      ...(Object.keys(compat).length > 0 ? { compat } : {}),
      input: modelDefaults.input,
      cost: modelDefaults.cost,
      contextWindow: modelDefaults.contextWindow,
      maxTokens: modelDefaults.maxTokens,
    }],
  })
  const model = modelRuntime.getModel(providerName, resolvedModelId ?? 'default')
  if (!model) throw new Error(`Pi model registration failed: ${resolvedModelId ?? 'default'}`)
  return { modelRuntime, model }
}
