/** 渠道用量明细中的执行状态。 */
export type ChannelUsageStatus = 'success' | 'error'

/**
 * 一次模型请求的渠道用量明细。
 *
 * 请求与 Token 来自 assistant 消息；同一轮 result 的费用、耗时和最终状态
 * 会附着到最近一条 assistant 明细，便于后续 UI 按行展示。
 */
export interface ChannelUsageRecord {
  /** `${sessionId}:${lineNumber}`，在一次扫描中稳定且唯一。 */
  id: string
  sessionId: string
  /** 保留日志中的原始 provider 字符串，避免绑定到特定 ProviderType 联合类型。 */
  provider: string
  modelId: string
  createdAt: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** input + output + cacheRead + cacheCreation。 */
  totalTokens: number
  /** 只从 result.total_cost_usd 读取；没有费用信息时为 0。 */
  costUsd: number
  durationMs?: number
  status: ChannelUsageStatus
}

/** 渠道用量汇总，可用于总览以及各维度分组。 */
export interface ChannelUsageSummary {
  requestCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
  successCount: number
  errorCount: number
  /** 成功请求数 / 请求总数；没有请求时为 0。 */
  successRate: number
  /** cacheRead / (cacheRead + cacheCreation + input)；分母为 0 时为 0。 */
  cacheHitRate: number
}

/** 一次扫描、筛选与分页后的统计结果。 */
export interface ChannelUsageStats {
  summary: ChannelUsageSummary
  byDay: Record<string, ChannelUsageSummary>
  /** 仅包含扫描时“今天”的小时桶，key 为 `HH:00`。 */
  byHour: Record<string, ChannelUsageSummary>
  byProvider: Record<string, ChannelUsageSummary>
  byModel: Record<string, ChannelUsageSummary>
  records: ChannelUsageRecord[]
  totalRecords: number
  page: number
  pageSize: number
}

/** 渠道用量筛选与明细分页参数。 */
export interface UsageLogQuery {
  /** 起始时间（Unix 毫秒），包含边界。 */
  startAt?: number
  /** 结束时间（Unix 毫秒），包含边界。 */
  endAt?: number
  provider?: string
  modelId?: string
  /** 从 1 开始。非法值会回退到 1。 */
  page?: number
  /** 默认 50，最大 200。 */
  pageSize?: number
}
