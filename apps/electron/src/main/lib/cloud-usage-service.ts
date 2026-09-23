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
  AgentTokenActivityResponse,
  AgentUsageLogResponse,
  AgentTurnUsage,
  CombinedUsageLogResponse,
  BillingIpcResponse,
} from '@proma/shared'
import { getApiClient } from './cloud-auth-service'
import { AsyncTtlCache } from './async-ttl-cache'
import { BoundedAsyncLookupCache } from './agent-turn-usage-cache'

// ===== API 实例（延迟初始化） =====

let usageApi: UsageApi | null = null

/**
 * 364 个已结束北京日的聚合结果在当天复用；次日首次进入账单页会
 * 自动重新聚合历史，而未结束的当天始终单独请求最新结果。
 */
const AGENT_TOKEN_ACTIVITY_HISTORY_CACHE_TTL_MS = 26 * 60 * 60 * 1000
const agentTokenActivityHistoryCache = new AsyncTtlCache<AgentTokenActivityResponse>(
  AGENT_TOKEN_ACTIVITY_HISTORY_CACHE_TTL_MS,
)
let agentTokenActivityHistoryCacheDate: string | null = null

const AGENT_TURN_USAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const agentTurnUsageCache = new BoundedAsyncLookupCache<AgentTurnUsage>({
  ttlMs: AGENT_TURN_USAGE_CACHE_TTL_MS,
  maxEntries: 1_000,
  maxConcurrent: 2,
  shouldCache: (usage) => usage.found,
})

function getBeijingIsoDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

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

/**
 * 获取 Proma Agent 的每日 Token 活跃度（不含 Chat、工具和语音）。
 *
 * 已结束的 364 天仅在北京时间跨日后重新读取；当天则在每次进入
 * 账单页时单独请求并与历史快照合并，避免完整 365 天聚合查询。
 */
export async function getAgentTokenActivity(): Promise<BillingIpcResponse<AgentTokenActivityResponse>> {
  try {
    const today = getBeijingIsoDate()
    if (agentTokenActivityHistoryCacheDate !== today) {
      agentTokenActivityHistoryCache.invalidate()
      agentTokenActivityHistoryCacheDate = today
    }

    const historyStartDate = shiftIsoDate(today, -364)
    const historyEndDate = shiftIsoDate(today, -1)
    const [history, currentDay] = await Promise.all([
      agentTokenActivityHistoryCache.getOrLoad(() =>
        getUsageApi().getAgentTokenActivity({
          startDate: historyStartDate,
          endDate: historyEndDate,
        }),
      ),
      getUsageApi().getAgentTokenActivity({ startDate: today, endDate: today }),
    ])

    return {
      success: true,
      data: {
        items: [...history.items, ...currentDay.items].sort((left, right) =>
          left.date.localeCompare(right.date),
        ),
        startDate: history.startDate,
        endDate: currentDay.endDate,
      },
    }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 在账号切换时丢弃上一账号的活跃地图缓存。 */
export function clearAgentTokenActivityCache(): void {
  agentTokenActivityHistoryCache.invalidate()
  agentTokenActivityHistoryCacheDate = null
}

/** 在账号切换时丢弃上一账号已结算的 Agent 轮次积分缓存。 */
export function clearAgentTurnUsageCache(): void {
  agentTurnUsageCache.clear()
}

/** 获取一条官方 Agent 回复关联轮次的权威积分消耗。 */
export async function getAgentTurnUsage(turnId: string): Promise<BillingIpcResponse<AgentTurnUsage>> {
  try {
    const data = await agentTurnUsageCache.getOrLoad(turnId, () => getUsageApi().getAgentTurnUsage(turnId))
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}
