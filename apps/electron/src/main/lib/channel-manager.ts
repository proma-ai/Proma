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
import { PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { normalizeAnthropicBaseUrl, normalizeBaseUrl } from '@proma/core'

/** 当前配置版本 */
const CONFIG_VERSION = 1

/**
 * 读取渠道配置文件
 */
function readConfig(): ChannelsConfig {
  const configPath = getChannelsPath()

  if (!existsSync(configPath)) {
    return { version: CONFIG_VERSION, channels: [] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as ChannelsConfig
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
 */
export function listChannels(): Channel[] {
  const config = readConfig()
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

  try {
    switch (channel.provider) {
      case 'proma':
        return { success: true, message: '官方渠道无需测试' }
      case 'anthropic':
        return await testAnthropic(channel.baseUrl, apiKey, proxyUrl)
      case 'openai':
      case 'deepseek':
      case 'moonshot':
      case 'zhipu':
      case 'minimax':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(channel.baseUrl, apiKey, proxyUrl)
      case 'google':
        return await testGoogle(channel.baseUrl, apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${channel.provider}。你可能过去使用的是 Proma 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `连接测试失败: ${message}` }
  }
}

/**
 * 测试 Anthropic API 连接
 */
async function testAnthropic(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<ChannelTestResult> {
  const url = normalizeAnthropicBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })

  if (response.ok) {
    return { success: true, message: '连接成功' }
  }

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}` }
  }

  // 如果能收到 API 的响应（即使是错误），说明连接是通的
  return { success: true, message: '连接成功' }
}

/**
 * 测试 OpenAI 兼容 API 连接（OpenAI / DeepSeek / Custom）
 */
async function testOpenAICompatible(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<ChannelTestResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (response.ok) {
    return { success: true, message: '连接成功' }
  }

  if (response.status === 401) {
    return { success: false, message: 'API Key 无效' }
  }

  const text = await response.text().catch(() => '')
  return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}` }
}

/**
 * 测试 Google Generative AI API 连接
 */
async function testGoogle(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<ChannelTestResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, {
    method: 'GET',
  })

  if (response.ok) {
    return { success: true, message: '连接成功' }
  }

  if (response.status === 400 || response.status === 403) {
    return { success: false, message: 'API Key 无效' }
  }

  const text = await response.text().catch(() => '')
  return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}` }
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
      case 'proma':
        return { success: true, message: '官方渠道无需测试' }
      case 'anthropic':
        return await testAnthropic(input.baseUrl, input.apiKey, proxyUrl)
      case 'openai':
      case 'deepseek':
      case 'moonshot':
      case 'zhipu':
      case 'minimax':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await testOpenAICompatible(input.baseUrl, input.apiKey, proxyUrl)
      case 'google':
        return await testGoogle(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的提供商: ${input.provider}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `连接测试失败: ${message}` }
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
      case 'proma':
        return { success: false, message: '官方渠道模型由服务端管理', models: [] }
      case 'anthropic':
        return await fetchAnthropicModels(input.baseUrl, input.apiKey, proxyUrl)
      case 'openai':
      case 'deepseek':
      case 'moonshot':
      case 'zhipu':
      case 'minimax':
      case 'doubao':
      case 'qwen':
      case 'custom':
        return await fetchOpenAICompatibleModels(input.baseUrl, input.apiKey, proxyUrl)
      case 'google':
        return await fetchGoogleModels(input.baseUrl, input.apiKey, proxyUrl)
      default:
        return { success: false, message: `不支持的供应商: ${input.provider}`, models: [] }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.error('[渠道管理] 拉取模型列表失败:', error)
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
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
 * 从 Anthropic API 拉取模型列表
 *
 * 先规范化 baseUrl 确保包含 /v1，再请求 /models。
 * 文档: https://docs.anthropic.com/en/api/models-list
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeAnthropicBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
  })

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}`, models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
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
 * 从 OpenAI 兼容 API 拉取模型列表（OpenAI / DeepSeek / Custom）
 *
 * API: GET {baseUrl}/models
 * 通用 OpenAI 兼容格式，适用于大部分第三方供应商。
 */
async function fetchOpenAICompatibleModels(baseUrl: string, apiKey: string, proxyUrl?: string): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const response = await fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (response.status === 401) {
    return { success: false, message: 'API Key 无效', models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
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

  const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, {
    method: 'GET',
  })

  if (response.status === 400 || response.status === 403) {
    return { success: false, message: 'API Key 无效', models: [] }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
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
