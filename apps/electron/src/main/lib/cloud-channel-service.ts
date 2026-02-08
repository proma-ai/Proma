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

/** 清除 system API key 缓存 */
function clearSystemKeyCache(): void {
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
    // baseUrl 类似 http://localhost:8000/api/v1，取根域名部分
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
      broadcastOfficialChannelUpdated()
      console.log(`[Cloud Channel] 官方渠道已同步，共 ${models.length} 个模型`)
    }

    // 拉取 Agent 专用模型
    await fetchAndSyncAgentModels()
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
    broadcastOfficialChannelUpdated()

    // 拉取 Agent 专用模型
    await fetchAndSyncAgentModels()

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
  broadcastOfficialChannelUpdated()
  console.log('[Cloud Channel] 官方渠道已移除')
}
