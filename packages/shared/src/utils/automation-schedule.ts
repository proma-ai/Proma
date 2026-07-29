/**
 * 定时任务触发时间展开（日历视图展示用）
 *
 * 调度器（apps/electron/src/main/lib/automation-manager.ts）只持久化 nextRunAt 一个锚点；
 * 日历月/周视图需要看到可见范围内的全部未来触发时间，这里按调度规则展开。
 * 展开规则与主进程 computeNextRunAt 保持一致：
 * - interval 从 nextRunAt 等距累加（锚点语义）
 * - daily / weekly / monthly 用本地日历推进，保留 timeOfDay 的 hh:mm（DST 安全）
 * - monthly 短月钳制（先回 1 号再进月，setDate(min(dayOfMonth, 当月天数))）
 */

import type { Automation } from '../types/automation'

/** 展开所需的调度字段（Automation 子集，方便单测与复用） */
export type AutomationScheduleFields = Pick<Automation, 'scheduleType' | 'nextRunAt'> &
  Partial<
    Pick<Automation, 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek' | 'dayOfMonth' | 'scheduledAt' | 'maxRuns' | 'runCount'>
  >

/** 一天内的触发分布 */
export interface AutomationOccurrenceDay {
  /** 当天 0 点（本地）时间戳 */
  day: number
  /** 当天触发时刻（升序）。密集任务只保留前 AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY 个，完整次数看 count */
  times: number[]
  /** 当天实际触发总次数 */
  count: number
}

/** 每天最多保留的触发时刻样本数（UI 用于逐点展示或取首次时间；超过则以 count 聚合展示） */
export const AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY = 4

/** 迭代兜底上限：interval=1min × 月视图 42 天 ≈ 6 万次，10 万足以覆盖正常场景且不会失控 */
const MAX_ITERATIONS = 100_000

function startOfDayTs(value: number): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * 生成 [rangeStart, rangeEnd] 内的全部触发时刻（升序），以 nextRunAt 为锚点推进。
 * - 只展开 >= nextRunAt 的点（调度权威：nextRunAt 之前的周期不会发生）
 * - maxRuns 限制剩余可运行次数（maxRuns - runCount）；once 天然只有 1 个点
 * - interval 从 nextRunAt 等距累加，跨度大时先数学快进（跳过的是未发生的历史，不消耗剩余次数）
 */
function* iterateOccurrences(
  automation: AutomationScheduleFields,
  rangeStart: number,
  rangeEnd: number,
): Generator<number> {
  const { nextRunAt } = automation
  if (!Number.isFinite(nextRunAt) || nextRunAt <= 0) return
  const remaining =
    automation.maxRuns !== undefined
      ? Math.max(0, automation.maxRuns - (automation.runCount ?? 0))
      : Number.POSITIVE_INFINITY
  if (remaining <= 0) return

  let produced = 0
  let iterations = 0

  if (automation.scheduleType === 'once') {
    if (nextRunAt >= rangeStart && nextRunAt <= rangeEnd) yield nextRunAt
    return
  }

  if (automation.scheduleType === 'interval') {
    const minutes = Number(automation.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes < 1) return
    const step = minutes * 60_000
    let ts = nextRunAt
    if (ts < rangeStart) {
      const skip = Math.floor((rangeStart - ts) / step)
      ts += skip * step
    }
    while (ts <= rangeEnd && produced < remaining && iterations < MAX_ITERATIONS) {
      iterations++
      if (ts >= rangeStart) {
        produced++
        yield ts
      }
      ts += step
    }
    return
  }

  // daily / weekly / monthly：从 nextRunAt（已对齐 timeOfDay/目标日）按本地日历推进
  const cursor = new Date(nextRunAt)
  const targetDom =
    Number.isFinite(automation.dayOfMonth) && automation.dayOfMonth! >= 1 && automation.dayOfMonth! <= 31
      ? automation.dayOfMonth!
      : 1
  while (cursor.getTime() <= rangeEnd && produced < remaining && iterations < MAX_ITERATIONS) {
    iterations++
    const ts = cursor.getTime()
    if (ts >= rangeStart) {
      produced++
      yield ts
    }
    if (automation.scheduleType === 'daily') {
      cursor.setDate(cursor.getDate() + 1)
    } else if (automation.scheduleType === 'weekly') {
      cursor.setDate(cursor.getDate() + 7)
    } else {
      // monthly：先回 1 号再进月，避免 31 号短月溢出；再钳制到当月实际天数
      cursor.setDate(1)
      cursor.setMonth(cursor.getMonth() + 1)
      cursor.setDate(Math.min(targetDom, daysInMonth(cursor.getFullYear(), cursor.getMonth())))
    }
  }
}

/**
 * 展开定时任务在 [rangeStart, rangeEnd] 范围内的触发时间，按天聚合（升序）。
 * 供日历月视图（每天一个标记 + ×N）与周视图（逐点展示或按天聚合）使用。
 */
export function getAutomationOccurrencesByDay(
  automation: AutomationScheduleFields,
  rangeStart: number,
  rangeEnd: number,
): AutomationOccurrenceDay[] {
  if (rangeEnd < rangeStart) return []
  const byDay = new Map<number, AutomationOccurrenceDay>()
  for (const ts of iterateOccurrences(automation, rangeStart, rangeEnd)) {
    const day = startOfDayTs(ts)
    let bucket = byDay.get(day)
    if (!bucket) {
      bucket = { day, times: [], count: 0 }
      byDay.set(day, bucket)
    }
    bucket.count++
    if (bucket.times.length < AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY) bucket.times.push(ts)
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day)
}
