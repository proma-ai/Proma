export interface HorizontalScrollViewport {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

export interface HorizontalTabBounds {
  offsetLeft: number
  offsetWidth: number
}

/**
 * 返回让 Tab 完整出现在横向滚动视口中的目标 scrollLeft。
 * Tab 宽度大于视口时优先展示其起始位置。
 */
export function getScrollLeftToRevealTab(
  viewport: HorizontalScrollViewport,
  tab: HorizontalTabBounds,
): number {
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
  const tabRight = tab.offsetLeft + tab.offsetWidth

  if (tab.offsetWidth >= viewport.clientWidth || tab.offsetLeft < viewport.scrollLeft) {
    return Math.min(Math.max(0, tab.offsetLeft), maxScrollLeft)
  }

  const viewportRight = viewport.scrollLeft + viewport.clientWidth
  if (tabRight > viewportRight) {
    return Math.min(tabRight - viewport.clientWidth, maxScrollLeft)
  }

  return viewport.scrollLeft
}
