import type { Todo } from '@proma/shared'

function isSameTodo(current: Todo, incoming: Todo): boolean {
  if (current === incoming) return true
  // 关联的标签、分组或原生来源可在 Todo 自身 updatedAt 不变时更新；不能只比较版本号。
  return current.updatedAt === incoming.updatedAt && JSON.stringify(current) === JSON.stringify(incoming)
}

/** 与 planning-manager 的 listTodos 查询排序保持一致。 */
function compareTodos(left: Todo, right: Todo): number {
  const statusOrder = (todo: Todo): number => todo.status === 'open' ? 0 : 1
  const statusDifference = statusOrder(left) - statusOrder(right)
  if (statusDifference !== 0) return statusDifference

  const leftDueAt = left.dueAt
  const rightDueAt = right.dueAt
  if (leftDueAt === undefined) return rightDueAt === undefined ? right.updatedAt - left.updatedAt : 1
  if (rightDueAt === undefined) return -1
  return leftDueAt - rightDueAt || right.updatedAt - left.updatedAt
}

/**
 * 将全量快照合并进现有状态，保留未变化 Todo 的引用以避免列表行无关重渲染。
 */
export function mergeTodoSnapshot(current: Todo[], snapshot: Todo[]): Todo[] {
  const currentById = new Map(current.map((todo) => [todo.id, todo]))
  const merged = snapshot.map((incoming) => {
    const existing = currentById.get(incoming.id)
    return existing && isSameTodo(existing, incoming) ? existing : incoming
  })
  return merged.length === current.length && merged.every((todo, index) => todo === current[index]) ? current : merged
}

/** 将单个 Todo 更新合并到本地列表，并保持与持久层一致的排序和其余对象引用。 */
export function upsertTodo(current: Todo[], incoming: Todo): Todo[] {
  const index = current.findIndex((todo) => todo.id === incoming.id)
  if (index < 0) return [...current, incoming].sort(compareTodos)
  const existing = current[index]
  if (!existing || isSameTodo(existing, incoming)) return current
  const next = [...current]
  next[index] = incoming
  return next.sort(compareTodos)
}
