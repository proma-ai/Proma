/**
 * 渠道管理器
 *
 * 负责渠道的 CRUD 操作、API Key 加密/解密、连接测试。
 * 使用 Electron safeStorage 进行 API Key 加密（底层使用 OS 级加密）。
 * 数据持久化到 ~/.proma/channels.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { getChannelsPath } from './config-paths'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelsConfig,
  ChannelTestResult,
  ChannelDirectTestInput,
  ChannelModel,
  ChannelPlanQuotaResult,
  ChannelPlanQuotaWindow,
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@proma/shared'
import {
  extractZhipuCodingTeamApiToken,
  parseZhipuTeamCredentials,
  PROVIDER_DEFAULT_URLS,
  parseCodexCredentials,
  serializeCodexCredentials,
  isCodexCredentialExpired,
} from '@proma/shared'
import { refreshCodexOAuth } from './codex-oauth-service'
import { parseCodexPlanQuotaResponse } from './codex-plan-quota'
import { listCodexModels } from './adapters/pi-model-registry'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import {
  getPromaUserAgent,
  migrateCompatibleChannelBaseUrl,
  normalizeBaseUrl,
  resolveAnthropicMessagesUrl,
  resolveAnthropicModelsUrl,
  resolveOpenAIModelsUrl,
} from '@proma/core'
import { normalizeHttpResponse, normalizeRequestError } from './channel-test-error'
import pkg from '../../../package.json' with { type: 'json' }

/** 当前配置版本 */
const CONFIG_VERSION = 2
/** 连接测试 / 模型拉取的统一超时时间 */
const CHANNEL_TEST_TIMEOUT_MS = 15_000
// ChatGPT backend 首次经代理 / Cloudflare 建连可能超过普通模型探测的 15 秒。
const CODEX_PLAN_QUOTA_TIMEOUT_MS = 30_000
const ARK_CODING_PLAN_TEST_MODEL = 'doubao-seed-2.0-code'
const DEEPSEEK_PRESET_MODELS: ChannelModel[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
]
const KIMI_PRESET_MODELS: ChannelModel[] = [
  { id: 'k3', name: 'Kimi K3', enabled: true },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', enabled: true },
]
const XIAOMI_PRESET_MODELS: ChannelModel[] = [
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', enabled: true },
  { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', enabled: true },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', enabled: true },
  { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', enabled: true },
  { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', enabled: true },
]
const ARK_CODING_PLAN_MODELS: ChannelModel[] = [
  { id: 'doubao-seed-2.0-code', name: 'Doubao Seed 2.0 Code', enabled: true },
  { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro', enabled: true },
  { id: 'doubao-seed-2.0-lite', name: 'Doubao Seed 2.0 Lite', enabled: true },
  { id: 'glm-5.2', name: 'GLM-5.2', enabled: true },
  { id: 'k3', name: 'Kimi K3', enabled: true },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', enabled: true },
  { id: 'minimax-m3', name: 'MiniMax M3', enabled: true },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
]

/**
 * 为连接测试 / 模型拉取请求统一附加超时信号。
 * 避免供应商不响应时请求无限挂起。
 */
function withTimeout(init: RequestInit, timeoutMs = CHANNEL_TEST_TIMEOUT_MS): RequestInit {
  return { ...init, signal: AbortSignal.timeout(timeoutMs) }
}

function cloneModels(models: ChannelModel[]): ChannelModel[] {
  return models.map((model) => ({ ...model }))
}

function createPresetModelsResult(providerName: string, models: ChannelModel[]): FetchModelsResult {
  return {
    success: true,
    message: `${providerName} 未开放模型列表端点，已加载 ${models.length} 个预设模型`,
    models: cloneModels(models),
  }
}

function resolveFirstTestModelId(models?: ChannelModel[]): string | undefined {
  return models?.find((model) => model.enabled)?.id ?? models?.[0]?.id
}

function resolveDeepSeekTestModelId(modelId?: string, models?: ChannelModel[]): string {
  const explicitModelId = modelId?.trim()
  if (explicitModelId) return explicitModelId
  return resolveFirstTestModelId(models) ?? DEEPSEEK_PRESET_MODELS[0]!.id
}

function resolveKimiTestModelId(modelId?: string, models?: ChannelModel[]): string {
  const explicitModelId = modelId?.trim()
  if (explicitModelId) return explicitModelId
  return resolveFirstTestModelId(models) ?? KIMI_PRESET_MODELS[0]!.id
}

function resolveXiaomiTestModelId(modelId?: string, models?: ChannelModel[]): string {
  const explicitModelId = modelId?.trim()
  if (explicitModelId) return explicitModelId
  return resolveFirstTestModelId(models) ?? XIAOMI_PRESET_MODELS[0]!.id
}

function resolveDeepSeekModelsUrl(baseUrl: string): string {
  return `${new URL(baseUrl.trim()).origin}/models`
}

function resolveKimiModelsUrl(baseUrl: string): string {
  const origin = new URL(baseUrl.trim()).origin
  return `${origin}/v1/models`
}

function inferProviderFromBaseUrl(provider: ProviderType, baseUrl: string): ProviderType {
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    if (hostname.startsWith('token-plan-') && hostname.endsWith('.xiaomimimo.com')) {
      return 'xiaomi-token-plan'
    }
    if (hostname === 'api.xiaomimimo.com') {
      return 'xiaomi'
    }
    if (hostname === 'api.moonshot.cn' || hostname === 'api.moonshot.ai') {
      return 'kimi-api'
    }
    return provider
  } catch {
    return provider
  }
}

/**
 * 将渠道配置迁移到最新版本。
 *
 * v1 → v2：custom / anthropic-compatible 两类通用兼容渠道的 baseUrl 语义从「Base URL（运行时
 * 自动补端点后缀）」改为「完整请求地址（原样使用）」。把存量 baseUrl 一次性补全为旧版本实际
 * 请求过的完整端点，使升级后的运行时行为与升级前保持一致。详见 migrateCompatibleChannelBaseUrl。
 *
 * @returns 迁移后的配置；`changed` 标记是否发生实际变更（决定是否需要回写文件）
 */
function migrateConfig(config: ChannelsConfig): { config: ChannelsConfig; changed: boolean } {
  const version = config.version ?? 1
  if (version >= CONFIG_VERSION) {
    return { config, changed: false }
  }

  let mutated = false
  const channels = config.channels.map((channel) => {
    if (channel.provider !== 'custom' && channel.provider !== 'anthropic-compatible') {
      return channel
    }
    const migratedUrl = migrateCompatibleChannelBaseUrl(channel.baseUrl, channel.provider)
    if (migratedUrl === channel.baseUrl) {
      return channel
    }
    mutated = true
    console.log(
      `[渠道管理] v${version}→v${CONFIG_VERSION} 迁移渠道 ${channel.name} (${channel.provider}) Base URL: ${channel.baseUrl} → ${migratedUrl}`,
    )
    return { ...channel, baseUrl: migratedUrl }
  })

  return { config: { version: CONFIG_VERSION, channels }, changed: true }
}

/**
 * 读取渠道配置文件
 *
 * 读取时自动将旧版本配置迁移到 CONFIG_VERSION，并在发生变更时回写。
 */
function readConfig(): ChannelsConfig {
  const configPath = getChannelsPath()

  if (!existsSync(configPath)) {
    return { version: CONFIG_VERSION, channels: [] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as ChannelsConfig
    const { config, changed } = migrateConfig(parsed)
    if (changed) {
      writeConfig(config)
      console.log('[渠道管理] 渠道配置已迁移并持久化')
    }
    return config
  } catch (error) {
    console.error('[渠道管理] 读取配置文件失败:', error)
    return { version: CONFIG_VERSION, channels: [] }
  }
}

/**
 * 写入渠道配置文件
 */
function writeConfig(config: ChannelsConfig): void {
  const configPath = getChannelsPath()

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[渠道管理] 写入配置文件失败:', error)
    throw new Error('写入渠道配置失败')
  }
}

/**
 * 加密 API Key
 *
 * 使用 Electron safeStorage 加密，底层使用：
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: Secret Service API
 *
 * @returns base64 编码的加密字符串
 */
function encryptApiKey(plainKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[渠道管理] safeStorage 加密不可用，将以明文存储')
    return plainKey
  }

  const encrypted = safeStorage.encryptString(plainKey)
  return encrypted.toString('base64')
}

/**
 * 解密 API Key
 *
 * @param encryptedKey base64 编码的加密字符串
 * @returns 明文 API Key
 */
function decryptKey(encryptedKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // 如果加密不可用，假设存储的是明文
    return encryptedKey
  }

  try {
    const buffer = Buffer.from(encryptedKey, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[渠道管理] 解密 API Key 失败:', error)
    throw new Error('解密 API Key 失败')
  }
}

/**
 * 获取所有渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 * 首次调用时，如果没有任何 DeepSeek 渠道，自动创建预设渠道。
 */
export function listChannels(): Channel[] {
  const config = readConfig()

  // 首次使用：如果没有 DeepSeek 渠道，自动创建预设
  const hasDeepSeek = config.channels.some(
    (c) => c.provider === 'deepseek' || c.baseUrl.includes('api.deepseek.com'),
  )
  if (!hasDeepSeek) {
    const now = Date.now()
    const presetChannel: Channel = {
      id: randomUUID(),
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: PROVIDER_DEFAULT_URLS.deepseek,
      apiKey: encryptApiKey(''),
      models: cloneModels(DEEPSEEK_PRESET_MODELS),
      enabled: false,
      createdAt: now,
      updatedAt: now,
    }
    config.channels.push(presetChannel)
    writeConfig(config)
    console.log('[渠道管理] 已自动创建 DeepSeek 预设渠道')
    return config.channels
  }

  return config.channels
}

/**
 * 按 ID 获取渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 */
export function getChannelById(id: string): Channel | undefined {
  const config = readConfig()
  return config.channels.find((c) => c.id === id)
}

/**
 * 创建新渠道
 *
 * @param input 渠道创建数据（apiKey 为明文，会自动加密）
 * @returns 创建后的渠道（apiKey 为加密态）
 */
export function createChannel(input: ChannelCreateInput): Channel {
  const config = readConfig()
  const now = Date.now()

  const channel: Channel = {
    id: randomUUID(),
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: encryptApiKey(input.apiKey),
    models: input.models,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  }

  config.channels.push(channel)
  writeConfig(config)

  console.log(`[渠道管理] 已创建渠道: ${channel.name} (${channel.id})`)
  return channel
}

/**
 * 更新渠道
 *
 * @param id 渠道 ID
 * @param input 更新数据（apiKey 为明文，空字符串表示不更新）
 * @returns 更新后的渠道
 */
export function updateChannel(id: string, input: ChannelUpdateInput): Channel {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const existing = config.channels[index]!

  const updated: Channel = {
    ...existing,
    name: input.name ?? existing.name,
    provider: input.provider ?? existing.provider,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    apiKey: input.apiKey ? encryptApiKey(input.apiKey) : existing.apiKey,
    models: input.models ?? existing.models,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  }

  config.channels[index] = updated
  writeConfig(config)

  console.log(`[渠道管理] 已更新渠道: ${updated.name} (${updated.id})`)
  return updated
}

/**
 * 删除渠道
 */
export function deleteChannel(id: string): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const removed = config.channels.splice(index, 1)[0]!
  writeConfig(config)

  console.log(`[渠道管理] 已删除渠道: ${removed.name} (${removed.id})`)
}

