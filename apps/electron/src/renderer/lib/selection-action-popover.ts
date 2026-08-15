export interface SelectionActionPopoverPointer {
  x: number
  y: number
}

export interface SelectionActionPopoverRangeRect {
  left: number
  width: number
  top: number
}

const SELECTION_ACTION_POPOVER_OFFSET = 12
const MIN_SELECTION_ACTION_POPOVER_ANCHOR_Y = 52

/** 鼠标选区使用释放位置，键盘选区回退到 Range 的可见矩形。 */
export function getSelectionActionPopoverPosition(
  pointer: SelectionActionPopoverPointer | null,
  rangeRect: SelectionActionPopoverRangeRect,
): SelectionActionPopoverPointer {
  if (pointer) {
    return {
      x: pointer.x,
      // 弹框向上展开；顶部选区仍保留足够空间显示完整弹框。
      y: Math.max(MIN_SELECTION_ACTION_POPOVER_ANCHOR_Y, pointer.y - SELECTION_ACTION_POPOVER_OFFSET),
    }
  }

  return {
    x: rangeRect.left + rangeRect.width / 2,
    y: Math.max(SELECTION_ACTION_POPOVER_OFFSET, rangeRect.top - SELECTION_ACTION_POPOVER_OFFSET),
  }
}
