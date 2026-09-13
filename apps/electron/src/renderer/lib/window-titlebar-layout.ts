export const WINDOW_TITLEBAR_HEIGHT_PX = 32
export const WINDOW_TITLEBAR_CONTROL_COUNT = 3
export const WINDOW_TITLEBAR_CONTROL_WIDTH_PX = 46
export const WINDOW_TITLEBAR_CONTROLS_WIDTH_PX = WINDOW_TITLEBAR_CONTROL_COUNT * WINDOW_TITLEBAR_CONTROL_WIDTH_PX

export function getWindowTitlebarContentInsetClass(isWindows: boolean): string {
  return isWindows ? 'pt-8' : ''
}

export function getWindowTitlebarDragInsetStyle(isWindows: boolean): { right: number } {
  return { right: isWindows ? WINDOW_TITLEBAR_CONTROLS_WIDTH_PX : 0 }
}

interface SidebarTitlebarLayoutInput {
  isMac: boolean
  isWindows: boolean
  zoomFactor: number
  sidebarOccupiedWidth: number
}

interface SidebarTitlebarLayout {
  toggleLeft: number
  searchLeft: number
  controlsEnd: number
  toggleTop: number
  toggleScale: number
  titlebarHeight: number
  sidebarTopInset: number
  mainLeadingInset: number
}

/** 红绿灯位于原生窗口的 (18, 18)，按钮高度 14；垂直中心为 25px。 */
export function getSidebarTitlebarLayout({
  isMac,
  isWindows,
  zoomFactor,
  sidebarOccupiedWidth,
}: SidebarTitlebarLayoutInput): SidebarTitlebarLayout {
  const safeZoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  // 使用页面 zoom，而不是包含屏幕 DPI 的 devicePixelRatio，保证跨显示器移动时仍对齐。
  const toggleScale = isMac ? 1 / safeZoom : 1
  const toggleLeft = (isMac ? 90 : 12) * toggleScale
  // 两个 28px 热区之间留 4px，搜索右侧再留 12px 给标题和拖拽区域。
  const searchLeft = toggleLeft + 32 * toggleScale
  const controlsEnd = searchLeft + 40 * toggleScale
  const toggleTop = (isWindows ? 2 : isMac ? 11 : 10) * toggleScale
  const titlebarHeight = (isMac ? 50 : 48) * toggleScale

  return {
    toggleLeft,
    searchLeft,
    controlsEnd,
    toggleTop,
    toggleScale,
    titlebarHeight,
    sidebarTopInset: isWindows ? 8 : titlebarHeight,
    mainLeadingInset: isWindows ? 0 : Math.max(0, controlsEnd - sidebarOccupiedWidth),
  }
}
