import type { MainWindowState } from '../../types'

interface WindowBounds {
  width: number
  height: number
  x: number
  y: number
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
