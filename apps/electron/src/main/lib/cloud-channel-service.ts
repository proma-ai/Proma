/**
 * Cloud 官方渠道管理服务（主进程）
 *
 * 负责：
 * - 登录后从 /models 拉取模型列表，创建/更新 proma-official 渠道
 * - 登出时移除官方渠道
 * - 广播渠道更新到渲染进程
 */

import { BrowserWindow } from 'electron'
import {
  createModelsApi,
  createApiKeysApi,
  isApiError,
  getCloudApiConfig,
} from '@proma/cloud'
import type { ModelsApi, ApiKeysApi } from '@proma/cloud'
import type { ChannelModel, BillingIpcResponse, CloudModelGroup } from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import { getApiClient } from './cloud-auth-service'
import { syncOfficialChannel, removeOfficialChannel, syncOfficialAgentModels } from './channel-manager'
import { getRawChatToolsConfig, updateToolCredentials, updateToolState } from './chat-tool-config'

// ===== API 实例（延迟初始化） =====

let modelsApi: ModelsApi | null = null

function getModelsApi(): ModelsApi {
  if (!modelsApi) {
    modelsApi = createModelsApi(getApiClient())
  }
  return modelsApi
}

let apiKeysApi: ApiKeysApi | null = null

function getApiKeysApi(): ApiKeysApi {
  if (!apiKeysApi) {
    apiKeysApi = createApiKeysApi(getApiClient())
  }
  return apiKeysApi
}

// ===== System API Key 缓存（Agent SDK 使用） =====

/** 缓存有效期：1 小时（与 proma-frontend ApiKeyService 一致） */
const SYSTEM_KEY_CACHE_DURATION = 60 * 60 * 1000

interface SystemKeyCache {
  key: string
  fetchedAt: number
}

let cachedSystemKey: SystemKeyCache | null = null

/**
 * 获取 system API key（pk_xxx 格式）
 *
 * Agent SDK 通过此 key 走后端代理请求 Anthropic 并完成计费。
 * 结果缓存 1 小时，API client 内置 401 token 刷新机制。
 */
export async function getSystemApiKey(): Promise<string> {
  if (cachedSystemKey && Date.now() - cachedSystemKey.fetchedAt < SYSTEM_KEY_CACHE_DURATION) {
    return cachedSystemKey.key
  }

  const result = await getApiKeysApi().getSystemApiKey()
  cachedSystemKey = { key: result.key, fetchedAt: Date.now() }
  console.log('[Cloud Channel] System API Key 已获取并缓存')
  return result.key
}

/** 清除 system API key 缓存（token 刷新后调用，强制重新获取） */
export function clearSystemKeyCache(): void {
  cachedSystemKey = null
}

// ===== 模型转换 =====

/**
 * 将 Cloud 模型分组转换为 ChannelModel 列表
 *
 * 展平所有分组中的模型，使用 CloudModelConfig.id 作为 ChannelModel.id。
 */
function flattenModels(groups: CloudModelGroup[]): ChannelModel[] {
  const models: ChannelModel[] = []
  for (const group of groups) {
    for (const model of group.models) {
      models.push({
        id: model.id,
        name: model.name,
        enabled: true,
      })
    }
  }
  return models
}

// ===== 广播 =====

function broadcastOfficialChannelUpdated(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED)
  })
}

// ===== Agent 模型拉取 =====

/** /v1/agent_models 响应项 */
interface AgentModelItem {
  id: string
  display_name?: string
}

/**
 * 从 Proma 后端拉取 Agent 专用模型列表
 *
 * 请求 {rootUrl}/v1/agent_models（公开端点，无需认证），
 * 同步到官方渠道的 agentModels 字段。
 */
