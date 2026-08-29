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
