/**
 * Cloud 官方渠道管理服务（主进程）
 *
 * 负责：
 * - 登录、定时与选择器打开时条件拉取统一目录快照，创建/更新 proma-official 渠道
 * - 登出时移除官方渠道
 * - 广播渠道更新到渲染进程
 */

import { BrowserWindow } from 'electron'
import {
  createApiKeysApi,
  isApiError,
  getCloudApiConfig,
} from '@proma/cloud'
import type { ApiKeysApi } from '@proma/cloud'
import type { ChannelModel, BillingIpcResponse, CloudModelGroup } from '@proma/shared'
import { CLOUD_IPC_CHANNELS, PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import { getApiClient } from './cloud-auth-service'
import { listChannels, removeOfficialChannel, syncOfficialModelCatalog } from './channel-manager'
import { getRawChatToolsConfig, updateToolCredentials, updateToolState } from './chat-tool-config'
import { AsyncTtlCache } from './async-ttl-cache'

// ===== API 实例（延迟初始化） =====

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

function getModelListHint(metadata: CloudModelGroup['models'][number]['metadata']): string | undefined {
  const hint = metadata?.modelListHint
  return typeof hint === 'string' && hint.trim() ? hint.trim() : undefined
}

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
    .map(({ model }) => {
      const modelListHint = getModelListHint(model.metadata)
      return {
        id: model.id,
        name: model.name,
        enabled: true,
        ...(modelListHint ? { modelListHint } : {}),
      }
    })
}

// ===== 广播 =====

function broadcastOfficialChannelUpdated(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED)
  })
}

// ===== 官方目录快照拉取 =====

interface AgentModelItem {
  id: string
  display_name?: string
  apiProtocol?: 'anthropic-messages' | 'openai-responses'
  runtime?: 'both' | 'pi'
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  modelListHint?: string
}

interface OfficialModelCatalogSnapshot {
  chat: CloudModelGroup[]
  agent: AgentModelItem[]
}

export interface OfficialModelCatalogRefreshResult {
  changed: boolean
}

function mapAgentModels(items: AgentModelItem[]): ChannelModel[] {
  return items.map((item) => ({
    id: item.id,
    name: item.display_name || item.id,
    enabled: true,
    ...(item.apiProtocol ? { apiProtocol: item.apiProtocol } : {}),
    ...(item.contextWindow ? { contextWindow: item.contextWindow } : {}),
    ...(item.maxInputTokens ? { maxInputTokens: item.maxInputTokens } : {}),
    ...(item.maxOutputTokens ? { maxOutputTokens: item.maxOutputTokens } : {}),
    ...(typeof item.modelListHint === 'string' && item.modelListHint.trim()
      ? { modelListHint: item.modelListHint.trim() }
      : {}),
  }))
}

function getOfficialCatalogEtag(): string | undefined {
  return listChannels().find((channel) => channel.id === PROMA_OFFICIAL_CHANNEL_ID)?.officialCatalogEtag
}

/**
 * Revalidate the official catalog without disturbing the persisted list.
 * A successful 304 never writes config or broadcasts; a 200 atomically applies
 * Chat models, Agent models and the replacement ETag in one local write.
 */
async function fetchAndSyncOfficialModelCatalog(): Promise<boolean> {
  const config = getCloudApiConfig()
  const etag = getOfficialCatalogEtag()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeout)
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/model-catalog`, {
      method: 'GET',
      headers: etag ? { 'If-None-Match': etag } : undefined,
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('官方模型目录请求超时')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (response.status === 304) return false
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`官方模型目录拉取失败 (${response.status}): ${text.slice(0, 200)}`)
  }

  const snapshot = await response.json() as Partial<OfficialModelCatalogSnapshot>
  if (!Array.isArray(snapshot.chat) || !Array.isArray(snapshot.agent)) {
    throw new Error('官方模型目录响应格式无效')
  }
  const nextEtag = response.headers.get('etag')
  if (!nextEtag) {
    throw new Error('官方模型目录响应缺少 ETag')
  }

  const models = flattenModels(snapshot.chat)
  const agentModels = mapAgentModels(snapshot.agent)
  const changed = syncOfficialModelCatalog(models, agentModels, nextEtag)
  if (changed) {
    console.log(`[Cloud Channel] 官方模型目录已同步，Chat ${models.length} 个，Agent ${agentModels.length} 个`)
  }
  return changed
}

// 启动、登录刷新、定时轮询及选择器打开时的校验都可能重叠；用 single-flight
// 复用同一条件请求，避免一次用户操作触发多份重复的模型目录请求。
let officialChannelSync: Promise<boolean> | null = null

function syncOfficialChannelOnce(): Promise<boolean> {
  if (officialChannelSync) return officialChannelSync
  officialChannelSync = fetchAndSyncOfficialModelCatalog().finally(() => {
    officialChannelSync = null
  })
  return officialChannelSync
}

/** 初始化官方渠道；认证失败时静默保留已缓存的目录。 */
export async function initOfficialChannel(): Promise<void> {
  try {
    const changed = await syncOfficialChannelOnce()
    syncCloudToolDefaults()
    if (changed) broadcastOfficialChannelUpdated()
  } catch (error) {
    const message = isApiError(error) ? error.message : (error instanceof Error ? error.message : '未知错误')
    console.warn('[Cloud Channel] 初始化官方渠道失败:', message)
  }
}

/**
 * 静默刷新官方目录；调用方用 `changed` 决定是否读取新落盘的渠道配置。
 */
export async function refreshOfficialModels(): Promise<BillingIpcResponse<OfficialModelCatalogRefreshResult>> {
  try {
    const changed = await syncOfficialChannelOnce()
    if (changed) broadcastOfficialChannelUpdated()
    return { success: true, data: { changed } }
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
  const result = await refreshOfficialModels()
  if (result.success) {
    console.log(`[Cloud Channel] 定时校验官方模型目录完成（${result.data?.changed ? '已更新' : '无变化'}）`)
  } else {
    console.warn('[Cloud Channel] 定时校验官方模型目录失败:', result.error ?? '未知错误')
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
