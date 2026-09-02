/**
 * Cloud 用量日志服务（主进程）
 *
 * 复用 auth service 的 API Client，封装用量日志 API 调用。
 * 所有方法统一返回 BillingIpcResponse<T> 格式。
 */

import { createUsageApi, isApiError } from '@proma/cloud'
import type { UsageApi } from '@proma/cloud'
import type {
  UsageQueryParams,
  UsageLogResponse,
  ToolUsageLogResponse,
  SpeechUsageLogResponse,
  AgentUsageLogResponse,
  AgentTurnUsage,
  CombinedUsageLogResponse,
  BillingIpcResponse,
} from '@proma/shared'
import { getApiClient } from './cloud-auth-service'

// ===== API 实例（延迟初始化） =====

let usageApi: UsageApi | null = null

function getUsageApi(): UsageApi {
  if (!usageApi) {
    usageApi = createUsageApi(getApiClient())
  }
  return usageApi
}

// ===== 统一错误处理 =====

function wrapError(error: unknown): string {
  if (isApiError(error)) return error.message
  return error instanceof Error ? error.message : '未知错误'
}

// ===== 公开 API =====

/** 获取模型调用日志 */
export async function getUsageLogs(params?: UsageQueryParams): Promise<BillingIpcResponse<UsageLogResponse>> {
  try {
    const data = await getUsageApi().getUsage(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取合并后的模型调用与 Agent API 调用日志 */
export async function getCombinedUsageLogs(params?: UsageQueryParams): Promise<BillingIpcResponse<CombinedUsageLogResponse>> {
  try {
    const data = await getUsageApi().getCombinedUsage(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取工具调用日志 */
export async function getToolUsageLogs(params?: UsageQueryParams): Promise<BillingIpcResponse<ToolUsageLogResponse>> {
  try {
    const data = await getUsageApi().getToolUsage(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取语音用量日志 */
export async function getSpeechUsageLogs(params?: UsageQueryParams): Promise<BillingIpcResponse<SpeechUsageLogResponse>> {
  try {
    const data = await getUsageApi().getSpeechUsage(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取 Agent API 调用日志 */
export async function getAgentUsageLogs(params?: UsageQueryParams): Promise<BillingIpcResponse<AgentUsageLogResponse>> {
  try {
    const data = await getUsageApi().getAgentUsage(params)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取一条官方 Agent 回复关联轮次的权威积分消耗。 */
export async function getAgentTurnUsage(turnId: string): Promise<BillingIpcResponse<AgentTurnUsage>> {
  try {
    const data = await getUsageApi().getAgentTurnUsage(turnId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}
