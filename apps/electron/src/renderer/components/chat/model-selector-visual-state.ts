export type ModelSelectorOptionVisualState = 'idle' | 'highlighted' | 'selected'

/** 选中态优先于键盘或鼠标高亮，避免当前模型悬停时丢失选中标识。 */
export function getModelSelectorOptionVisualState(
  isSelected: boolean,
  isHighlighted: boolean,
): ModelSelectorOptionVisualState {
  if (isSelected) return 'selected'
  if (isHighlighted) return 'highlighted'
  return 'idle'
}
