import type { ChannelPlanQuotaResult, ChannelPlanQuotaWindow } from '@proma/shared'

interface CodexUsageWindow {
  used_percent?: unknown
  limit_window_seconds?: unknown
  reset_at?: unknown
  reset_after_seconds?: unknown
}

interface CodexUsageResponse {
  plan_type?: unknown
  rate_limit?: {
    primary_window?: CodexUsageWindow | null
    secondary_window?: CodexUsageWindow | null
  } | null
}

function asFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toTimestamp(value: unknown): number | undefined {
  const timestamp = asFiniteNumber(value)
  if (!timestamp || timestamp <= 0) return undefined
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
}

function formatWindow(durationSeconds: number): Pick<ChannelPlanQuotaWindow, 'type' | 'label'> {
  // 只给 Codex 已知的精确窗口加专用标签，其他窗口按实际时长保留为 custom，
  // 避免把 4.5 小时或 6 天等不同限额误显示为 5 小时 / 每周。
  if (durationSeconds === 5 * 60 * 60) {
    return { type: '5h', label: '每 5 小时' }
  }
  if (durationSeconds === 7 * 24 * 60 * 60) {
    return { type: 'weekly', label: '每周额度' }
  }
  if (durationSeconds > 0 && durationSeconds % (24 * 60 * 60) === 0) {
    return { type: 'custom', label: `每 ${durationSeconds / (24 * 60 * 60)} 天` }
  }
  if (durationSeconds > 60 * 60 && durationSeconds % 60 === 0) {
    return { type: 'custom', label: `每 ${durationSeconds / (60 * 60)} 小时` }
  }
  if (durationSeconds > 0 && durationSeconds % 60 === 0) {
    return { type: 'custom', label: `每 ${durationSeconds / 60} 分钟` }
  }
  return { type: 'custom', label: '用量额度' }
}

function parseWindow(window: CodexUsageWindow | null | undefined): ChannelPlanQuotaWindow | null {
  if (!window) return null
  const usedPercent = asFiniteNumber(window.used_percent)
  const durationSeconds = asFiniteNumber(window.limit_window_seconds)
  if (usedPercent == null || durationSeconds == null || durationSeconds <= 0) return null

  const resetAfterSeconds = asFiniteNumber(window.reset_after_seconds)
  const resetAt = toTimestamp(window.reset_at)
    ?? (resetAfterSeconds != null && resetAfterSeconds > 0 ? Date.now() + resetAfterSeconds * 1000 : undefined)
  return {
    ...formatWindow(durationSeconds),
    usedPercent: clampPercent(usedPercent),
    remainingPercent: clampPercent(100 - usedPercent),
    ...(resetAt ? { resetAt } : {}),
  }
}

function formatPlanName(planType: unknown): string {
  if (typeof planType !== 'string' || !planType.trim()) return 'ChatGPT 订阅 (Codex)'
  const normalized = planType.trim().replace(/[_-]+/g, ' ')
  return `ChatGPT ${normalized.replace(/\b\w/g, (char) => char.toUpperCase())} (Codex)`
}

/**
 * 将 ChatGPT Codex `GET /backend-api/wham/usage` 响应转换为统一的订阅 Plan 额度格式。
 *
 * OpenAI 返回 primary / secondary 两个滚动窗口；通常分别对应 5 小时和每周，
 * 但按实际 duration 映射，以兼容未来的套餐窗口变更。
 */
export function parseCodexPlanQuotaResponse(data: unknown): ChannelPlanQuotaResult {
  const response = data as CodexUsageResponse
  const rateLimit = response?.rate_limit
  const windows = [
    parseWindow(rateLimit?.primary_window),
    parseWindow(rateLimit?.secondary_window),
  ].filter((window): window is ChannelPlanQuotaWindow => window != null)

  if (windows.length === 0) {
    return {
      supported: false,
      provider: 'openai-codex',
      windows: [],
      updatedAt: Date.now(),
      message: 'ChatGPT 未返回 Codex 订阅额度数据',
    }
  }

  return {
    supported: true,
    provider: 'openai-codex',
    planName: formatPlanName(response.plan_type),
    windows,
    updatedAt: Date.now(),
  }
}
