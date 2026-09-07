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
import { AsyncTtlCache } from './async-ttl-cache'

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

const systemKeyCache = new AsyncTtlCache<string>(SYSTEM_KEY_CACHE_DURATION)

/**
 * 获取 system API key（pk_xxx 格式）
 *
 * Agent SDK 通过此 key 走后端代理请求 Anthropic 并完成计费。
 * 结果缓存 1 小时，API client 内置 401 token 刷新机制。
 */
export async function getSystemApiKey(): Promise<string> {
  return systemKeyCache.getOrLoad(async () => {
    const result = await getApiKeysApi().getSystemApiKey()
    console.log('[Cloud Channel] System API Key 已获取并缓存')
    return result.key
  })
}

/** 清除 system API key 缓存（token 刷新后调用，强制重新获取） */
export function clearSystemKeyCache(): void {
  systemKeyCache.invalidate()
}

// ===== 模型转换 =====

/**
 * Flatten provider groups into the global Chat picker order. The Cloud API
 * remains grouped for compatibility, so the client applies chatSortOrder here.
 */
function flattenModels(groups: CloudModelGroup[]): ChannelModel[] {
  const models = groups.flatMap((group, groupIndex) =>
    group.models.map((model, modelIndex) => ({
      model,
      // Older APIs omit chatSortOrder; preserve the original group order then.
      sourceIndex: groupIndex * 1_000_000 + modelIndex,
    })),
  )

  return models
    .sort((a, b) => {
      const aOrder = a.model.chatSortOrder
      const bOrder = b.model.chatSortOrder
      if (typeof aOrder === 'number' && typeof bOrder === 'number') {
        return aOrder - bOrder || a.model.id.localeCompare(b.model.id)
      }
      if (typeof aOrder === 'number') return -1
      if (typeof bOrder === 'number') return 1
      return a.sourceIndex - b.sourceIndex
    })
    .map(({ model }) => ({
      id: model.id,
      name: model.name,
      enabled: true,
    }))
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
  apiProtocol?: 'anthropic-messages' | 'openai-responses'
  runtime?: 'both' | 'pi'
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number
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
      ...(item.apiProtocol ? { apiProtocol: item.apiProtocol } : {}),
      ...(item.contextWindow ? { contextWindow: item.contextWindow } : {}),
      ...(item.maxInputTokens ? { maxInputTokens: item.maxInputTokens } : {}),
      ...(item.maxOutputTokens ? { maxOutputTokens: item.maxOutputTokens } : {}),
    }))

    // A successful empty response must clear stale local Agent models; only
    // transport or HTTP failures above retain the previous cached list.
    syncOfficialAgentModels(models)
    console.log(`[Cloud Channel] Agent 模型已同步，共 ${models.length} 个`)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.warn('[Cloud Channel] Agent 模型拉取失败:', message)
  }
}

// ===== 公开 API =====

// 启动、登录刷新和 20 分钟轮询可能在同一事件循环轮次重叠。它们必须
// 共用一次 models + agent_models 拉取，避免每个桌面端启动时成对请求。
let officialChannelSync: Promise<boolean> | null = null

function syncOfficialChannelOnce(): Promise<boolean> {
  if (officialChannelSync) return officialChannelSync
  officialChannelSync = (async () => {
    const groups = await getModelsApi().getModels()
    const models = flattenModels(groups)
    if (models.length > 0) {
      syncOfficialChannel(models)
      console.log(`[Cloud Channel] 官方渠道已同步，共 ${models.length} 个模型`)
    }
    await fetchAndSyncAgentModels()
    syncCloudToolDefaults()
    return models.length > 0
  })().finally(() => {
    officialChannelSync = null
  })
  return officialChannelSync
}

/** 初始化官方渠道；认证失败时静默跳过。 */
export async function initOfficialChannel(): Promise<void> {
  try {
    if (await syncOfficialChannelOnce()) broadcastOfficialChannelUpdated()
  } catch (error) {
    const message = isApiError(error) ? error.message : (error instanceof Error ? error.message : '未知错误')
    console.warn('[Cloud Channel] 初始化官方渠道失败:', message)
  }
}

/** 刷新官方渠道模型列表；与其他同步调用共享同一上游请求。 */
export async function refreshOfficialModels(): Promise<BillingIpcResponse<void>> {
  try {
    await syncOfficialChannelOnce()
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
  // 清理与当前 Cloud 登录态关联的 GPT Image 2 凭据。
  updateToolCredentials('gpt-image-2', {})
  broadcastOfficialChannelUpdated()
  console.log('[Cloud Channel] 官方渠道已移除')
}

// ===== 云端工具默认配置 =====

/** 需要自动配置的云端内置工具 */
const CLOUD_TOOLS = ['gpt-image-2'] as const

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

  // 写入 GPT Image 2 云端凭据：保留用户已有偏好。
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