export async function fetchAndSyncAgentModels(): Promise<void> {
  try {
    const config = getCloudApiConfig()
    // baseUrl 类似 https://api.proma.cool/api/v1，取根域名部分
    const rootUrl = config.baseUrl.replace(/\/api\/v\d+$/, '')

    const response = await fetch(`${rootUrl}/v1/agent_models`, {
      method: 'GET',
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.warn(`[Cloud Channel] Agent 模型拉取失败 (${response.status}): ${text.slice(0, 200)}`)
      return
    }

    const data = await response.json() as { data?: AgentModelItem[] }
    const items = data.data ?? []

    const models: ChannelModel[] = items.map((item) => ({
      id: item.id,
      name: item.display_name || item.id,
      enabled: true,
    }))

    if (models.length > 0) {
      syncOfficialAgentModels(models)
      console.log(`[Cloud Channel] Agent 模型已同步，共 ${models.length} 个`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.warn('[Cloud Channel] Agent 模型拉取失败:', message)
  }
}

// ===== 公开 API =====

/**
 * 初始化官方渠道
 *
 * 从 Cloud 后端拉取模型列表，创建或更新 proma-official 渠道。
 * 认证失败时静默跳过。
 */
export async function initOfficialChannel(): Promise<void> {
  try {
    const groups = await getModelsApi().getModels()
    const models = flattenModels(groups)

    if (models.length > 0) {
      syncOfficialChannel(models)
      console.log(`[Cloud Channel] 官方渠道已同步，共 ${models.length} 个模型`)
    }

    // 拉取 Agent 专用模型
    await fetchAndSyncAgentModels()

    // 同步云端工具默认配置
    syncCloudToolDefaults()

    // 所有同步完成后广播，保证渲染进程刷新时读到的是最新数据
    if (models.length > 0) {
      broadcastOfficialChannelUpdated()
    }
  } catch (error) {
    // 未认证或网络错误时静默跳过
    const message = isApiError(error) ? error.message : (error instanceof Error ? error.message : '未知错误')
    console.warn('[Cloud Channel] 初始化官方渠道失败:', message)
  }
}

/**
 * 刷新官方渠道模型列表
 *
 * 由 IPC handler 或登录后触发。
 */
export async function refreshOfficialModels(): Promise<BillingIpcResponse<void>> {
  try {
    const groups = await getModelsApi().getModels()
    const models = flattenModels(groups)

    syncOfficialChannel(models)

    // 拉取 Agent 专用模型
    await fetchAndSyncAgentModels()

    // 所有同步完成后再广播，确保渲染进程刷新时能读到最新 agentModels
    broadcastOfficialChannelUpdated()

    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : (error instanceof Error ? error.message : '未知错误')
    return { success: false, error: message }
  }
}

/**
 * 清理官方渠道（登出时调用）
 */
export function cleanupOfficialChannel(): void {
  removeOfficialChannel()
  clearSystemKeyCache()
  // 清理云端工具凭据
  updateToolCredentials('web-search', {})
  updateToolCredentials('nano-banana', {})
  broadcastOfficialChannelUpdated()
  console.log('[Cloud Channel] 官方渠道已移除')
}

// ===== 云端工具默认配置 =====

/** 需要自动配置的云端内置工具 */
const CLOUD_TOOLS = ['web-search', 'nano-banana', 'gpt-image-2'] as const

/**
 * 同步云端工具默认配置
 *
 * 首次激活时自动 enable 工具；之后尊重用户手动关闭的设置。
 * 写入 cloudMode 标志，保留用户已设置的 useCloud / model 偏好。
 */
function syncCloudToolDefaults(): void {
  const rawConfig = getRawChatToolsConfig()

  for (const toolId of CLOUD_TOOLS) {
    // 若 toolStates 中不存在该 key → 首次激活，自动 enable
    if (!rawConfig.toolStates || !(toolId in rawConfig.toolStates)) {
      updateToolState(toolId, { enabled: true })
      console.log(`[Cloud Channel] 工具首次激活，已自动开启: ${toolId}`)
    }
  }

  // 写入云端凭据：保留已有的 useCloud / model / apiKey 偏好
  const existingWs = rawConfig.toolCredentials?.['web-search'] ?? {}
  updateToolCredentials('web-search', {
    ...existingWs,
    cloudMode: 'true',
    useCloud: existingWs.useCloud ?? 'true',
  })

  const existingNb = rawConfig.toolCredentials?.['nano-banana'] ?? {}
  updateToolCredentials('nano-banana', {
    ...existingNb,
    cloudMode: 'true',
    model: existingNb.model || 'gemini-3.1-flash-image-preview',
    useCloud: existingNb.useCloud ?? 'true',
  })

  // [Proma Cloud] GPT Image 2（仅云端，无需 model / apiKey）
  const existingGpt = rawConfig.toolCredentials?.['gpt-image-2'] ?? {}
  updateToolCredentials('gpt-image-2', {
    ...existingGpt,
    cloudMode: 'true',
    useCloud: existingGpt.useCloud ?? 'true',
  })

  console.log('[Cloud Channel] 云端工具默认配置已同步')
}

// ===== 定时刷新官方模型列表 =====

const MODELS_POLL_INTERVAL = 20 * 60 * 1000 // 20 分钟

let modelsPollTimer: NodeJS.Timeout | null = null

async function pollOfficialModels(): Promise<void> {
  try {
    await refreshOfficialModels()
    console.log('[Cloud Channel] 定时刷新官方模型列表成功')
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.warn('[Cloud Channel] 定时刷新官方模型列表失败:', message)
  }
}

/** 启动模型列表定时轮询（每 20 分钟） */
export function startModelsPolling(): void {
  if (modelsPollTimer) return
  pollOfficialModels()
  modelsPollTimer = setInterval(() => { pollOfficialModels() }, MODELS_POLL_INTERVAL)
  console.log('[Cloud Channel] 官方模型定时轮询已启动（间隔 20 分钟）')
}

/** 停止模型列表定时轮询 */
export function stopModelsPolling(): void {
  if (modelsPollTimer) {
    clearInterval(modelsPollTimer)
    modelsPollTimer = null
    console.log('[Cloud Channel] 官方模型定时轮询已停止')
  }
}
