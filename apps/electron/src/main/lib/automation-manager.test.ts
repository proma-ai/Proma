import { describe, expect, test } from 'bun:test'
import { applyMaxRunsUpdate, computeNextRunAt } from './automation-manager'

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

describe('computeNextRunAt 每日执行窗口', () => {
  const base = (y: number, m: number, d: number, hh: number, mm: number): number =>
    new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

  const schedule = { scheduleType: 'interval' as const, intervalMinutes: 20, activeWindowStart: '10:00', activeWindowEnd: '22:00' }
  const weekdaySchedule = { ...schedule, activeWeekdays: [1, 2, 3, 4, 5] }

  test('Given 当前在窗口开始前 When 计算下次运行 Then 对齐到今日窗口开始', () => {
    expect(computeNextRunAt(schedule, base(2026, 8, 12, 9, 42))).toBe(base(2026, 8, 12, 10, 0))
  })

  test('Given 当前在窗口内且下个间隔仍在窗口内 When 计算下次运行 Then 保持间隔', () => {
    expect(computeNextRunAt(schedule, base(2026, 8, 12, 10, 20))).toBe(base(2026, 8, 12, 10, 40))
  })

  test('Given 上轮完成时间偏离间隔槽位 When 计算下次运行 Then 仍对齐至窗口锚点的下一槽位', () => {
    expect(computeNextRunAt(schedule, base(2026, 8, 12, 10, 27))).toBe(base(2026, 8, 12, 10, 40))
  })

  test('Given 下个间隔会越过窗口结束 When 计算下次运行 Then 跳至明日窗口开始', () => {
    expect(computeNextRunAt(schedule, base(2026, 8, 12, 21, 50))).toBe(base(2026, 8, 13, 10, 0))
  })

  test('Given 周五窗口结束后 When 计算下次运行 Then 跳过周末到周一窗口开始', () => {
    expect(computeNextRunAt(weekdaySchedule, base(2026, 8, 14, 22, 0))).toBe(base(2026, 8, 17, 10, 0))
  })

  test('Given 周五窗口内的最后一次执行 When 计算下次运行 Then 下次为周一窗口开始', () => {
    expect(computeNextRunAt(weekdaySchedule, base(2026, 8, 14, 21, 50))).toBe(base(2026, 8, 17, 10, 0))
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

describe('updateAutomation maxRuns 配额重置', () => {
  test('Given 任务已跑满旧上限 When 修改 maxRuns Then runCount 与 completedAt 被重置', () => {
    const automation = {
      maxRuns: 1,
      runCount: 1,
      completedAt: Date.now(),
    }

    applyMaxRunsUpdate(automation, 3)

    expect(automation.maxRuns).toBe(3)
    expect(automation.runCount).toBe(0)
    expect(automation.completedAt).toBeUndefined()
  })

  test('Given maxRuns 未变化 When 应用更新 Then 保留现有 runCount 与 completedAt', () => {
    const completedAt = Date.now()
    const automation = {
      maxRuns: 3,
      runCount: 2,
      completedAt,
    }

    applyMaxRunsUpdate(automation, 3)

    expect(automation.maxRuns).toBe(3)
    expect(automation.runCount).toBe(2)
    expect(automation.completedAt).toBe(completedAt)
  })
})
