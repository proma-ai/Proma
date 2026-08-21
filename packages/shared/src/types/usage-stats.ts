/**
 * 用量统计（Usage Stats）共享类型
 *
 * 主进程 usage-stats-service 聚合 Agent 会话的 LLM 消耗后，
 * 通过 IPC 把该快照传给渲染层用量统计面板。
 */

/** Token 消耗拆分（与 SDK usage 字段一一对应） */
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** 按渠道（provider）或模型拆分的行（model='*' 表示 provider 汇总） */
export interface UsageBreakdownRow {
  provider: string
  model: string
  tokens: UsageTokens
  costUsd: number
  runs: number
}

/** 按自然日 × 渠道 × 模型的明细行（供面板按所选时间范围重新聚合） */
export interface UsageBreakdownDailyRow {
  /** yyyy-mm-dd（本地时区） */
  day: string
  provider: string
  model: string
  tokens: UsageTokens
  costUsd: number
  runs: number
}

/** 按自然日聚合一格 */
export interface UsageDayRow {
  /** yyyy-mm-dd（本地时区） */
  day: string
  tokens: UsageTokens
  costUsd: number
  runs: number
}

/** 用量统计面板一次性拿到的快照 */
export interface UsageStatsSnapshot {
  version: 1
  /** 最近一次完整/增量扫描时间（ms） */
  lastScannedAt: number
  totals: {
    tokens: UsageTokens
    costUsd: number
    runs: number
    /** 纳入统计的 Agent 会话文件数 */
    sessions: number
  }
  /** 按自然日升序 */
  daily: UsageDayRow[]
  /** 按渠道（provider）汇总，runs 降序 */
  byProvider: UsageBreakdownRow[]
  /** 按渠道×模型汇总，runs 降序 */
  byModel: UsageBreakdownRow[]
  /** 按自然日 × 渠道 × 模型明细，day 升序；面板按时间范围过滤后自行聚合 */
  breakdownDaily: UsageBreakdownDailyRow[]
}