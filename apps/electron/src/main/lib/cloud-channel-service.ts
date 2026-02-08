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
  isApiError,
} from '@proma/cloud'
import type { ModelsApi } from '@proma/cloud'
import type { ChannelModel, BillingIpcResponse, CloudModelGroup } from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import { getApiClient } from './cloud-auth-service'
import { syncOfficialChannel, removeOfficialChannel } from './channel-manager'

// ===== API 实例（延迟初始化） =====

let modelsApi: ModelsApi | null = null

function getModelsApi(): ModelsApi {
  if (!modelsApi) {
    modelsApi = createModelsApi(getApiClient())
  }
  return modelsApi
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
  broadcastOfficialChannelUpdated()
  console.log('[Cloud Channel] 官方渠道已移除')
}
