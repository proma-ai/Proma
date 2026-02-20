/**
 * Cloud 提示词接口
 *
 * 提供云端提示词列表查询（用于一次性下载迁移到本地）。
 */

import type { CloudApiClient } from './client'
import type { CloudPromptsListResponse } from '@proma/shared'

/** 创建 Prompts API */
export function createPromptsApi(client: CloudApiClient) {
  return {
    /** 获取云端提示词列表 */
    list: async (): Promise<CloudPromptsListResponse> => {
      const response = await client.get<CloudPromptsListResponse>('/prompts')
      return response.data
    },
  }
}

/** Prompts API 实例类型 */
export type PromptsApi = ReturnType<typeof createPromptsApi>
