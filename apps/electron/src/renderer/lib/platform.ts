/**
 * Windows 自定义 WindowControls 按钮区域总宽度（3 buttons × ~42px）。
 * 拖拽层和内容区需避让此宽度，防止 OS hitmask 冲突。
 */
export const WINDOW_CONTROLS_WIDTH_PX = 126
export const WINDOW_CONTROLS_INSET_RIGHT = 'right-[126px]'
export const WINDOW_CONTROLS_PADDING_RIGHT = 'pr-[126px]'

export function detectIsWindows(): boolean {
  const platform =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.toLowerCase().includes('win')) {
    return true
  }
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform || '')
}

export function detectIsMac(): boolean {
  const platform =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.toLowerCase().includes('mac')) {
    return true
  }
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')
}
