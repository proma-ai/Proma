/**
 * 模型列表 API（Cloud 后端）
 *
 * 端点：GET /models → CloudModelGroup[]
 */

import type { CloudApiClient } from './client'
import type { CloudModelGroup } from '@proma/shared'

/** 创建模型列表 API */
export function createModelsApi(client: CloudApiClient) {
  return {
    /** 获取服务端模型列表（按供应商分组） */
    getModels: async (): Promise<CloudModelGroup[]> => {
      const response = await client.get<CloudModelGroup[]>('/models')
      return response.data
    },
  }
}

/** Models API 实例类型 */
export type ModelsApi = ReturnType<typeof createModelsApi>
