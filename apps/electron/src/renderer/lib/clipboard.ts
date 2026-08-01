type ClipboardWriter = (text: string) => Promise<void>

interface ClipboardWriters {
  native?: ClipboardWriter
  browser?: ClipboardWriter
}

function getNativeClipboardWriter(): ClipboardWriter | undefined {
  if (typeof window === 'undefined') return undefined
  return window.electronAPI?.writeClipboardText
}

function getBrowserClipboardWriter(): ClipboardWriter | undefined {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return undefined
  return (text) => navigator.clipboard.writeText(text)
}

/** 优先使用 Electron 主进程，确保 Windows 上不受 renderer 剪贴板权限影响。 */
export async function copyTextToClipboard(
  content: string,
  writers: ClipboardWriters = {
    native: getNativeClipboardWriter(),
    browser: getBrowserClipboardWriter(),
  }
): Promise<void> {
  if (writers.native) {
    try {
      await writers.native(content)
      return
    } catch (error) {
      console.warn('[Clipboard] 主进程复制失败，尝试 renderer 剪贴板:', error)
    }
  }

  if (!writers.browser) {
    throw new Error('当前环境不支持写入剪贴板')
  }
  await writers.browser(content)
}
