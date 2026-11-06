import { describe, expect, test } from 'bun:test'
import { getAgentIslandPlanningTimerDelay } from './agent-island-planning'

const NOW = 1_800_000_000_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

describe('getAgentIslandPlanningTimerDelay', () => {
  test('下一个时间点在定时器上限内时，等到该时间点后 25ms', () => {
    expect(getAgentIslandPlanningTimerDelay(NOW + 60_000, NOW)).toBe(60_025)
  })

  test('下一个时间点非常接近时，至少等待 1 秒', () => {
    expect(getAgentIslandPlanningTimerDelay(NOW + 10, NOW)).toBe(1_000)
  })

  test('延迟恰好等于定时器上限时保持不变', () => {
    expect(getAgentIslandPlanningTimerDelay(NOW + MAX_TIMER_DELAY_MS - 25, NOW)).toBe(MAX_TIMER_DELAY_MS)
  })

  test('下一个时间点超过定时器上限时，封顶而不是溢出成 1ms', () => {
    const twentyFiveDays = 25 * 24 * 60 * 60_000
    expect(getAgentIslandPlanningTimerDelay(NOW + twentyFiveDays, NOW)).toBe(MAX_TIMER_DELAY_MS)
  })
})
