/**
 * 将浏览器选区中的链接限制为可由系统浏览器安全打开的 Web URL。
 * Electron 主进程也会再次校验协议；这里用于决定是否展示选区操作。
 */
export function getSafeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
