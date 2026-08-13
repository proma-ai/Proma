/**
 * BrowserPress 的按键语义与键码。
 *
 * 导航键（PageDown / ArrowDown 等）通过 Chromium CDP 的 Input.dispatchKeyEvent
 * 派发时，必须携带 windowsVirtualKeyCode 才能被识别为真实按键并触发浏览器的
 * 默认行为（PageDown 滚动页面、Enter 提交表单、Tab 移动焦点等）。只传 key
 * 字符串时，Chromium 无法为非字符导航键推断虚拟键码，默认行为不会发生。
 */
export interface BrowserNavigationKeyCode {
  /** DOM KeyboardEvent.code，对导航键通常与 key 一致 */
  code: string
  /** Windows 虚拟键码（VK_*），Chromium 依赖它识别非字符导航键 */
  windowsVirtualKeyCode: number
}

const NAVIGATION_KEY_CODES: Record<string, BrowserNavigationKeyCode> = {
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
  Home: { code: 'Home', windowsVirtualKeyCode: 36 },
  End: { code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { code: 'PageDown', windowsVirtualKeyCode: 34 },
}

const MAX_BROWSER_TEXT_LENGTH = 10_000

export type BrowserPressAction =
  | { kind: 'key'; key: string; code: string; windowsVirtualKeyCode: number }
  | { kind: 'text'; text: string }

/**
 * BrowserPress 保留导航键语义；其他文本整体走 Input.insertText。
 * 这让已聚焦的 input、textarea 或 contenteditable 可以一次输入完整消息，
 * 并避开 CDP 对空格、标点和 Unicode key event 的平台差异。
 */
export function parseBrowserPressAction(input: string): BrowserPressAction {
  const keyCode = NAVIGATION_KEY_CODES[input]
  if (keyCode) return { kind: 'key', key: input, ...keyCode }
  if (input === 'Space') return { kind: 'text', text: ' ' }
  if (!input) throw new Error('BrowserPress 需要导航键或非空文本。')
  if (input.length > MAX_BROWSER_TEXT_LENGTH) throw new Error(`单次输入不能超过 ${MAX_BROWSER_TEXT_LENGTH} 个字符。`)
  // Input.insertText 支持换行；其他控制字符不应被传给网页输入控件。
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(input)) throw new Error('输入文本包含不支持的控制字符。')
  return { kind: 'text', text: input }
}
