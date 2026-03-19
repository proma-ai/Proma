/**
 * 模型健康检查相关类型定义
 */

/** 单次健康检查记录 */
export interface HealthCheckRecord {
  /** 检测时间 (ISO 8601) */
  time: string
  /** 是否健康 */
  healthy: boolean
}

/** 单个模型的健康数据 */
export interface ModelHealthData {
  /** 模型显示名称 */
  displayName: string
  /** 健康检查记录列表（按时间正序，最新在后） */
  checks: HealthCheckRecord[]
}

/** 健康检查 API 响应 */
export interface ModelHealthResponse {
  /** 数据生成时间戳 (ISO 8601) */
  timestamp: string
  /** 检测间隔（分钟） */
  intervalMinutes: number
  /** 数据保留时长（小时） */
  retentionHours: number
  /** 各模型健康数据，key 为模型 ID */
  models: Record<string, ModelHealthData>
}

/** 电量条单格状态 */
export type HealthBarCellStatus = 'green' | 'yellow' | 'red' | 'gray'

/** 电量条单格数据（UI 渲染用） */
export interface HealthBarCell {
  /** 状态：绿色（2次健康）、黄色（1次健康1次不健康）、红色（2次不健康）、灰色（无数据） */
  status: HealthBarCellStatus
  /** 该格覆盖的时间范围起始 */
  startTime: string
  /** 该格覆盖的时间范围结束 */
  endTime: string
}

/** 模型健康摘要（渲染用） */
export interface ModelHealthSummary {
  /** 模型 ID */
  modelId: string
  /** 模型显示名称 */
  displayName: string
  /** 电量条数据（20 格） */
  healthBar: HealthBarCell[]
  /** 历史健康率（百分比，0-100） */
  healthRatePercent: number
  /** 数据时间范围描述（如 "Mar 19, 2026 - 11 AM"） */
  timeRangeLabel: string
}

/** 健康数据 IPC 响应 */
export interface ModelHealthIpcResponse {
  success: boolean
  data?: ModelHealthSummary[]
  error?: string
}
