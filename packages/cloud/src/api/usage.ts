/**
 * 用量日志 API（纯函数，不依赖 React）
 *
 * 端点参考 proma-frontend/src/api/usage.ts
 */

import type { CloudApiClient } from './client'
import type {
  UsageQueryParams,
  UsageLogResponse,
  SpeechUsageLogResponse,
  ToolUsageLogResponse,
  AgentUsageLogResponse,
} from '@proma/shared'

/** 构建查询字符串 */
function buildQueryString(params?: UsageQueryParams): string {
  if (!params) return ''
  const parts: string[] = []
  if (params.dateFilter) parts.push(`date_filter=${params.dateFilter}`)
  if (params.page) parts.push(`page=${params.page}`)
  if (params.pageSize) parts.push(`page_size=${params.pageSize}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

/** 创建用量日志 API */
export function createUsageApi(client: CloudApiClient) {
  return {
    /** 获取模型调用日志 */
    getUsage: async (params?: UsageQueryParams): Promise<UsageLogResponse> => {
      const response = await client.get<UsageLogResponse>(`/me/usage${buildQueryString(params)}`)
      return response.data
    },

    /** 获取工具调用日志 */
    getToolUsage: async (params?: UsageQueryParams): Promise<ToolUsageLogResponse> => {
      const response = await client.get<ToolUsageLogResponse>(`/me/tool-usage${buildQueryString(params)}`)
      return response.data
    },

    /** 获取语音用量日志 */
    getSpeechUsage: async (params?: UsageQueryParams): Promise<SpeechUsageLogResponse> => {
      const response = await client.get<SpeechUsageLogResponse>(`/me/speech-usage${buildQueryString(params)}`)
      return response.data
    },

    /** 获取 Agent API 调用日志 */
    getAgentUsage: async (params?: UsageQueryParams): Promise<AgentUsageLogResponse> => {
      const response = await client.get<AgentUsageLogResponse>(`/me/agent-usage${buildQueryString(params)}`)
      return response.data
    },
  }
}

/** Usage API 实例类型 */
export type UsageApi = ReturnType<typeof createUsageApi>
