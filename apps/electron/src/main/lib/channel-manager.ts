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
  ChannelModel,
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@proma/shared'
import { PROVIDER_DEFAULT_URLS } from '@proma/shared'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import {
  getPromaUserAgent,
  migrateCompatibleChannelBaseUrl,
  normalizeBaseUrl,
  resolveAnthropicMessagesUrl,
  resolveAnthropicModelsUrl,
  resolveOpenAIChatCompletionsUrl,
  resolveOpenAIModelsUrl,
} from '@proma/core'
import { normalizeHttpResponse, normalizeRequestError } from './channel-test-error'
import pkg from '../../../package.json' with { type: 'json' }

/** 当前配置版本 */
const CONFIG_VERSION = 2
/** 连接测试 / 模型拉取的统一超时时间 */
const CHANNEL_TEST_TIMEOUT_MS = 15_000

/**
 * 为连接测试 / 模型拉取请求统一附加超时信号。
 * 避免供应商不响应时请求无限挂起。
 */
function withTimeout(init: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(CHANNEL_TEST_TIMEOUT_MS) }
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
      models: [
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
      ],
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

  try {
    switch (channel.provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
        return await testAnthropicCompatible(channel.baseUrl, apiKey, proxyUrl, channel.provider)
      case 'openai':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(channel.baseUrl, apiKey, proxyUrl, channel.provider)
      case 'google':
        return await testGoogle(channel.baseUrl, apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${channel.provider}。你可能过去使用的是 Proma 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。` }
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
  const url = resolveAnthropicMessagesUrl(baseUrl, provider)
  const fetchFn = getFetchFn(proxyUrl)

  let testModel: string
  switch (provider) {
    case 'deepseek':
      testModel = 'deepseek-v4-pro'
      break
    case 'kimi-api':
      testModel = 'kimi-k2.6'
      break
    case 'kimi-coding':
      testModel = 'kimi-for-coding'
      break
    case 'zhipu-coding':
      testModel = 'glm-5.2'
      break
    case 'minimax':
      testModel = 'MiniMax-M3'
      break
    case 'xiaomi':
    case 'xiaomi-token-plan':
      testModel = 'mimo-v2.5-pro'
      break
    case 'qwen-anthropic':
      testModel = 'qwen3.7-plus'
      break
    default:
      testModel = 'claude-sonnet-4-6'
  }

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
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
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: testModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
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
  if (provider === 'custom') {
    const url = resolveOpenAIChatCompletionsUrl(baseUrl, provider)
    const fetchFn = getFetchFn(proxyUrl)
    const response = await fetchFn(url, withTimeout({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    }))
    return normalizeHttpResponse(response)
  }

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
export async function testChannelDirect(input: FetchModelsInput): Promise<ChannelTestResult> {
  const proxyUrl = await getEffectiveProxyUrl()

  try {
    switch (input.provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
        return await testAnthropicCompatible(input.baseUrl, input.apiKey, proxyUrl, input.provider)
      case 'openai':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(input.baseUrl, input.apiKey, proxyUrl, input.provider)
      case 'google':
        return await testGoogle(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的提供商: ${input.provider}` }
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

  try {
    switch (input.provider) {
      case 'anthropic':
      case 'anthropic-compatible':
      case 'deepseek':
      case 'kimi-api':
      case 'kimi-coding':
      case 'zhipu-coding':
      case 'minimax':
      case 'xiaomi':
      case 'xiaomi-token-plan':
      case 'qwen-anthropic':
        return await fetchAnthropicCompatibleModels(input.baseUrl, input.apiKey, proxyUrl, input.provider)
      case 'openai':
      case 'zhipu':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await fetchOpenAICompatibleModels(input.baseUrl, input.apiKey, proxyUrl, input.provider)
      case 'google':
        return await fetchGoogleModels(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${input.provider}`, models: [] }
    }
  } catch (error) {
    console.error('[渠道管理] 拉取模型列表失败:', error)
    const result = normalizeRequestError(error)
    return { success: false, message: result.message, models: [] }
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
  if (provider === 'anthropic-compatible') {
    return { success: false, message: 'Anthropic 兼容格式使用完整请求地址，请手动添加模型', models: [] }
  }

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
  if (provider === 'custom') {
    return { success: false, message: 'OpenAI 兼容格式使用完整请求地址，请手动添加模型', models: [] }
  }

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
