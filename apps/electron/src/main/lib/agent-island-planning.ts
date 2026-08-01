/**
 * Agent Island 的 Todo 投影规则。
 *
 * 保持为纯函数，使提醒优先级能在不启动 Electron 主进程的情况下回归测试：
 * 逾期待办必须优先于未来事项，并且两者都能驱动 Island 唤起。
 */
export interface AgentIslandPlanningTodoInput {
  id: string
  dueAt?: number
}

/** 将逾期待办优先排在未来事项之前，最多展示 limit 项。 */
export function selectAgentIslandTodos<T extends AgentIslandPlanningTodoInput>(
  todos: readonly T[],
  now: number,
  limit = 3,
): T[] {
  const withDueAt = todos.filter((todo): todo is T & { dueAt: number } => todo.dueAt !== undefined)
  const byDueAt = (a: T & { dueAt: number }, b: T & { dueAt: number }): number => a.dueAt - b.dueAt
  const overdue = withDueAt.filter((todo) => todo.dueAt < now).sort(byDueAt)
  const upcoming = withDueAt.filter((todo) => todo.dueAt >= now).sort(byDueAt)
  return [...overdue, ...upcoming].slice(0, limit)
}

/** 逾期或即将在 attentionWindowMs 内到期的 Todo 都应让 Island 保持可见。 */
export function getAgentIslandTodoAttentionKeys<T extends AgentIslandPlanningTodoInput>(
  todos: readonly T[],
  now: number,
  attentionWindowMs: number,
): string[] {
  return todos
    .filter((todo): todo is T & { dueAt: number } => todo.dueAt !== undefined)
    .filter((todo) => todo.dueAt < now || todo.dueAt <= now + attentionWindowMs)
    .map((todo) => `t:${todo.id}:${todo.dueAt}`)
}
