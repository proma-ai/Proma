export type TodoNotesSaveState = 'saving' | 'saved' | null

export function getVisibleTodoNotesSaveState(
  state: TodoNotesSaveState,
  stateTodoId: string | null,
  selectedTodoId: string | null | undefined,
): TodoNotesSaveState {
  return stateTodoId && stateTodoId === selectedTodoId ? state : null
}
