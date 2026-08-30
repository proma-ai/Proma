import type { TurnTiming } from '@proma/shared'

/**
 * Turn 速度计算的纯函数：把 result 消息携带的官方 usage 与主进程打点的
 * 生成计时（TurnTiming）换算为用户可读的输出速度与首字延迟。
 *
 * 语义：
 * - tok/s = outputTokens ÷ genMs。genMs 只累计可见文本 delta 的活跃区间，
 *   不含工具执行时间；outputTokens 来自 API usage，包含工具调用轮次的 token，
 *   因此混合工具调用的 turn 结果为近似值。
 * - 低于门槛（超短回复 / 极少 token）时不输出速度，避免噪声。
 */

/** 净生成时长低于该值（毫秒）时不显示速度 */
const MIN_GEN_MS = 500
/** 输出 token 低于该值时不显示速度 */
const MIN_OUTPUT_TOKENS = 10

export interface TurnSpeedInput {
  outputTokens?: number
  ttftMs?: number
  genMs?: number
}

export interface TurnSpeed {
  /** 输出速度（tokens/秒） */
  tokPerSec?: number
  /** 首字延迟（毫秒） */
  ttftMs?: number
}

export function computeTurnSpeed(input: TurnSpeedInput): TurnSpeed {
  const result: TurnSpeed = {}
  const { outputTokens, ttftMs, genMs } = input
  if (typeof ttftMs === 'number' && Number.isFinite(ttftMs) && ttftMs > 0) {
    result.ttftMs = ttftMs
  }
  if (
    typeof outputTokens === 'number'
    && outputTokens >= MIN_OUTPUT_TOKENS
    && typeof genMs === 'number'
    && genMs >= MIN_GEN_MS
  ) {
    result.tokPerSec = Math.round((outputTokens / (genMs / 1000)) * 10) / 10
  }
  return result
}

export function formatTokPerSec(tokPerSec: number): string {
  return `${tokPerSec.toFixed(1)} tok/s`
}

export function isTurnTiming(value: unknown): value is TurnTiming {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.ttftMs === 'number' && typeof record.genMs === 'number'
}
