import type { MainWindowState } from '../../types'

export interface WindowBounds {
  width: number
  height: number
  x: number
  y: number
}

export interface WindowWorkArea {
  width: number
  height: number
  x: number
  y: number
}

export interface WindowDisplayLike {
  workArea: WindowWorkArea
}

export interface NormalizeWindowBoundsOptions {
  minWidth?: number
  minHeight?: number
  fallbackWidth?: number
  fallbackHeight?: number
}

export interface MainWindowStateReadable {
  isDestroyed(): boolean
  isMaximized(): boolean
  isFullScreen(): boolean
  getBounds(): WindowBounds
  getNormalBounds(): WindowBounds
}

export interface MacCloseWindowController {
  isDestroyed(): boolean
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  once(event: 'leave-full-screen', listener: () => void): void
  hide(): void
}

export interface MacCloseAppController {
  hide(): void
}

export type ScheduleFn = (callback: () => void, delayMs: number) => unknown

const FULL_SCREEN_HIDE_DELAY_MS = 160
const FULL_SCREEN_HIDE_FALLBACK_DELAY_MS = 1000

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isUsableArea(area: WindowWorkArea | undefined): area is WindowWorkArea {
  return !!area
    && isFiniteNumber(area.x)
    && isFiniteNumber(area.y)
    && isFiniteNumber(area.width)
    && isFiniteNumber(area.height)
    && area.width > 0
    && area.height > 0
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

function sanitizeDimension(value: number, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) return Math.max(1, Math.round(fallback))
  return Math.max(1, Math.round(value))
}

function intersectionArea(bounds: WindowBounds, area: WindowWorkArea): number {
  const left = Math.max(bounds.x, area.x)
  const right = Math.min(bounds.x + bounds.width, area.x + area.width)
  const top = Math.max(bounds.y, area.y)
  const bottom = Math.min(bounds.y + bounds.height, area.y + area.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function containsWindowCenter(bounds: WindowBounds, area: WindowWorkArea): boolean {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return centerX >= area.x
    && centerX <= area.x + area.width
    && centerY >= area.y
    && centerY <= area.y + area.height
}

export function normalizeWindowBoundsToVisibleArea(
  bounds: WindowBounds,
  displays: readonly WindowDisplayLike[],
  primaryDisplay: WindowDisplayLike,
  options: NormalizeWindowBoundsOptions = {},
): WindowBounds {
  const areas = displays.map((display) => display.workArea).filter(isUsableArea)
  const fallbackArea = isUsableArea(primaryDisplay.workArea)
    ? primaryDisplay.workArea
    : areas[0] ?? { x: 0, y: 0, width: options.fallbackWidth ?? 1400, height: options.fallbackHeight ?? 900 }

  const safeBounds: WindowBounds = {
    width: sanitizeDimension(bounds.width, options.fallbackWidth ?? fallbackArea.width),
    height: sanitizeDimension(bounds.height, options.fallbackHeight ?? fallbackArea.height),
    x: isFiniteNumber(bounds.x) ? Math.round(bounds.x) : fallbackArea.x,
    y: isFiniteNumber(bounds.y) ? Math.round(bounds.y) : fallbackArea.y,
  }

  const centeredArea = areas.find((area) => containsWindowCenter(safeBounds, area))
  let targetArea = centeredArea ?? fallbackArea
  let shouldCenter = !centeredArea

  if (!centeredArea) {
    let bestOverlap = 0
    for (const area of areas) {
      const overlap = intersectionArea(safeBounds, area)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        targetArea = area
      }
    }
    shouldCenter = bestOverlap <= 0
  }

  const areaWidth = Math.max(1, Math.round(targetArea.width))
  const areaHeight = Math.max(1, Math.round(targetArea.height))
  const minWidth = Math.min(areaWidth, Math.max(1, Math.round(options.minWidth ?? 1)))
  const minHeight = Math.min(areaHeight, Math.max(1, Math.round(options.minHeight ?? 1)))
  const width = Math.min(areaWidth, Math.max(minWidth, safeBounds.width))
  const height = Math.min(areaHeight, Math.max(minHeight, safeBounds.height))

  if (shouldCenter) {
    return {
      width,
      height,
      x: Math.round(targetArea.x + (areaWidth - width) / 2),
      y: Math.round(targetArea.y + (areaHeight - height) / 2),
    }
  }

  return {
    width,
    height,
    x: clamp(safeBounds.x, targetArea.x, targetArea.x + areaWidth - width),
    y: clamp(safeBounds.y, targetArea.y, targetArea.y + areaHeight - height),
  }
}

/**
 * 全屏/最大化状态下只保存普通窗口 bounds，避免把全屏 Space 尺寸写入配置。
 */
export function getPersistableMainWindowState(win: MainWindowStateReadable): MainWindowState | null {
  if (win.isDestroyed()) return null

  const isMaximized = win.isMaximized()
  const bounds = (isMaximized || win.isFullScreen()) ? win.getNormalBounds() : win.getBounds()
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized,
  }
}

export function hideMacMainWindowAfterClose(
  win: MacCloseWindowController,
  app: MacCloseAppController,
  schedule: ScheduleFn = setTimeout,
): void {
  let didHide = false
  const hideWindowAndApp = (): void => {
    if (didHide) return
    if (win.isDestroyed()) return
    didHide = true
    win.hide()
    app.hide()
  }

  if (!win.isFullScreen()) {
    hideWindowAndApp()
    return
  }

  win.once('leave-full-screen', () => {
    schedule(hideWindowAndApp, FULL_SCREEN_HIDE_DELAY_MS)
  })
  win.setFullScreen(false)
  schedule(hideWindowAndApp, FULL_SCREEN_HIDE_FALLBACK_DELAY_MS)
}
