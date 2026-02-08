/**
 * API Keys 接口
 *
 * 提供用户 API Key 的 CRUD 操作，
 * 以及获取 system API key（pk_xxx 格式）用于 Agent SDK。
 */

import type { CloudApiClient } from './client'
import type {
  SystemApiKeyResponse,
  ApiKeyResponse,
  ApiKeyCreateResponse,
  ApiKeyCreateParams,
  ApiKeyUpdateParams,
} from '@proma/shared'

/** 创建 API Keys API */
export function createApiKeysApi(client: CloudApiClient) {
  return {
    /** 获取 system API key（pk_xxx 格式） */
    getSystemApiKey: async (): Promise<SystemApiKeyResponse> => {
      const response = await client.get<SystemApiKeyResponse>('/api-keys/system')
      return response.data
    },

    /** 获取用户的所有自定义 API Keys */
    list: async (): Promise<ApiKeyResponse[]> => {
      const response = await client.get<ApiKeyResponse[]>('/api-keys')
      return response.data
    },

    /** 创建新的 API Key */
    create: async (params: ApiKeyCreateParams): Promise<ApiKeyCreateResponse> => {
      const response = await client.post<ApiKeyCreateResponse>('/api-keys', params)
      return response.data
    },

    /** 更新 API Key */
    update: async (keyId: string, params: ApiKeyUpdateParams): Promise<ApiKeyResponse> => {
      const response = await client.patch<ApiKeyResponse>(`/api-keys/${keyId}`, params)
      return response.data
    },

    /** 删除 API Key */
    delete: async (keyId: string): Promise<void> => {
      await client.del(`/api-keys/${keyId}`)
    },
  }
}

/** API Keys API 实例类型 */
export type ApiKeysApi = ReturnType<typeof createApiKeysApi>
