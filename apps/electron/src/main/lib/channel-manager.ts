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
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@proma/shared'
import { PROMA_OFFICIAL_CHANNEL_ID, PROVIDER_DEFAULT_URLS } from '@proma/shared'
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
const ARK_CODING_PLAN_TEST_MODEL = 'doubao-seed-2.0-code'
const DEEPSEEK_PRESET_MODELS: ChannelModel[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
]
const KIMI_PRESET_MODELS: ChannelModel[] = [
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
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', enabled: true },
  { id: 'minimax-m3', name: 'MiniMax M3', enabled: true },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
]

/**
 * 为连接测试 / 模型拉取请求统一附加超时信号。
 * 避免供应商不响应时请求无限挂起。
 */
function withTimeout(init: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(CHANNEL_TEST_TIMEOUT_MS) }
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
 * 同步 Proma 官方渠道
 *
 * - 若 proma-official 不存在 → 创建
 * - 若已存在 → 更新模型列表（保留用户对单个模型的 enabled 状态）
 */
export function syncOfficialChannel(models: ChannelModel[]): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID)

  if (index === -1) {
    // 创建官方渠道
    const channel: Channel = {
      id: PROMA_OFFICIAL_CHANNEL_ID,
      name: 'Proma 官方',
      provider: 'proma',
      baseUrl: '',
      apiKey: '',
      models,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    config.channels.push(channel)
    writeConfig(config)
    console.log(`[渠道管理] 已创建官方渠道，共 ${models.length} 个模型`)
  } else {
    // 更新模型：保留用户的 enabled 状态
    const existing = config.channels[index]!
    const enabledMap = new Map<string, boolean>()
    for (const m of existing.models) {
      enabledMap.set(m.id, m.enabled)
    }

    const updatedModels = models.map((m) => ({
      ...m,
      enabled: enabledMap.has(m.id) ? enabledMap.get(m.id)! : m.enabled,
    }))

    config.channels[index] = {
      ...existing,
      models: updatedModels,
      updatedAt: Date.now(),
    } as Channel
    writeConfig(config)
    console.log(`[渠道管理] 已更新官方渠道模型，共 ${updatedModels.length} 个`)
  }
}

/**
 * 同步 Proma 官方渠道的 Agent 专用模型列表
 *
 * 仅更新 proma-official 的 agentModels 字段，保留用户 enabled 状态。
 * 若渠道不存在则静默跳过（等 syncOfficialChannel 先创建）。
 */
export function syncOfficialAgentModels(models: ChannelModel[]): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID)

  if (index === -1) {
    console.warn('[渠道管理] 官方渠道不存在，跳过 Agent 模型同步')
    return
  }

  const existing = config.channels[index]!
  const enabledMap = new Map<string, boolean>()
  for (const m of existing.agentModels ?? []) {
    enabledMap.set(m.id, m.enabled)
  }

  const updatedModels = models.map((m) => ({
    ...m,
    enabled: enabledMap.has(m.id) ? enabledMap.get(m.id)! : m.enabled,
  }))

  config.channels[index] = {
    ...existing,
    agentModels: updatedModels,
    updatedAt: Date.now(),
  } as Channel
  writeConfig(config)
  console.log(`[渠道管理] 已更新官方渠道 Agent 模型，共 ${updatedModels.length} 个`)
}

/**
 * 移除 Proma 官方渠道（登出时调用）
 */
export function removeOfficialChannel(): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID)
  if (index !== -1) {
    config.channels.splice(index, 1)
    writeConfig(config)
    console.log('[渠道管理] 已移除官方渠道')
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
  // 官方渠道不可删除
  if (id === PROMA_OFFICIAL_CHANNEL_ID) {
    throw new Error('Proma 官方渠道不可删除')
  }

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
      case 'proma':
        return { success: true, message: '官方渠道无需测试' }
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
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
        return await testAnthropicCompatible(channel.baseUrl, apiKey, proxyUrl, provider)
      case 'openai':
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
 * Kimi Coding Plan 必须发送 Proma User-Agent，否则返回 403。
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
  if (provider === 'kimi-coding' || provider === 'zhipu-coding') {
    headers.Authorization = `Bearer ${apiKey}`
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
    'api-key': apiKey,
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
      case 'proma':
        return { success: true, message: '官方渠道无需测试' }
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
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
        return await testAnthropicCompatible(input.baseUrl, input.apiKey, proxyUrl, provider)
      case 'openai':
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
      case 'proma':
        return { success: false, message: '官方渠道模型由服务端管理', models: [] }
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'ark-coding-plan':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
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
 * Kimi Coding Plan 必须发送 Proma User-Agent。
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
  if (provider === 'kimi-coding' || provider === 'zhipu-coding') {
    headers.Authorization = `Bearer ${apiKey}`
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
