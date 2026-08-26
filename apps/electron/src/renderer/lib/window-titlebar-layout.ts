export const WINDOW_TITLEBAR_HEIGHT_PX = 32
export const WINDOW_TITLEBAR_CONTROLS_WIDTH_PX = 138

export function getWindowTitlebarContentInsetClass(isWindows: boolean): string {
  return isWindows ? 'pt-8' : ''
}

export function getWindowTitlebarDragInsetClass(isWindows: boolean): string {
  return isWindows ? 'right-[138px]' : 'right-0'
}
