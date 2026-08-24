/**
 * Hover Popover 关闭时不要让 Radix 自动把焦点移回触发按钮。
 *
 * 这类 Popover 在纯 hover 打开时不会夺走输入框焦点，因此无需在关闭时恢复焦点；
 * 默认恢复反而会让一次纯鼠标 hover 留下按钮的 focus-visible 聚焦环。
 * 若用户已经通过键盘进入 Popover，则仍允许 Radix 恢复焦点，避免焦点落到被卸载的节点。
 */
export function preventHoverPopoverFocusRestore(event: Event, focusWasInsidePopover: boolean): void {
  if (!focusWasInsidePopover) event.preventDefault()
}
