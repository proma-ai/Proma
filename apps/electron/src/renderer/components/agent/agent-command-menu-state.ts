import type { CalendarEvent, Todo } from '@proma/shared'

export interface CommandMenuSearchItem {
  id?: string
  label: string
  description?: string
}

export type PlanningReferenceType = 'todo' | 'calendar_event'

export interface PlanningReferenceMenuItem extends CommandMenuSearchItem {
  id: string
  referenceType: PlanningReferenceType
}

export interface SessionReferenceDescriptionInput {
  workspaceName?: string
  workspaceSlug?: string
  snippet?: string
}

export function getNextCommandMenuIndex(current: number, direction: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return 0
  return (current + direction + itemCount) % itemCount
}

export function filterCommandMenuItems<T extends CommandMenuSearchItem>(items: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.filter((item) => (
    item.id?.toLocaleLowerCase().includes(normalizedQuery) ||
    item.label.toLocaleLowerCase().includes(normalizedQuery) ||
    item.description?.toLocaleLowerCase().includes(normalizedQuery)
  ))
}

/**
 * 从命令根页进入子页时，保留根页筛选词但不把它误当作资源搜索词。
 */
export function getCommandMenuChildQuery(query: string, pageEntryQuery: string): string {
  return query.startsWith(pageEntryQuery)
    ? query.slice(pageEntryQuery.length)
    : query
}

export function formatSessionReferenceDescription(input: SessionReferenceDescriptionInput): string | undefined {
  const workspace = input.workspaceName
    ? input.workspaceSlug && input.workspaceSlug !== input.workspaceName
      ? `${input.workspaceName} (${input.workspaceSlug})`
      : input.workspaceName
    : input.workspaceSlug
  const parts = [workspace ? `项目：${workspace}` : undefined, input.snippet]
    .filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(' · ') : undefined
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

/** 命令菜单中的日程范围：本地昨天零点起，至一个日历月后当天结束的半开区间。 */
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

/**
 * 将 Planning 记录转换为命令菜单引用项。
 * Todo 保留 Planning 列表既有的“有计划时间优先、无时间置后”约定；日程按开始时间排序。
 */
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

/**
 * 只校验当前 TipTap suggestion 匹配到的 slash token；不能用整篇文档
 * 判断，否则前文的普通 `/` 会阻塞当前位置再次调用命令菜单。
 */
export function shouldOpenSlashCommandMenu(token: string): boolean {
  return /^\/[^/\s]*$/.test(token)
}

/**
 * 在 TipTap 已匹配到当前 slash token 后，排除其中位于 ASCII 路径或 URL
 * 片段内的 `/`。中文正文不强制要求空格，仍可直接输入 `/` 调用菜单。
 */
export function shouldOpenSlashCommandMenuInContext(prefix: string, token: string): boolean {
  if (!shouldOpenSlashCommandMenu(token)) return false

  const currentRun = `${prefix}${token}`
    .split(/[\s,.;!?，。！？；、]/u)
    .at(-1) ?? ''
  const triggerIndex = currentRun.lastIndexOf('/')
  if (triggerIndex === -1) return false

  const beforeTrigger = currentRun.slice(0, triggerIndex)
  if (!beforeTrigger) return true
  if (beforeTrigger.includes('/')) return false

  // `foo/bar`、`C:/path`、`https:/` 等 ASCII 片段视为普通路径/URL；
  // 非 ASCII 正文（如 `继续调用/`）则保留中文无空格调用体验。
  return !/[\x00-\x7F]/.test(beforeTrigger)
}
