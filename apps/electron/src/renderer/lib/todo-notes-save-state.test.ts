import { describe, expect, test } from 'bun:test'
import { getVisibleTodoNotesSaveState } from './todo-notes-save-state'

describe('Todo notes save state', () => {
  test('shows save state only for the selected Todo', () => {
    expect(getVisibleTodoNotesSaveState('saving', 'todo-a', 'todo-a')).toBe('saving')
    expect(getVisibleTodoNotesSaveState('saved', 'todo-a', 'todo-a')).toBe('saved')
  })

  test('hides save state that belongs to a previously selected Todo', () => {
    expect(getVisibleTodoNotesSaveState('saving', 'todo-a', 'todo-b')).toBeNull()
    expect(getVisibleTodoNotesSaveState('saved', 'todo-a', null)).toBeNull()
  })
})
