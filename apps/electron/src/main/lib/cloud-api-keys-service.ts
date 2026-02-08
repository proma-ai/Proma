/**
 * Cloud API Keys 服务（主进程）
 *
 * 复用 auth service 的 API Client，封装 API Key CRUD 操作。
 * 所有方法统一返回 BillingIpcResponse<T> 格式。
 */

import {
  createApiKeysApi,
  isApiError,
} from '@proma/cloud'
import type { ApiKeysApi } from '@proma/cloud'
import type {
  ApiKeyResponse,
  ApiKeyCreateResponse,
  ApiKeyCreateParams,
  ApiKeyUpdateParams,
  BillingIpcResponse,
} from '@proma/shared'
import { getApiClient } from './cloud-auth-service'

// ===== API 实例（延迟初始化） =====

let apiKeysApi: ApiKeysApi | null = null

function getApiKeysApi(): ApiKeysApi {
  if (!apiKeysApi) {
    apiKeysApi = createApiKeysApi(getApiClient())
  }
  return apiKeysApi
}

// ===== 统一错误处理 =====

function wrapError(error: unknown): string {
  if (isApiError(error)) return error.message
  return error instanceof Error ? error.message : '未知错误'
}

// ===== 公开 API =====

/** 获取 API Keys 列表 */
export async function listApiKeys(): Promise<BillingIpcResponse<ApiKeyResponse[]>> {
  try {
    const data = await getApiKeysApi().list()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 创建 API Key */
export async function createApiKey(params: ApiKeyCreateParams): Promise<BillingIpcResponse<ApiKeyCreateResponse>> {
  try {
    const data = await getApiKeysApi().create(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 更新 API Key */
export async function updateApiKey(keyId: string, params: ApiKeyUpdateParams): Promise<BillingIpcResponse<ApiKeyResponse>> {
  try {
    const data = await getApiKeysApi().update(keyId, params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 删除 API Key */
export async function deleteApiKey(keyId: string): Promise<BillingIpcResponse<void>> {
  try {
    await getApiKeysApi().delete(keyId)
    return { success: true }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}
