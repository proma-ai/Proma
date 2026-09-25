/**
 * Cloud 模型健康检查服务（主进程）
 *
 * 负责：
 * - 从 api.proma.cool 获取模型健康数据
 * - 缓存数据（3 分钟 TTL）
 * - 转换为 UI 友好的 ModelHealthSummary 格式
 */

import { getCloudApiConfig } from '@proma/cloud'
import type {
  ModelHealthResponse,
  ModelHealthSummary,
  ModelHealthIpcResponse,
  HealthBarCell,
  HealthBarCellStatus,
  HealthCheckRecord,
} from '@proma/shared'
import { getAuthToken } from './cloud-auth-service'
import { withCloudFetch } from './cloud-network-service'
import { AsyncTtlCache } from './async-ttl-cache'

// ===== 缓存配置 =====

/** 缓存有效期：3 分钟，避免同一设置页会话内重复请求。 */
const CACHE_TTL = 3 * 60 * 1000

const healthCache = new AsyncTtlCache<ModelHealthSummary[]>(CACHE_TTL)

// ===== 数据转换 =====

/**
 * 将原始健康数据转换为电量条格式
 *
 * 使用比例分配：将所有 checks 均匀分布到 cellCount 格中，
 * 确保无论后端返回多少条数据，进度条都能填满。
 *
 * @param checks 健康检查记录列表（按时间正序）
 * @param cellCount 电量条格数（默认 25）
 * @returns 电量条数据
 */
function buildHealthBar(checks: HealthCheckRecord[], cellCount = 25): HealthBarCell[] {
  // 无数据时全部灰色
  if (checks.length === 0) {
    return Array.from({ length: cellCount }, () => ({
      status: 'gray' as HealthBarCellStatus,
      startTime: '',
      endTime: '',
    }))
  }

  const cells: HealthBarCell[] = []
  const total = checks.length

  for (let i = 0; i < cellCount; i++) {
    const startIdx = Math.floor((i / cellCount) * total)
    const endIdx = Math.floor(((i + 1) / cellCount) * total)
    const cellChecks = checks.slice(startIdx, endIdx)

    let status: HealthBarCellStatus = 'gray'
    if (cellChecks.length > 0) {
      const healthyCount = cellChecks.filter((c) => c.healthy).length
      const ratio = healthyCount / cellChecks.length
      if (ratio >= 1) status = 'green'
      else if (ratio >= 0.5) status = 'yellow'
      else status = 'red'
    }

    cells.push({
      status,
      startTime: cellChecks[0]?.time ?? '',
      endTime: cellChecks[cellChecks.length - 1]?.time ?? '',
    })
  }

  return cells
}

/**
 * 计算健康率百分比
 */
function calcHealthRate(checks: HealthCheckRecord[]): number {
  if (checks.length === 0) return 0
  const healthyCount = checks.filter((c) => c.healthy).length
  return Math.round((healthyCount / checks.length) * 100)
}

/**
 * 生成时间范围标签
 */
function formatTimeRangeLabel(checks: HealthCheckRecord[]): string {
  if (checks.length === 0) return ''
  const lastCheck = checks[checks.length - 1]
  if (!lastCheck) return ''
  const latest = new Date(lastCheck.time)
  const month = latest.toLocaleString('en-US', { month: 'short' })
  const day = latest.getDate()
  const year = latest.getFullYear()
  const hour = latest.getHours()
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${month} ${day}, ${year} - ${hour12} ${ampm}`
}

/**
 * 将 API 响应转换为 UI 渲染用的摘要格式
 */
function transformToSummaries(response: ModelHealthResponse): ModelHealthSummary[] {
  return Object.entries(response.models).map(([modelId, data]) => ({
    modelId,
    displayName: data.displayName,
    healthBar: buildHealthBar(data.checks),
    healthRatePercent: calcHealthRate(data.checks),
    timeRangeLabel: formatTimeRangeLabel(data.checks),
  }))
}

// ===== 公开 API =====

/**
 * 获取模型健康数据
 *
 * 优先使用缓存，过期后重新请求
 */
export async function getModelHealth(): Promise<ModelHealthIpcResponse> {
  try {
    const data = await healthCache.getOrLoad(async () => {
      const config = getCloudApiConfig()
      const rootUrl = config.baseUrl.replace(/\/api\/v\d+$/, '')
      const token = getAuthToken()
      return withCloudFetch(async (fetchFn) => {
        const response = await fetchFn(`${rootUrl}/api/v1/model-health`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`请求失败 (${response.status}): ${text.slice(0, 100)}`)
        }
        const json = (await response.json()) as { data: ModelHealthResponse }
        return transformToSummaries(json.data)
      })
    })
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, error: message }
  }
}

/**
 * 清除健康数据缓存（登出时调用）
 */
export function clearHealthCache(): void {
  healthCache.invalidate()
}
