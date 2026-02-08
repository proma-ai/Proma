/**
 * System API Key 接口
 *
 * 用于获取 system API key（pk_xxx 格式），
 * Agent SDK 通过此 key 走后端代理请求到 Anthropic 并完成计费。
 *
 * 端点参考 proma-frontend ApiKeyService
 */

import type { CloudApiClient } from './client'
import type { SystemApiKeyResponse } from '@proma/shared'

/** 创建 API Keys API */
export function createApiKeysApi(client: CloudApiClient) {
  return {
    /** 获取 system API key（pk_xxx 格式） */
    getSystemApiKey: async (): Promise<SystemApiKeyResponse> => {
      const response = await client.get<SystemApiKeyResponse>('/api-keys/system')
      return response.data
    },
  }
}

/** API Keys API 实例类型 */
export type ApiKeysApi = ReturnType<typeof createApiKeysApi>
