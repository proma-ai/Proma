/**
 * Cloud 提示词下载服务（主进程）
 *
 * 从云端拉取用户私有提示词，逐条追加到本地系统提示词配置。
 * 这是一次性迁移功能，不做去重。
 */

import {
  createPromptsApi,
  isApiError,
} from '@proma/cloud'
import type { PromptsApi } from '@proma/cloud'
import type { DownloadCloudPromptsResult } from '@proma/shared'
import { getApiClient } from './cloud-auth-service'
import { createSystemPrompt } from './system-prompt-manager'

// ===== API 实例（延迟初始化） =====

let promptsApi: PromptsApi | null = null

function getPromptsApi(): PromptsApi {
  if (!promptsApi) {
    promptsApi = createPromptsApi(getApiClient())
  }
  return promptsApi
}

// ===== 公开 API =====

/** 下载云端私有提示词到本地 */
export async function downloadCloudPrompts(): Promise<DownloadCloudPromptsResult> {
  try {
    const response = await getPromptsApi().list()
    const { privatePrompts } = response

    if (privatePrompts.length === 0) {
      return { success: true, imported: 0 }
    }

    let imported = 0
    for (const prompt of privatePrompts) {
      createSystemPrompt({
        name: prompt.name,
        content: prompt.content,
      })
      imported++
    }

    console.log(`[Cloud 提示词] 已下载 ${imported} 条私有提示词到本地`)
    return { success: true, imported }
  } catch (error) {
    const message = isApiError(error) ? error.message : (error instanceof Error ? error.message : '未知错误')
    console.error('[Cloud 提示词] 下载失败:', message)
    return { success: false, imported: 0, error: message }
  }
}
