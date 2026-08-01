import { describe, expect, test } from 'bun:test'
import { getAgentIslandTodoAttentionKeys, selectAgentIslandTodos } from './agent-island-planning'

describe('Agent Island Todo 投影', () => {
  const now = Date.UTC(2026, 7, 1, 6, 0, 0)

  test('优先展示逾期待办，并保留后续事项', () => {
    const todos = [
      { id: 'later', dueAt: now + 2 * 60 * 60_000 },
      { id: 'overdue-old', dueAt: now - 2 * 60 * 60_000 },
      { id: 'soon', dueAt: now + 30 * 60_000 },
      { id: 'overdue-recent', dueAt: now - 15 * 60_000 },
    ]

    expect(selectAgentIslandTodos(todos, now).map((todo) => todo.id))
      .toEqual(['overdue-old', 'overdue-recent', 'soon'])
  })

  test('逾期与一小时内到期的事项都会驱动 Island 提醒', () => {
    const todos = [
      { id: 'overdue', dueAt: now - 1 },
      { id: 'imminent', dueAt: now + 60 * 60_000 },
      { id: 'later', dueAt: now + 60 * 60_000 + 1 },
      { id: 'unscheduled' },
    ]

    expect(getAgentIslandTodoAttentionKeys(todos, now, 60 * 60_000))
      .toEqual([`t:overdue:${now - 1}`, `t:imminent:${now + 60 * 60_000}`])
  })
})
