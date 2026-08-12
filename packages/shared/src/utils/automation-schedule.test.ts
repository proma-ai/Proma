import { describe, expect, test } from 'bun:test'
import { getAutomationOccurrencesByDay } from './automation-schedule'

const at = (year: number, month: number, day: number, hours: number, minutes: number): number =>
  new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()

describe('getAutomationOccurrencesByDay interval active constraints', () => {
  test('Given a stale 1-minute window task When rendering a later month Then it fast-forwards to visible window days', () => {
    const occurrences = getAutomationOccurrencesByDay(
      {
        scheduleType: 'interval',
        intervalMinutes: 1,
        activeWindowStart: '09:00',
        activeWindowEnd: '18:00',
        nextRunAt: at(2026, 1, 1, 9, 0),
      },
      at(2026, 12, 1, 0, 0),
      at(2026, 12, 1, 23, 59),
    )

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]?.count).toBe(540)
    expect(occurrences[0]?.times[0]).toBe(at(2026, 12, 1, 9, 0))
  })

  test('Given a weekday-only task crossing a weekend When rendering Monday Then it preserves the real next occurrence', () => {
    const occurrences = getAutomationOccurrencesByDay(
      {
        scheduleType: 'interval',
        intervalMinutes: 60,
        activeWeekdays: [1, 2, 3, 4, 5],
        nextRunAt: at(2026, 8, 14, 21, 50),
      },
      at(2026, 8, 17, 0, 0),
      at(2026, 8, 17, 23, 59),
    )

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]?.times[0]).toBe(at(2026, 8, 17, 23, 50))
    expect(occurrences[0]?.count).toBe(1)
  })
})