/**
 * 解密渠道的 API Key
 *
 * 仅在用户需要查看时调用。
 */
export function decryptApiKey(channelId: string): string {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)

  if (!channel) {
    throw new Error(`渠道不存在: ${channelId}`)
  }

  return decryptKey(channel.apiKey)
}

/**
 * 进行中的 codex token 刷新（按 channelId 去重）。
 *
 * 多个 Agent 会话可能并发触发同一渠道的 token 刷新；若不去重会造成对
 * OpenAI token 端点的重复请求，且后写覆盖先写。此 Map 保证同一渠道同一时刻
 * 只有一次刷新在飞行，其余调用复用同一 Promise。对应 memory 里记过的
 * 「OAuth 刷新需并发锁」经验。
 */
const inflightCodexRefresh = new Map<string, Promise<string>>()

/**
 * 解析渠道存储的 ChatGPT (Codex) OAuth 凭据，按需刷新并回写，返回可用的 access token。
 *
 * - 渠道 apiKey 字段存的是加密后的凭据 JSON（access/refresh/expires）。
 * - access token 未过期：直接返回。
 * - 已过期或即将过期：用 refresh token 换新，加密回写渠道，返回新的 access token。
 *
 * 仅用于 provider === 'openai-codex' 的渠道。刷新失败时抛错，交由上层映射为
 * expired_oauth_token 并引导用户重新登录。
 */
