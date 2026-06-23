import { describe, expect, test } from 'bun:test'
import { computeNextRunAt } from './automation-manager'

describe('computeNextRunAt 月度调度', () => {
  // 用固定 from 时间戳避免测试与当前时间耦合；2026-03-31 09:30 UTC+8
  // 注意：Date 内部使用本地时区，下面所有 "from" 和期望值都按本地时间描述
  const base = (y: number, m: number, d: number, hh: number, mm: number): number =>
    new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

  test('Given 当月目标日还未到达 When 计算下次运行 Then 返回本月该日', () => {
    const from = base(2026, 6, 14, 9, 36)
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 20 },
      from,
    )
    expect(new Date(next).getDate()).toBe(20)
    expect(new Date(next).getMonth() + 1).toBe(6)
  })

  test('Given 当月目标日已过 When 计算下次运行 Then 跳到下月同日', () => {
    const from = base(2026, 6, 14, 9, 36)
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 10 },
      from,
    )
    expect(new Date(next).getMonth() + 1).toBe(7)
    expect(new Date(next).getDate()).toBe(10)
  })

  test('Given 3/31 目标 31 号已过 When 计算下次运行 Then 落在 4/30 而非跳到 5/1', () => {
    const from = base(2026, 3, 31, 9, 30)
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 31 },
      from,
    )
    expect(new Date(next).getMonth() + 1).toBe(4)
    expect(new Date(next).getDate()).toBe(30)
  })

  test('Given 1/31 目标 31 号 When 计算下次运行 Then 落在 2/28 而非 3/3（关键：setDate(1) 防溢出）', () => {
    const from = base(2026, 1, 31, 9, 30)
    // 2026 年非闰年，2 月 28 天
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 31 },
      from,
    )
    expect(new Date(next).getMonth() + 1).toBe(2)
    expect(new Date(next).getDate()).toBe(28)
  })

  test('Given 闰年 1/31 目标 31 号 When 计算下次运行 Then 落在 2/29', () => {
    const from = base(2024, 1, 31, 9, 30)
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 31 },
      from,
    )
    expect(new Date(next).getMonth() + 1).toBe(2)
    expect(new Date(next).getDate()).toBe(29)
  })

  test('Given dayOfMonth=29 在 2 月 When 计算下次运行 Then 落在 2/28（平年）', () => {
    const from = base(2026, 1, 31, 9, 30)
    const next = computeNextRunAt(
      { scheduleType: 'monthly', timeOfDay: '09:00', dayOfMonth: 29 },
      from,
    )
    expect(new Date(next).getMonth() + 1).toBe(2)
    expect(new Date(next).getDate()).toBe(28)
  })
})

describe('computeNextRunAt 一次性调度（once）', () => {
  const base = (y: number, m: number, d: number, hh: number, mm: number): number =>
    new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

  test('Given scheduledAt 在未来 When 计算下次运行 Then 原样返回 scheduledAt', () => {
    const from = base(2026, 6, 23, 14, 0)
    const target = base(2026, 6, 30, 15, 0)
    const next = computeNextRunAt({ scheduleType: 'once', scheduledAt: target }, from)
    expect(next).toBe(target)
  })

  test('Given scheduledAt 已过去 When 计算下次运行 Then 仍返回过去的 scheduledAt（不前进，交由调度器补跑）', () => {
    const from = base(2026, 6, 23, 14, 0)
    const target = base(2026, 6, 20, 9, 0)
    const next = computeNextRunAt({ scheduleType: 'once', scheduledAt: target }, from)
    expect(next).toBe(target)
  })

  test('Given once 缺少 scheduledAt When 计算下次运行 Then 回退到 from + 10 分钟', () => {
    const from = base(2026, 6, 23, 14, 0)
    const next = computeNextRunAt({ scheduleType: 'once' }, from)
    expect(next).toBe(from + 10 * 60_000)
  })
})
