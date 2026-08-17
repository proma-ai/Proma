import type { TodoStatus } from '@proma/shared'

export type TodoListView = 'all' | 'today' | 'upcoming' | 'completed' | `group:${string}`

export interface TodoViewItem {
  id: string
  status: TodoStatus
  dueAt?: number
  groupId?: string
}

export function selectVisibleTodos<T extends TodoViewItem>(
  todos: T[],
  view: TodoListView,
  todayEnd: number,
  weekEnd: number,
  recentlyCompletedIds: ReadonlySet<string> = new Set(),
): T[] {
  const isRecentlyCompleted = (todo: T): boolean => recentlyCompletedIds.has(todo.id)
  if (view === 'all') return todos.filter((todo) => todo.status === 'open' || isRecentlyCompleted(todo))
  if (view === 'today') return todos.filter((todo) => (todo.status === 'open' && todo.dueAt !== undefined && todo.dueAt <= todayEnd) || isRecentlyCompleted(todo))
  if (view === 'upcoming') return todos.filter((todo) => todo.status === 'open' && todo.dueAt !== undefined && todo.dueAt > todayEnd && todo.dueAt <= weekEnd)
  if (view === 'completed') return todos.filter((todo) => todo.status === 'completed')
  const groupId = view.slice('group:'.length)
  return todos.filter((todo) => (todo.status === 'open' || isRecentlyCompleted(todo)) && todo.groupId === groupId)
}