export async function resolveCodexAccessToken(channelId: string): Promise<string> {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)
  if (!channel) {
    throw new Error(`渠道不存在: ${channelId}`)
  }

  const credentials = parseCodexCredentials(decryptKey(channel.apiKey))
  if (!credentials) {
    throw new Error('ChatGPT 登录凭据无效或缺失，请重新登录')
  }

  if (!isCodexCredentialExpired(credentials)) {
    return credentials.access
  }

  // 过期：去重刷新。同一渠道并发调用复用同一个刷新 Promise。
  const existing = inflightCodexRefresh.get(channelId)
  if (existing) return existing

  const refreshPromise = (async (): Promise<string> => {
    try {
      const refreshed = await refreshCodexOAuth(credentials.refresh)
      // 回写加密凭据（保留刚拿到的 accountId，缺省沿用旧值）。
      const merged = {
        ...refreshed,
        accountId: refreshed.accountId ?? credentials.accountId,
      }
      updateChannel(channelId, { apiKey: serializeCodexCredentials(merged) })
      return refreshed.access
    } finally {
      inflightCodexRefresh.delete(channelId)
    }
  })()

  inflightCodexRefresh.set(channelId, refreshPromise)
  return refreshPromise
}

/**
 * 解析渠道运行时实际使用的认证 token。
 *
 * 普通渠道直接解密 API Key；ChatGPT (Codex) OAuth 渠道的 apiKey 字段存储的是
 * OAuth 凭据 JSON，运行时必须取出 access token 并按需刷新。
 */
export async function resolveChannelRuntimeApiKey(channelId: string): Promise<string> {
  const channel = getChannelById(channelId)
  if (!channel) {
    throw new Error(`渠道不存在: ${channelId}`)
  }

  return channel.provider === 'openai-codex'
    ? resolveCodexAccessToken(channelId)
    : decryptApiKey(channelId)
}

/**
 * 测试渠道连接
 *
 * 向供应商的 API 发送简单请求，验证 API Key 和连接是否有效。
 */
