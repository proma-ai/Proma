import type { CalendarEvent, Todo } from '@proma/shared'

export type PlanningReferenceType = 'todo' | 'calendar_event'

export interface PlanningReferenceMenuItem {
  id: string
  label: string
  description: string
  referenceType: PlanningReferenceType
}

function formatPlanningTimestamp(timestamp: number, allDay = false): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    ...(allDay ? {} : {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  }).format(timestamp)
}

/** 日程范围从本地昨天零点起，至一个日历月后当天结束的半开区间。 */
export function getPlanningReferenceRange(now = Date.now()): { from: number; toExclusive: number } {
  const fromDate = new Date(now)
  fromDate.setHours(0, 0, 0, 0)
  fromDate.setDate(fromDate.getDate() - 1)

  const targetDate = new Date(now)
  const originalDay = targetDate.getDate()
  targetDate.setDate(1)
  targetDate.setMonth(targetDate.getMonth() + 1)
  const lastDayOfTargetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate()
  targetDate.setDate(Math.min(originalDay, lastDayOfTargetMonth))
  targetDate.setHours(0, 0, 0, 0)

  const toExclusiveDate = new Date(targetDate)
  toExclusiveDate.setDate(toExclusiveDate.getDate() + 1)
  return { from: fromDate.getTime(), toExclusive: toExclusiveDate.getTime() }
}

function calendarEventEndAt(event: CalendarEvent): number {
  if (event.endAt !== undefined) return event.endAt
  if (!event.allDay) return event.startAt + 30 * 60 * 1000

  const nextDay = new Date(event.startAt)
  nextDay.setHours(0, 0, 0, 0)
  nextDay.setDate(nextDay.getDate() + 1)
  return nextDay.getTime()
}

function compareTodosByPlannedTime(left: Todo, right: Todo): number {
  if (left.dueAt !== undefined && right.dueAt !== undefined) {
    if (left.dueAt !== right.dueAt) return left.dueAt - right.dueAt
  } else if (left.dueAt !== undefined) {
    return -1
  } else if (right.dueAt !== undefined) {
    return 1
  }

  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  return left.id.localeCompare(right.id)
}

export function buildPlanningReferenceItems(
  todos: Todo[],
  events: CalendarEvent[],
  now = Date.now(),
): PlanningReferenceMenuItem[] {
  const todoItems: PlanningReferenceMenuItem[] = [...todos]
    .filter((todo) => todo.status === 'open')
    .sort(compareTodosByPlannedTime)
    .map((todo) => ({
      id: todo.id,
      label: todo.title,
      description: todo.dueAt === undefined
        ? 'Todo · 未设置计划时间'
        : `Todo · 截止 ${formatPlanningTimestamp(todo.dueAt)}`,
      referenceType: 'todo',
    }))

  const { from, toExclusive } = getPlanningReferenceRange(now)
  const calendarItems: PlanningReferenceMenuItem[] = [...events]
    .filter((event) => event.startAt < toExclusive && calendarEventEndAt(event) > from)
    .sort((left, right) => left.startAt - right.startAt || left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
    .map((event) => ({
      id: event.id,
      label: event.title,
      description: event.allDay
        ? `日程 · 全天 ${formatPlanningTimestamp(event.startAt, true)}`
        : `日程 · ${formatPlanningTimestamp(event.startAt)}`,
      referenceType: 'calendar_event',
    }))

  return [...todoItems, ...calendarItems]
}

export function filterPlanningReferenceItems(
  items: PlanningReferenceMenuItem[],
  query: string,
): PlanningReferenceMenuItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.filter((item) => (
    item.id.toLocaleLowerCase().includes(normalizedQuery) ||
    item.label.toLocaleLowerCase().includes(normalizedQuery) ||
    item.description.toLocaleLowerCase().includes(normalizedQuery)
  ))
}
