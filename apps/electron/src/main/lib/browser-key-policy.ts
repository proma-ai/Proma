const NAVIGATION_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

const MAX_BROWSER_TEXT_LENGTH = 10_000

export type BrowserPressAction =
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string }

/**
 * BrowserPress 保留导航键语义；其他文本整体走 Input.insertText。
 * 这让已聚焦的 input、textarea 或 contenteditable 可以一次输入完整消息，
 * 并避开 CDP 对空格、标点和 Unicode key event 的平台差异。
 */
export function parseBrowserPressAction(input: string): BrowserPressAction {
  if (NAVIGATION_KEYS.has(input)) return { kind: 'key', key: input }
  if (input === 'Space') return { kind: 'text', text: ' ' }
  if (!input) throw new Error('BrowserPress 需要导航键或非空文本。')
  if (input.length > MAX_BROWSER_TEXT_LENGTH) throw new Error(`单次输入不能超过 ${MAX_BROWSER_TEXT_LENGTH} 个字符。`)
  // Input.insertText 支持换行；其他控制字符不应被传给网页输入控件。
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(input)) throw new Error('输入文本包含不支持的控制字符。')
  return { kind: 'text', text: input }
}