export async function testChannel(channelId: string): Promise<ChannelTestResult> {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)

  if (!channel) {
    return { success: false, message: '渠道不存在' }
  }

  const apiKey = decryptKey(channel.apiKey)
  const proxyUrl = await getEffectiveProxyUrl()
  const provider = inferProviderFromBaseUrl(channel.provider, channel.baseUrl)

  try {
    switch (provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'zhipu-coding-team':
      case 'ark-coding-plan':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
        if (provider === 'deepseek') {
          return await testDeepSeekMessages(
            channel.baseUrl,
            apiKey,
            resolveDeepSeekTestModelId(undefined, channel.models),
            proxyUrl,
          )
        }
        if (provider === 'kimi-api') {
          return await testKimiMessages(
            channel.baseUrl,
            apiKey,
            resolveKimiTestModelId(undefined, channel.models),
            proxyUrl,
          )
        }
        if (provider === 'xiaomi') {
          return await testXiaomiMessages(
            channel.baseUrl,
            apiKey,
            resolveXiaomiTestModelId(undefined, channel.models),
            'xiaomi',
            proxyUrl,
          )
        }
        if (provider === 'xiaomi-token-plan') {
          return await testXiaomiMessages(
            channel.baseUrl,
            apiKey,
            resolveXiaomiTestModelId(undefined, channel.models),
            'xiaomi-token-plan',
            proxyUrl,
          )
        }
        if (provider === 'ark-coding-plan') {
          return await testArkCodingPlan(channel.baseUrl, apiKey, proxyUrl)
        }
        if (provider === 'zhipu-coding-team') {
          return await testZhipuCodingTeam(apiKey, channel.baseUrl, proxyUrl)
        }
        return await testAnthropicCompatible(channel.baseUrl, apiKey, proxyUrl, provider)
      case 'openai':
      case 'openai-responses':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(channel.baseUrl, apiKey, proxyUrl, provider)
      case 'google':
        return await testGoogle(channel.baseUrl, apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${provider}。你可能过去使用的是 Proma 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。` }
    }
  } catch (error) {
    return normalizeRequestError(error)
  }
}

/**
 * 测试 Anthropic 兼容 API 连接（Anthropic / DeepSeek / Kimi API / Kimi Coding Plan / MiniMax）
 *
 * DeepSeek / Kimi 等内置供应商会按协议根路径补全端点。
 * Anthropic 兼容格式使用用户填写的完整请求地址。
 * Coding Plan 渠道必须发送 Proma User-Agent，否则返回 403。
 */
async function testAnthropicCompatible(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  provider: ProviderType = 'anthropic',
): Promise<ChannelTestResult> {
  const url = resolveAnthropicModelsUrl(baseUrl, provider)
  const fetchFn = getFetchFn(proxyUrl)

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  }
  if (provider === 'kimi-coding' || provider === 'zhipu-coding' || provider === 'zhipu-coding-team') {
    const authToken = provider === 'zhipu-coding-team' ? extractZhipuCodingTeamApiToken(apiKey) : apiKey
    headers.Authorization = `Bearer ${authToken}`
    headers['User-Agent'] = getPromaUserAgent(pkg.version)
  } else if (provider === 'xiaomi-token-plan') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['User-Agent'] = getPromaUserAgent(pkg.version)
  } else if (provider === 'minimax' || provider === 'qwen-anthropic') {
    headers.Authorization = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers,
  }))

  return normalizeHttpResponse(response)
}

/**
 * DeepSeek 的 /models 端点可用性与具体模型可用性不完全等价。
 * 连接测试使用渠道第一个可用模型发极小 messages 请求，更贴近真实使用路径。
 */
async function testDeepSeekMessages(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  proxyUrl?: string,
): Promise<ChannelTestResult> {
  const url = resolveAnthropicMessagesUrl(baseUrl, 'deepseek')
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }))

  return normalizeHttpResponse(response)
}

/**
 * Kimi API 的连接测试使用 Anthropic messages 端点和第一个可用模型。
 */
async function testKimiMessages(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  proxyUrl?: string,
): Promise<ChannelTestResult> {
  const url = resolveAnthropicMessagesUrl(baseUrl, 'kimi-api')
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }))

  return normalizeHttpResponse(response)
}

/**
 * 小米 API 的模型可用性需要走真实 messages 请求验证。
 */
async function testXiaomiMessages(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  provider: 'xiaomi' | 'xiaomi-token-plan',
  proxyUrl?: string,
): Promise<ChannelTestResult> {
  const url = resolveAnthropicMessagesUrl(baseUrl, provider)
  const fetchFn = getFetchFn(proxyUrl)

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
  if (provider === 'xiaomi-token-plan') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['User-Agent'] = getPromaUserAgent(pkg.version)
  } else {
    headers['api-key'] = apiKey
  }

  const response = await fetchFn(url, withTimeout({
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }))

  return normalizeHttpResponse(response)
}

/**
 * 火山方舟 Coding Plan 当前没有可用的模型列表端点，连接测试改用极小的 messages 请求。
 */
async function testArkCodingPlan(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<ChannelTestResult> {
  const url = resolveAnthropicMessagesUrl(baseUrl, 'ark-coding-plan')
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ARK_CODING_PLAN_TEST_MODEL,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  }))

  return normalizeHttpResponse(response)
}

/**
 * 测试 OpenAI 兼容 API 连接（OpenAI / Custom）
 */
async function testOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  provider: ProviderType = 'openai',
): Promise<ChannelTestResult> {
  const url = resolveOpenAIModelsUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }))

  return normalizeHttpResponse(response)
}

/**
 * 测试 Google Generative AI API 连接
 */
async function testGoogle(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<ChannelTestResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, withTimeout({
    method: 'GET',
  }))

  return normalizeHttpResponse(response)
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizePlanQuotaTimestamp(value?: number | string): number | undefined {
  if (value == null || value === '') return undefined
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return undefined
  return timestamp > 0 && timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
}

function planQuotaResetAt(value?: number | string): Pick<ChannelPlanQuotaWindow, 'resetAt'> {
  const resetAt = normalizePlanQuotaTimestamp(value)
  return resetAt ? { resetAt } : {}
}

function createUnsupportedPlanQuota(provider: ProviderType, message: string): ChannelPlanQuotaResult {
  return {
    supported: false,
    provider,
    windows: [],
    updatedAt: Date.now(),
    message,
  }
}

/**
 * 查询 ChatGPT (Codex) OAuth 订阅的滚动额度。
 *
 * `wham/usage` 是 Codex CLI 使用的 ChatGPT backend 接口；除 bearer token 外，
 * 团队/企业账号还需要 `ChatGPT-Account-Id` 以定位当前订阅。
 */
async function queryCodexPlanQuota(
  channelId: string,
  serializedCredentials: string,
  proxyUrl?: string,
): Promise<ChannelPlanQuotaResult> {
  const credentials = parseCodexCredentials(serializedCredentials)
  if (!credentials) {
    return createUnsupportedPlanQuota('openai-codex', 'ChatGPT 登录凭据无效或缺失，请重新登录')
  }

  const accessToken = await resolveCodexAccessToken(channelId)
  // token 刷新时会把新凭据回写到 Channel，重新读取以取得可能更新的 accountId。
  const activeCredentials = parseCodexCredentials(decryptApiKey(channelId)) ?? credentials
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': getPromaUserAgent(pkg.version),
  }
  if (activeCredentials.accountId) {
    headers['ChatGPT-Account-Id'] = activeCredentials.accountId
  }

  try {
    const response = await getFetchFn(proxyUrl)(
      'https://chatgpt.com/backend-api/wham/usage',
      withTimeout({ method: 'GET', headers }, CODEX_PLAN_QUOTA_TIMEOUT_MS),
    )
    const responseText = await response.text()
    if (!response.ok) {
      return createUnsupportedPlanQuota('openai-codex', `ChatGPT Codex 额度查询失败: HTTP ${response.status}`)
    }

    try {
      return parseCodexPlanQuotaResponse(JSON.parse(responseText))
    } catch {
      return createUnsupportedPlanQuota('openai-codex', 'ChatGPT Codex 额度响应格式错误')
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return createUnsupportedPlanQuota('openai-codex', 'ChatGPT Codex 额度查询超时，请检查网络或代理后重试')
    }
    throw error
  }
}

async function queryKimiPlanQuota(apiKey: string, proxyUrl?: string): Promise<ChannelPlanQuotaResult> {
  const fetchFn = getFetchFn(proxyUrl)
  const response = await fetchFn('https://api.kimi.com/coding/v1/usages', withTimeout({
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': getPromaUserAgent(pkg.version),
      Authorization: `Bearer ${apiKey}`,
    },
  }))
  const responseText = await response.text()
  if (!response.ok) {
    return createUnsupportedPlanQuota('kimi-coding', `Kimi 额度查询失败: HTTP ${response.status}`)
  }

  let data: {
    usage?: { remaining?: string | number; used?: string | number; resetTime?: string }
    limits?: Array<{
      window: { duration: number; timeUnit: string }
      detail: { remaining?: string | number; used?: string | number; resetTime?: string }
    }>
    code?: string
  }
  try {
    data = JSON.parse(responseText)
  } catch {
    return createUnsupportedPlanQuota('kimi-coding', 'Kimi 额度响应格式错误')
  }

  if (data.code) {
    return createUnsupportedPlanQuota('kimi-coding', `Kimi 额度查询失败: ${data.code}`)
  }
  if (!data.usage) {
    return createUnsupportedPlanQuota('kimi-coding', 'Kimi 未返回订阅额度数据')
  }

  const windows: ChannelPlanQuotaWindow[] = []
  const summaryRemaining = clampPercent(Number(data.usage.remaining ?? 0))
  const summaryUsed = clampPercent(Number(data.usage.used ?? (100 - summaryRemaining)))
  windows.push({
    type: 'weekly',
    label: '每周额度',
    remainingPercent: summaryRemaining,
    usedPercent: summaryUsed,
    ...planQuotaResetAt(data.usage.resetTime),
  })

  for (const item of data.limits ?? []) {
    const remaining = clampPercent(Number(item.detail.remaining ?? 0))
    const used = clampPercent(Number(item.detail.used ?? (100 - remaining)))
    const duration = item.window.duration
    const isFiveHourWindow = (duration === 5 && item.window.timeUnit === 'TIME_UNIT_HOUR')
      || (duration === 300 && item.window.timeUnit === 'TIME_UNIT_MINUTE')
    const unitLabel = item.window.timeUnit === 'TIME_UNIT_HOUR'
      ? '小时'
      : item.window.timeUnit === 'TIME_UNIT_MINUTE'
        ? '分钟'
        : item.window.timeUnit === 'TIME_UNIT_DAY'
          ? '天'
          : item.window.timeUnit === 'TIME_UNIT_MONTH'
            ? '月'
            : item.window.timeUnit
    windows.push({
      type: isFiveHourWindow ? '5h' : 'custom',
      label: isFiveHourWindow ? '每 5 小时' : `${duration} ${unitLabel}`,
      remainingPercent: remaining,
      usedPercent: used,
      ...planQuotaResetAt(item.detail.resetTime),
    })
  }

  return {
    supported: true,
    provider: 'kimi-coding',
    planName: 'Kimi For Coding',
    windows,
    updatedAt: Date.now(),
  }
}

async function queryMiniMaxPlanQuota(apiKey: string, baseUrl: string, proxyUrl?: string): Promise<ChannelPlanQuotaResult> {
  const fetchFn = getFetchFn(proxyUrl)
  let requestUrl = 'https://www.minimaxi.com/v1/token_plan/remains'
  try {
    if (new URL(baseUrl).hostname.includes('minimax.io')) {
      requestUrl = requestUrl.replace('.minimaxi.com', '.minimax.io')
    }
  } catch {
    // 保持默认查询地址
  }

  const response = await fetchFn(requestUrl, withTimeout({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': getPromaUserAgent(pkg.version),
    },
  }))
  const responseText = await response.text()
  if (!response.ok) {
    return createUnsupportedPlanQuota('minimax', `MiniMax Token Plan 额度查询失败: HTTP ${response.status}`)
  }

  let data: {
    model_remains?: Array<{
      model_name: string
      current_interval_remaining_percent?: number
      current_weekly_total_count?: number
      current_weekly_remaining_percent?: number
      end_time?: number
      weekly_end_time?: number
    }>
    base_resp?: { status_code: number; status_msg: string }
  }
  try {
    data = JSON.parse(responseText)
  } catch {
    return createUnsupportedPlanQuota('minimax', 'MiniMax Token Plan 额度响应格式错误')
  }

  if (data.base_resp && data.base_resp.status_code !== 0) {
    return createUnsupportedPlanQuota('minimax', data.base_resp.status_msg || 'MiniMax Token Plan 额度查询失败')
  }

  const general = (data.model_remains ?? []).filter((item) => item.model_name === 'general')
  if (general.length === 0) {
    return createUnsupportedPlanQuota('minimax', 'MiniMax Token Plan 未返回通用额度数据')
  }

  const windows: ChannelPlanQuotaWindow[] = []
  for (const item of general) {
    const intervalRemaining = clampPercent(item.current_interval_remaining_percent ?? 100)
    windows.push({
      type: '5h',
      label: '每 5 小时',
      remainingPercent: intervalRemaining,
      usedPercent: clampPercent(100 - intervalRemaining),
      ...planQuotaResetAt(item.end_time),
    })
    if (item.current_weekly_total_count) {
      const weeklyRemaining = clampPercent(item.current_weekly_remaining_percent ?? 100)
      windows.push({
        type: 'weekly',
        label: '每周额度',
        remainingPercent: weeklyRemaining,
        usedPercent: clampPercent(100 - weeklyRemaining),
        ...planQuotaResetAt(item.weekly_end_time),
      })
    }
  }

  return {
    supported: true,
    provider: 'minimax',
    planName: 'MiniMax Token Plan',
    windows,
    updatedAt: Date.now(),
  }
}

function formatDeepSeekBalanceAmount(currency: string | undefined, value: string | number | undefined): string {
  const raw = value == null ? 0 : Number(value)
  const amount = Number.isFinite(raw) ? raw : 0
  const normalizedCurrency = (currency ?? '').trim().toUpperCase()
  if (normalizedCurrency === 'CNY' || normalizedCurrency === 'RMB') {
    return `¥${amount.toFixed(2)}`
  }
  if (normalizedCurrency === 'USD') {
    return `$${amount.toFixed(2)}`
  }
  if (normalizedCurrency) {
    return `${normalizedCurrency} ${amount.toFixed(2)}`
  }
  return amount.toFixed(2)
}

async function queryDeepSeekBalance(apiKey: string, baseUrl: string, proxyUrl?: string): Promise<ChannelPlanQuotaResult> {
  const fetchFn = getFetchFn(proxyUrl)
  let requestUrl = 'https://api.deepseek.com/user/balance'
  try {
    requestUrl = `${new URL(baseUrl).origin}/user/balance`
  } catch {
    // 保持官方默认查询地址
  }

  const response = await fetchFn(requestUrl, withTimeout({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': getPromaUserAgent(pkg.version),
    },
  }))
  const responseText = await response.text()
  if (!response.ok) {
    return createUnsupportedPlanQuota('deepseek', `DeepSeek 余额查询失败: HTTP ${response.status}`)
  }

  let data: {
    is_available?: boolean
    balance_infos?: Array<{
      currency?: string
      total_balance?: string
      granted_balance?: string
      topped_up_balance?: string
    }>
    error?: { message?: string }
  }
  try {
    data = JSON.parse(responseText)
  } catch {
    return createUnsupportedPlanQuota('deepseek', 'DeepSeek 余额响应格式错误')
  }

  if (data.error?.message) {
    return createUnsupportedPlanQuota('deepseek', data.error.message)
  }

  const balances = data.balance_infos ?? []
  if (balances.length === 0) {
    return createUnsupportedPlanQuota('deepseek', 'DeepSeek 未返回余额数据')
  }

  const preferred = balances.find((item) => (item.currency ?? '').toUpperCase() === 'CNY')
    ?? balances.find((item) => Number(item.total_balance ?? 0) > 0)
    ?? balances[0]!
  const amountLabel = formatDeepSeekBalanceAmount(preferred.currency, preferred.total_balance)
  const granted = Number(preferred.granted_balance ?? 0)
  const toppedUp = Number(preferred.topped_up_balance ?? 0)
  const total = Number(preferred.total_balance ?? 0)
  const denominator = granted + toppedUp
  const remainingPercent = denominator > 0
    ? clampPercent((total / denominator) * 100)
    : data.is_available === false
      ? 0
      : 100

  return {
    supported: true,
    provider: 'deepseek',
    planName: 'DeepSeek 账户余额',
    windows: [{
      type: 'custom',
      label: '账户余额',
      remainingPercent,
      usedPercent: clampPercent(100 - remainingPercent),
      remainingLabel: amountLabel,
      showProgress: denominator > 0,
    }],
    updatedAt: Date.now(),
    message: data.is_available === false ? 'DeepSeek 账户余额不可用' : undefined,
  }
}

interface ZhipuQuotaLimitItem {
  type: 'TIME_LIMIT' | 'TOKENS_LIMIT'
  unit?: number
  number?: number
  percentage?: number
  remaining?: number
  usage?: number
  currentValue?: number
  nextResetTime?: number
  usageDetails?: Array<{
    modelCode: string
    usage: number
  }>
}

interface ZhipuQuotaResponse {
  code?: number
  msg?: string
  success?: boolean
  data?: {
    limits?: ZhipuQuotaLimitItem[]
    level?: string
  }
}

function createZhipuQuotaUrl(baseUrl: string, query?: Record<string, string>): string {
  let requestUrl = 'https://bigmodel.cn/api/monitor/usage/quota/limit'
  try {
    const hostname = new URL(baseUrl).hostname
    if (hostname === 'api.z.ai') {
      requestUrl = 'https://api.z.ai/api/monitor/usage/quota/limit'
    } else if (hostname === 'open.bigmodel.cn') {
      requestUrl = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
    }
  } catch {
    // 保持默认查询地址
  }

  const url = new URL(requestUrl)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function createZhipuInternationalQuotaUrl(query?: Record<string, string>): string {
  const url = new URL('https://api.z.ai/api/monitor/usage/quota/limit')
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function createZhipuTeamQuotaUrl(): string {
  const url = new URL('https://bigmodel.cn/api/monitor/usage/quota/limit')
  url.searchParams.set('type', '2')
  return url.toString()
}

async function fetchZhipuQuota(
  apiKey: string,
  requestUrl: string,
  proxyUrl?: string,
): Promise<ZhipuQuotaResponse | { error: string }> {
  const fetchFn = getFetchFn(proxyUrl)
  const response = await fetchFn(requestUrl, withTimeout({
    method: 'GET',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      'User-Agent': getPromaUserAgent(pkg.version),
    },
  }))
  const responseText = await response.text()
  if (!response.ok) {
    return { error: `智谱 Coding Plan 额度查询失败: HTTP ${response.status}` }
  }

  try {
    return JSON.parse(responseText) as ZhipuQuotaResponse
  } catch {
    return { error: '智谱 Coding Plan 额度响应格式错误' }
  }
}

async function fetchZhipuTeamQuota(
  credentials: import('@proma/shared').ZhipuTeamCredentials,
  proxyUrl?: string,
): Promise<ZhipuQuotaResponse | { error: string }> {
  const fetchFn = getFetchFn(proxyUrl)
  const headers: Record<string, string> = {
    Authorization: credentials.apiKey,
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'set-language': 'zh',
    Referer: 'https://bigmodel.cn/coding-plan/team/usage-stats',
    'User-Agent': getPromaUserAgent(pkg.version),
  }
  if (credentials.organization) {
    headers['bigmodel-organization'] = credentials.organization
  }
  if (credentials.project) {
    headers['bigmodel-project'] = credentials.project
  }

  const response = await fetchFn(createZhipuTeamQuotaUrl(), withTimeout({
    method: 'GET',
    headers,
  }))
  const responseText = await response.text()
  if (!response.ok) {
    return { error: `智谱 Coding Plan 团队版额度查询失败: HTTP ${response.status}` }
  }

  try {
    return JSON.parse(responseText) as ZhipuQuotaResponse
  } catch {
    return { error: '智谱 Coding Plan 团队版额度响应格式错误' }
  }
}

async function testZhipuCodingTeam(
  apiKey: string,
  baseUrl: string,
  proxyUrl?: string,
): Promise<ChannelTestResult> {
  const teamCredentials = parseZhipuTeamCredentials(apiKey)
  if (teamCredentials) {
    const response = await fetchZhipuTeamQuota(teamCredentials, proxyUrl)
    if ('error' in response) {
      return { success: false, message: response.error }
    }
    const quotaResult = parseZhipuQuotaData(response, 'GLM Coding Plan 团队版', 'zhipu-coding-team')
    if (!quotaResult.supported || quotaResult.windows.length === 0) {
      return {
        success: false,
        message: quotaResult.message || '智谱 Coding Plan 团队版未返回窗口额度数据',
      }
    }
    return { success: true, message: '智谱 Coding Plan 团队版额度查询成功' }
  }

  const authToken = extractZhipuCodingTeamApiToken(apiKey)
  if (!authToken) {
    return {
      success: false,
      message: '请填写 API Token；组织 ID 和项目 ID 可选',
    }
  }

  return await testAnthropicCompatible(baseUrl, apiKey, proxyUrl, 'zhipu-coding-team')
}

function parseZhipuQuotaData(
  data: ZhipuQuotaResponse,
  planName: string,
  provider: ProviderType = 'zhipu-coding',
): ChannelPlanQuotaResult {
  if (!data.success || data.code !== 200) {
    return createUnsupportedPlanQuota(provider, data.msg || '智谱 Coding Plan 额度查询失败')
  }

  const limits = data.data?.limits ?? []
  const windows: ChannelPlanQuotaWindow[] = []
  const tokenLimits = limits
    .filter((item) => item.type === 'TOKENS_LIMIT')
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftReset = normalizePlanQuotaTimestamp(left.item.nextResetTime)
      const rightReset = normalizePlanQuotaTimestamp(right.item.nextResetTime)
      if (leftReset && rightReset && leftReset !== rightReset) {
        return leftReset - rightReset
      }
      return left.index - right.index
    })

  for (const { item, index } of tokenLimits) {
    const used = clampPercent(item.percentage ?? 0)
    const type = item.unit === 3
      ? '5h'
      : item.unit === 6
        ? 'weekly'
        : item.unit == null && index === 0
          ? '5h'
          : item.unit == null && index === 1
            ? 'weekly'
            : undefined
    if (!type) continue
    windows.push({
      type,
      label: type === '5h' ? '每 5 小时' : '每周额度',
      remainingPercent: clampPercent(100 - used),
      usedPercent: used,
      ...planQuotaResetAt(item.nextResetTime),
    })
  }

  const timeLimit = limits.find((item) => item.type === 'TIME_LIMIT')
  if (timeLimit) {
    const remainingCount = Number(timeLimit.remaining ?? 0)
    const totalCount = Number(timeLimit.usage ?? 0)
    const usedCount = Number(timeLimit.currentValue ?? (totalCount > 0 ? totalCount - remainingCount : 0))
    const total = totalCount > 0 ? totalCount : remainingCount + usedCount
    const remainingPercent = total > 0 ? (remainingCount / total) * 100 : 0
    windows.push({
      type: 'custom',
      label: 'MCP 每月',
      remainingPercent: clampPercent(remainingPercent),
      usedPercent: clampPercent(100 - remainingPercent),
    })
  }

  if (windows.length === 0) {
    return createUnsupportedPlanQuota(provider, '智谱 Coding Plan 未返回窗口额度数据')
  }

  return {
    supported: true,
    provider,
    planName,
    windows,
    updatedAt: Date.now(),
  }
}

async function queryZhipuPlanQuota(
  apiKey: string,
  baseUrl: string,
  proxyUrl?: string,
  provider: ProviderType = 'zhipu-coding',
): Promise<ChannelPlanQuotaResult> {
  if (provider === 'zhipu-coding-team') {
    const teamCredentials = parseZhipuTeamCredentials(apiKey)
    if (!teamCredentials) {
      return createUnsupportedPlanQuota(
        'zhipu-coding-team',
        '请填写 API Token；组织 ID 和项目 ID 可选',
      )
    }
    const teamResponse = await fetchZhipuTeamQuota(teamCredentials, proxyUrl)
    if ('error' in teamResponse) {
      return createUnsupportedPlanQuota('zhipu-coding-team', teamResponse.error)
    }
    return parseZhipuQuotaData(teamResponse, 'GLM Coding Plan 团队版', 'zhipu-coding-team')
  }

  const requestUrls = Array.from(new Set([
    createZhipuQuotaUrl(baseUrl),
    createZhipuQuotaUrl(baseUrl, { type: '1' }),
    createZhipuInternationalQuotaUrl(),
    createZhipuInternationalQuotaUrl({ type: '1' }),
  ]))

  let lastUnsupported: ChannelPlanQuotaResult | undefined
  for (const requestUrl of requestUrls) {
    const response = await fetchZhipuQuota(apiKey, requestUrl, proxyUrl)
    if ('error' in response) {
      lastUnsupported = createUnsupportedPlanQuota(provider, response.error)
      continue
    }

    const result = parseZhipuQuotaData(response, 'GLM Coding Plan', provider)
    if (result.supported && result.windows.length > 0) {
      return result
    }
    lastUnsupported = result
  }

  return lastUnsupported ?? createUnsupportedPlanQuota(provider, '智谱 Coding Plan 未返回窗口额度数据')
}

export async function getChannelPlanQuota(channelId: string): Promise<ChannelPlanQuotaResult> {
  const channel = getChannelById(channelId)
  if (!channel) {
    return createUnsupportedPlanQuota('custom', '渠道不存在')
  }

  let provider: ProviderType
  try {
    provider = inferProviderFromBaseUrl(channel.provider, channel.baseUrl)
  } catch {
    provider = channel.provider
  }
  const proxyUrl = await getEffectiveProxyUrl()
  let apiKey: string
  try {
    apiKey = decryptKey(channel.apiKey)
  } catch {
    return createUnsupportedPlanQuota(provider, '无法读取渠道 API Key')
  }

  try {
    if (provider === 'openai-codex') {
      return await queryCodexPlanQuota(channelId, apiKey, proxyUrl)
    }
    if (provider === 'deepseek') {
      return await queryDeepSeekBalance(apiKey, channel.baseUrl, proxyUrl)
    }
    if (provider === 'kimi-coding' || channel.baseUrl.includes('api.kimi.com/coding')) {
      return await queryKimiPlanQuota(apiKey, proxyUrl)
    }
    if (provider === 'minimax') {
      return await queryMiniMaxPlanQuota(apiKey, channel.baseUrl, proxyUrl)
    }
    if (provider === 'zhipu' || provider === 'zhipu-coding' || provider === 'zhipu-coding-team') {
      return await queryZhipuPlanQuota(apiKey, channel.baseUrl, proxyUrl, provider)
    }
    return createUnsupportedPlanQuota(provider, '当前渠道不支持订阅 Plan 额度查询')
  } catch (error) {
    const message = error instanceof Error ? error.message : '订阅额度查询失败'
    return createUnsupportedPlanQuota(provider, message)
  }
}

// ===== 直接测试连接 =====

/**
 * 直接测试连接（无需已保存渠道）
 *
 * 使用传入的明文凭证直接向提供商发送测试请求。
 * 适用于创建/编辑渠道时用户在保存前先验证连接。
 */
export async function testChannelDirect(input: ChannelDirectTestInput): Promise<ChannelTestResult> {
  const proxyUrl = await getEffectiveProxyUrl()
  const provider = inferProviderFromBaseUrl(input.provider, input.baseUrl)

  try {
    switch (provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'zhipu-coding-team':
      case 'ark-coding-plan':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
        if (provider === 'deepseek') {
          return await testDeepSeekMessages(
            input.baseUrl,
            input.apiKey,
            resolveDeepSeekTestModelId(input.modelId),
            proxyUrl,
          )
        }
        if (provider === 'kimi-api') {
          return await testKimiMessages(
            input.baseUrl,
            input.apiKey,
            resolveKimiTestModelId(input.modelId),
            proxyUrl,
          )
        }
        if (provider === 'xiaomi') {
          return await testXiaomiMessages(
            input.baseUrl,
            input.apiKey,
            resolveXiaomiTestModelId(input.modelId),
            'xiaomi',
            proxyUrl,
          )
        }
        if (provider === 'xiaomi-token-plan') {
          return await testXiaomiMessages(
            input.baseUrl,
            input.apiKey,
            resolveXiaomiTestModelId(input.modelId),
            'xiaomi-token-plan',
            proxyUrl,
          )
        }
        if (provider === 'ark-coding-plan') {
          return await testArkCodingPlan(input.baseUrl, input.apiKey, proxyUrl)
        }
        if (provider === 'zhipu-coding-team') {
          return await testZhipuCodingTeam(input.apiKey, input.baseUrl, proxyUrl)
        }
        return await testAnthropicCompatible(input.baseUrl, input.apiKey, proxyUrl, provider)
      case 'openai':
      case 'openai-responses':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(input.baseUrl, input.apiKey, proxyUrl, provider)
      case 'google':
        return await testGoogle(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的提供商: ${provider}` }
    }
  } catch (error) {
    return normalizeRequestError(error)
  }
}

