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

export interface WindowBoundsController {
  isMaximized(): boolean
  isFullScreen(): boolean
  getBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
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

/**
 * 规范化用于“创建窗口”的持久化 bounds。
 *
 * 仅在窗口与所有当前显示器完全没有交叠时恢复到主屏；仍有任意可见像素时
 * 原样保留，以免破坏用户有意横跨多块屏幕摆放的普通窗口。
 */
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

  if (areas.some((area) => intersectionArea(safeBounds, area) > 0)) return safeBounds

  const areaWidth = Math.max(1, Math.round(fallbackArea.width))
  const areaHeight = Math.max(1, Math.round(fallbackArea.height))
  const minWidth = Math.min(areaWidth, Math.max(1, Math.round(options.minWidth ?? 1)))
  const minHeight = Math.min(areaHeight, Math.max(1, Math.round(options.minHeight ?? 1)))
  const width = Math.min(areaWidth, Math.max(minWidth, safeBounds.width))
  const height = Math.min(areaHeight, Math.max(minHeight, safeBounds.height))

  return {
    width,
    height,
    x: Math.round(fallbackArea.x + (areaWidth - width) / 2),
    y: Math.round(fallbackArea.y + (areaHeight - height) / 2),
  }
}

/**
 * 确保已创建的普通窗口仍可见。最大化/全屏窗口的 bounds 是平台相关的系统值：
 * Windows 会包含不可见边框，macOS 全屏会包含菜单栏，因此绝不主动覆盖。
 */
export function ensureWindowBoundsVisible(
  win: WindowBoundsController,
  displays: readonly WindowDisplayLike[],
  primaryDisplay: WindowDisplayLike,
  options: NormalizeWindowBoundsOptions = {},
): boolean {
  if (win.isMaximized() || win.isFullScreen()) return false

  const currentBounds = win.getBounds()
  const nextBounds = normalizeWindowBoundsToVisibleArea(currentBounds, displays, primaryDisplay, options)
  if (
    nextBounds.x === currentBounds.x
    && nextBounds.y === currentBounds.y
    && nextBounds.width === currentBounds.width
    && nextBounds.height === currentBounds.height
  ) return false

  win.setBounds(nextBounds)
  return true
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
