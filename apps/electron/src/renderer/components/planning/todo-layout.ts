export type TodoWorkspaceLayoutMode = 'three-column' | 'two-column' | 'single-column'

/** 三栏同时保持可读性所需的容器宽度。 */
export const TODO_THREE_COLUMN_MIN_WIDTH = 840
/** 低于此宽度时，详情改为覆盖式全宽视图。 */
export const TODO_TWO_COLUMN_MIN_WIDTH = 600

export function getTodoWorkspaceLayoutMode(width: number): TodoWorkspaceLayoutMode {
  if (width >= TODO_THREE_COLUMN_MIN_WIDTH) return 'three-column'
  if (width >= TODO_TWO_COLUMN_MIN_WIDTH) return 'two-column'
  return 'single-column'
}
