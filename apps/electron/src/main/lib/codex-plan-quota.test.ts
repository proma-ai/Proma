import { describe, expect, test } from 'bun:test'
import { parseCodexPlanQuotaResponse } from './codex-plan-quota'

describe('Codex OAuth 订阅额度解析', () => {
  test('Given 5 小时和每周窗口 When 解析 wham usage Then 转成统一 Plan 额度', () => {
    const result = parseCodexPlanQuotaResponse({
      plan_type: 'pro',
      rate_limit: {
        primary_window: {
          used_percent: 42,
          limit_window_seconds: 18_000,
          reset_at: 1_784_365_200,
        },
        secondary_window: {
          used_percent: 5,
          limit_window_seconds: 604_800,
          reset_at: 1_784_966_400,
        },
      },
    })

    expect(result).toMatchObject({
      supported: true,
      provider: 'openai-codex',
      planName: 'ChatGPT Pro (Codex)',
      windows: [
        { type: '5h', label: '每 5 小时', usedPercent: 42, remainingPercent: 58, resetAt: 1_784_365_200_000 },
        { type: 'weekly', label: '每周额度', usedPercent: 5, remainingPercent: 95, resetAt: 1_784_966_400_000 },
      ],
    })
  })

  test('Given 非标准窗口 When 解析 Then 保留为自定义额度而非丢失', () => {
    const result = parseCodexPlanQuotaResponse({
      rate_limit: {
        primary_window: {
          used_percent: 12.6,
          limit_window_seconds: 86_400,
        },
      },
    })

    expect(result).toMatchObject({
      supported: true,
      windows: [{ type: 'custom', label: '每 1 天', usedPercent: 13, remainingPercent: 87 }],
    })
  })

  test('Given 非标准的 4.5 小时和 6 天窗口 When 解析 Then 不误标为 5 小时或每周', () => {
    const result = parseCodexPlanQuotaResponse({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 16_200 },
        secondary_window: { used_percent: 20, limit_window_seconds: 518_400 },
      },
    })

    expect(result.windows).toMatchObject([
      { type: 'custom', label: '每 4.5 小时' },
      { type: 'custom', label: '每 6 天' },
    ])
  })

  test('Given 缺少 reset_at 但含 reset_after_seconds When 解析 Then 推导重置时间', () => {
    const before = Date.now()
    const result = parseCodexPlanQuotaResponse({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_after_seconds: 3600 },
      },
    })
    const resetAt = result.windows[0]?.resetAt

    expect(resetAt).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(resetAt).toBeLessThanOrEqual(Date.now() + 3_600_000)
  })

  test('Given 缺失或损坏响应 When 解析 Then 返回可展示的失败原因', () => {
    expect(parseCodexPlanQuotaResponse({ rate_limit: { primary_window: { used_percent: 20 } } })).toMatchObject({
      supported: false,
      provider: 'openai-codex',
      windows: [],
      message: 'ChatGPT 未返回 Codex 订阅额度数据',
    })
  })
})
