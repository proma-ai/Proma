/**
 * 将地址栏内容限定为可安全交给系统默认浏览器的 HTTP(S) 地址。
 * 搜索词、内部页面和其他协议仍留在受管浏览器内处理。
 */
export function resolveExternalBrowserUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}
