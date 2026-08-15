/**
 * 计算顶部 prepend 历史消息后的滚动位置，保持原先可见内容的屏幕位置。
 */
export function getScrollTopAfterPrepend(
  currentScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
): number {
  return currentScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight)
}
