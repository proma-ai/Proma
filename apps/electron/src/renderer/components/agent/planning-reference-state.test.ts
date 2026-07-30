import { describe, expect, test } from 'bun:test'
import type { CalendarEvent, Todo } from '@proma/shared'
import {
  buildPlanningReferenceItems,
  filterPlanningReferenceItems,
  getPlanningReferenceRange,
} from './planning-reference-state'

const now = new Date(2026, 6, 30, 12, 0, 0).getTime()

function createTodo(overrides: Partial<Todo>): Todo {
  return {
    id: 'todo-1',
    title: '完成 Composer 改造',
    status: 'open',
    priority: 'medium',
    tags: [],
    reminders: [],
    sessionLinks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createCalendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'event-1',
    title: '产品评审',
    startAt: now + 60 * 60 * 1000,
    endAt: now + 90 * 60 * 1000,
    allDay: false,
    tags: [],
    reminders: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('planning reference suggestion state', () => {
  test('includes open todos and events within the current planning window', () => {
    const items = buildPlanningReferenceItems([
      createTodo({ id: 'open' }),
      createTodo({ id: 'completed', status: 'completed' }),
    ], [
      createCalendarEvent({ id: 'upcoming' }),
      createCalendarEvent({ id: 'past', startAt: now - 4 * 24 * 60 * 60 * 1000, endAt: now - 3 * 24 * 60 * 60 * 1000 }),
    ], now)

    expect(items.map((item) => `${item.referenceType}:${item.id}`)).toEqual([
      'todo:open',
      'calendar_event:upcoming',
    ])
  })

  test('filters the mixed planner list by title, type description, or id', () => {
    const items = buildPlanningReferenceItems([
      createTodo({ id: 'todo-composer', title: '恢复输入框引用' }),
    ], [
      createCalendarEvent({ id: 'event-review', title: '产品评审' }),
    ], now)

    expect(filterPlanningReferenceItems(items, '输入框')).toEqual([items[0]!])
    expect(filterPlanningReferenceItems(items, '日程')).toEqual([items[1]!])
    expect(filterPlanningReferenceItems(items, 'event-review')).toEqual([items[1]!])
  })

  test('uses a half-open window ending one calendar month after the current date', () => {
    const range = getPlanningReferenceRange(now)

    expect(new Date(range.from).getDate()).toBe(29)
    expect(new Date(range.toExclusive).getDate()).toBe(31)
    expect(range.toExclusive).toBeGreaterThan(now)
  })
})
