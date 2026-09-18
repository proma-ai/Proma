export const AUTO_BROWSER_ZOOM_FACTORS = [1, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5] as const
export const MAX_AUTO_BROWSER_ZOOM_PASSES = AUTO_BROWSER_ZOOM_FACTORS.length

export interface BrowserPageWidthMeasurement {
  pageWidth: number
  intrinsicPageWidth?: number
}

/** 只接受 documentElement 的 viewport；innerWidth/body 仅用于浏览器兼容性兜底。 */
export function resolveBrowserLayoutViewportWidth(rootClientWidth: number, innerWidth: number, bodyClientWidth: number): number {
  return [rootClientWidth, innerWidth, bodyClientWidth].find((value) => Number.isFinite(value) && value > 0) ?? 0
}

/**
 * scrollWidth 在无溢出时会被 layout viewport clamp。固定宽 body 是一个可靠的固有宽度候选：
 * 当 body 宽小于 documentElement viewport 时，不使用被 clamp 的 root scrollWidth。
 */
export function resolveBrowserPageWidth(rootScrollWidth: number, bodyScrollWidth: number, layoutViewportWidth: number): BrowserPageWidthMeasurement {
  const rootWidth = Number.isFinite(rootScrollWidth) && rootScrollWidth > 0 ? rootScrollWidth : 0
  const bodyWidth = Number.isFinite(bodyScrollWidth) && bodyScrollWidth > 0 ? bodyScrollWidth : 0
  const viewportWidth = Number.isFinite(layoutViewportWidth) && layoutViewportWidth > 0 ? layoutViewportWidth : 0
  if (!rootWidth && !bodyWidth) return { pageWidth: 0 }
  if (bodyWidth && viewportWidth && bodyWidth < viewportWidth - 1 && rootWidth <= viewportWidth + 1) {
    return { pageWidth: bodyWidth, intrinsicPageWidth: bodyWidth }
  }
  return { pageWidth: Math.max(rootWidth, bodyWidth) }
}

export interface BrowserAutoZoomMeasurement {
  /** 当前页面在自身 CSS 坐标系中的完整滚动宽度。 */
  pageWidth: number
  /** WebContentsView 的原生逻辑像素宽度；与 setBounds 的 width 相同。 */
  viewportWidth: number
  /** 当前页面 zoom factor。 */
  currentZoom: number
  /** 当前页面 CSS layout viewport 宽度（优先 documentElement.clientWidth）。 */
  layoutViewportWidth: number
  /** 同一文档先前测得的固有内容宽度。 */
  intrinsicPageWidth?: number
}

/**
 * 从当前页面测量值选择 100% 至 50% 的自动缩放档位。
 *
 * Chromium 会随 page zoom 改变 CSS layout viewport。页面没有横向溢出时，scrollWidth
 * 只等于扩大的 viewport，无法反推出固有内容宽度：优先复用此前测得的固有宽度；若尚无基线，
 * 每次只向上探测一个档位，最多经过 AUTO_BROWSER_ZOOM_FACTORS 的有限档位，不会无限复测。
 */
export function resolveAutoBrowserZoomFactor(measurement: BrowserAutoZoomMeasurement): number
export function resolveAutoBrowserZoomFactor(pageWidth: number, viewportWidth: number): number
export function resolveAutoBrowserZoomFactor(
  measurementOrPageWidth: BrowserAutoZoomMeasurement | number,
  legacyViewportWidth?: number,
): number {
  const measurement = typeof measurementOrPageWidth === 'number'
    ? {
        pageWidth: measurementOrPageWidth,
        viewportWidth: legacyViewportWidth ?? 0,
        currentZoom: 1,
        layoutViewportWidth: legacyViewportWidth ?? 0,
      }
    : measurementOrPageWidth
  const { pageWidth, viewportWidth, currentZoom, layoutViewportWidth, intrinsicPageWidth: cachedIntrinsicPageWidth } = measurement

  if (
    !Number.isFinite(pageWidth)
    || !Number.isFinite(viewportWidth)
    || !Number.isFinite(currentZoom)
    || !Number.isFinite(layoutViewportWidth)
    || pageWidth <= 0
    || viewportWidth <= 0
    || currentZoom <= 0
    || layoutViewportWidth <= 0
  ) return 1

  const pageIsViewportLimited = pageWidth <= layoutViewportWidth + 1
  const hasCachedIntrinsicWidth = Number.isFinite(cachedIntrinsicPageWidth) && (cachedIntrinsicPageWidth ?? 0) > 0
  if (pageIsViewportLimited && !hasCachedIntrinsicWidth) {
    const currentIndex = AUTO_BROWSER_ZOOM_FACTORS.findIndex((factor) => factor <= currentZoom + 0.001)
    // Unknown intrinsic width: one tier per measurement, with an explicit finite ceiling at 100%.
    return currentIndex <= 0 ? 1 : (AUTO_BROWSER_ZOOM_FACTORS[currentIndex - 1] ?? 1)
  }

  const intrinsicPageWidth = hasCachedIntrinsicWidth ? cachedIntrinsicPageWidth! : pageWidth
  if (intrinsicPageWidth <= viewportWidth) return 1

  const requiredFactor = viewportWidth / intrinsicPageWidth
  return AUTO_BROWSER_ZOOM_FACTORS.find((factor) => factor <= requiredFactor) ?? AUTO_BROWSER_ZOOM_FACTORS.at(-1)!
}