// ===== 模型拉取相关 =====

/**
 * 从供应商 API 拉取可用模型列表
 *
 * 直接使用传入的凭证（无需已保存渠道），支持创建渠道时预先拉取模型。
 * 针对不同供应商使用不同的 API 端点和响应解析。
 */
export async function fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  const proxyUrl = await getEffectiveProxyUrl()
  const provider = inferProviderFromBaseUrl(input.provider, input.baseUrl)

  try {
    switch (provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'zhipu-coding-team':
      case 'ark-coding-plan':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
      case 'openai-codex':
        if (provider === 'openai-codex') {
          // ChatGPT (Codex) 走 Pi SDK 内置模型目录，不依赖 baseUrl/apiKey。
          const codexModels = await listCodexModels()
          return {
            success: true,
            message: `已加载 ${codexModels.length} 个 ChatGPT (Codex) 模型`,
            models: codexModels.map((m) => ({ id: m.id, name: m.name, enabled: true, source: 'fetched' as const })),
          }
        }
        if (provider === 'deepseek') {
          return await fetchDeepSeekModels(input.baseUrl, input.apiKey, proxyUrl)
        }
        if (provider === 'kimi-api') {
          return await fetchKimiModels(input.baseUrl, input.apiKey, proxyUrl)
        }
        if (provider === 'xiaomi') {
          return createPresetModelsResult('小米 API', XIAOMI_PRESET_MODELS)
        }
        if (provider === 'xiaomi-token-plan') {
          return createPresetModelsResult('小米 Token Plan', XIAOMI_PRESET_MODELS)
        }
        if (provider === 'ark-coding-plan') {
          return {
            success: true,
            message: `火山方舟 Coding Plan 未开放模型列表端点，已加载 ${ARK_CODING_PLAN_MODELS.length} 个预设模型`,
            models: ARK_CODING_PLAN_MODELS,
          }
        }
        return await fetchAnthropicCompatibleModels(input.baseUrl, input.apiKey, proxyUrl, provider)
      case 'openai':
      case 'openai-responses':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await fetchOpenAICompatibleModels(input.baseUrl, input.apiKey, proxyUrl, provider)
      case 'google':
        return await fetchGoogleModels(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${provider}`, models: [] }
    }
  } catch (error) {
    console.error('[渠道管理] 拉取模型列表失败:', error)
    const result = normalizeRequestError(error)
    return { success: false, message: result.message, models: [] }
  }
}

/**
 * 从 DeepSeek 原生模型 API 拉取模型列表。
 *
 * DeepSeek 的 Anthropic 对话端点是 /anthropic/v1/messages，但模型列表端点固定在 /models。
 */
async function fetchDeepSeekModels(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<FetchModelsResult> {
  const url = resolveDeepSeekModelsUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  }))

  if (!response.ok) {
    const result = await normalizeHttpResponse(response)
    return { success: false, message: result.message, models: [] }
  }

  const data = await response.json() as { data?: OpenAIModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.id,
    enabled: true,
  }))

  models.sort((a, b) => a.id.localeCompare(b.id))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * 从 Kimi OpenAI-compatible 模型列表端点拉取模型。
 *
 * Kimi 的 Anthropic 对话端点保留 /anthropic/v1/messages；模型列表使用官方 /v1/models。
 */
async function fetchKimiModels(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<FetchModelsResult> {
  const url = resolveKimiModelsUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  }))

  if (!response.ok) {
    const result = await normalizeHttpResponse(response)
    return { success: false, message: result.message, models: [] }
  }

  const data = await response.json() as { data?: OpenAIModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.id,
    enabled: true,
  }))

  models.sort((a, b) => a.id.localeCompare(b.id))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * Anthropic API 模型响应项
 */
interface AnthropicModelItem {
  id: string
  display_name?: string
  type?: string
}

/**
 * 从 Anthropic 兼容 API 拉取模型列表（Anthropic / DeepSeek / Kimi API / Kimi Coding Plan / MiniMax）
 *
 * DeepSeek / Kimi 等内置供应商会按协议根路径补全模型端点。
 * Anthropic 兼容格式使用完整请求地址，不再推导模型端点。
 * Coding Plan 渠道必须发送 Proma User-Agent。
 * 文档: https://docs.anthropic.com/en/api/models-list
 */
async function fetchAnthropicCompatibleModels(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  provider: ProviderType = 'anthropic',
): Promise<FetchModelsResult> {
  const url = resolveAnthropicModelsUrl(baseUrl, provider)
  const fetchFn = getFetchFn(proxyUrl)

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  }
  if (provider === 'kimi-coding' || provider === 'zhipu-coding' || provider === 'zhipu-coding-team') {
    const authToken = provider === 'zhipu-coding-team' ? extractZhipuCodingTeamApiToken(apiKey) : apiKey
    headers.Authorization = `Bearer ${authToken}`
    headers['User-Agent'] = getPromaUserAgent(pkg.version)
  } else if (provider === 'xiaomi-token-plan') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['User-Agent'] = getPromaUserAgent(pkg.version)
  } else if (provider === 'minimax' || provider === 'qwen-anthropic') {
    headers.Authorization = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers,
  }))

  if (!response.ok) {
    const result = await normalizeHttpResponse(response)
    return { success: false, message: result.message, models: [] }
  }

  const data = await response.json() as { data?: AnthropicModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.display_name || item.id,
    enabled: true,
  }))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * OpenAI 兼容 API 模型响应项
 */
interface OpenAIModelItem {
  id: string
  owned_by?: string
}

/**
 * 从 OpenAI 兼容 API 拉取模型列表（OpenAI / Custom）
 *
 * API: GET {baseUrl}/models
 * 通用 OpenAI 兼容格式，适用于大部分第三方供应商。
 */
async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  provider: ProviderType = 'openai',
): Promise<FetchModelsResult> {
  const url = resolveOpenAIModelsUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(url, withTimeout({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }))

  if (!response.ok) {
    const result = await normalizeHttpResponse(response)
    return { success: false, message: result.message, models: [] }
  }

  const data = await response.json() as { data?: OpenAIModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items.map((item) => ({
    id: item.id,
    name: item.id,
    enabled: true,
  }))

  // 按模型 ID 字母排序，方便用户查找
  models.sort((a, b) => a.id.localeCompare(b.id))

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}

/**
 * Google Generative AI 模型响应项
 */
interface GoogleModelItem {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

/**
 * 从 Google Generative AI API 拉取模型列表
 *
 * API: GET /v1beta/models?key={apiKey}
 * 仅返回支持 generateContent 的模型（排除纯 embedding 模型）。
 */
async function fetchGoogleModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, withTimeout({
    method: 'GET',
  }))

  if (!response.ok) {
    const result = await normalizeHttpResponse(response)
    return { success: false, message: result.message, models: [] }
  }

  const data = await response.json() as { models?: GoogleModelItem[] }
  const items = data.models ?? []

  // 过滤出支持 generateContent 的模型（排除纯 embedding 模型）
  const chatModels = items.filter((item) =>
    item.supportedGenerationMethods?.includes('generateContent')
  )

  const models: ChannelModel[] = chatModels.map((item) => {
    // Google 模型 name 格式为 "models/gemini-pro"，提取实际 ID
    const id = item.name.replace(/^models\//, '')
    return {
      id,
      name: item.displayName || id,
      enabled: true,
    }
  })

  return {
    success: true,
    message: `成功获取 ${models.length} 个模型`,
    models,
  }
}
