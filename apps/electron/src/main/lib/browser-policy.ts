/** 受管浏览器的 URL 规范化与合法性校验；保持无 Electron 依赖，便于在普通 Bun 测试中验证。 */

const GOOGLE_SEARCH_URL = 'https://www.google.com/search'
const USER_NEW_TAB_URL = 'https://www.google.com/'

function isLoopbackAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  if (ipv6 === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return Number(match?.[1]) === 127
}

function isLocalNetworkAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (isLoopbackAddress(host) || host.endsWith('.local')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  if (ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe8') || ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb')) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const a = Number(match[1] ?? 0)
  const b = Number(match[2] ?? 0)
  return a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * 地址栏可直接输入域名或路径（例如 `example.com/docs`）；缺省协议时按 HTTPS 打开。
 * 受管浏览器不再按网络地址、协议或 URL 认证信息设置访问限制，具体协议支持由 Chromium 决定。
 */
export function normalizeBrowserUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('浏览器地址不能为空。')
  // 协议相对 URL 按 HTTPS 处理，和无协议域名保持一致。
  if (value.startsWith('//')) return `https:${value}`
  // `localhost:3000` 和 `example.com:8080` 是没有协议的常见地址栏输入，不能被误判为 scheme。
  if (/^[^/?#:\s]+:\d+(?:[/?#]|$)/.test(value)) {
    const localCandidate = new URL(`http://${value}`)
    // 本机和局域网开发服务通常未配置 TLS；其他地址仍默认 HTTPS。
    return isLocalNetworkAddress(localCandidate.hostname) ? `http://${value}` : `https://${value}`
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return value
  // `localhost` / `app.localhost` 没有端口时同样按 HTTP 打开。
  try {
    const localCandidate = new URL(`http://${value}`)
    if (isLocalNetworkAddress(localCandidate.hostname)) return `http://${value}`
  } catch { /* 交由后续 URL 校验输出统一错误 */ }
  return `https://${value}`
}

/** 仅拒绝空值或无法被 URL 标准解析的输入；不限制目标网络、协议或认证信息。 */
export function assertSafeBrowserUrl(input: string): string {
  const normalized = normalizeBrowserUrl(input)
  try {
    return new URL(normalized).toString()
  } catch {
    throw new Error('浏览器地址无效。')
  }
}

/**
 * popup 的首次 URL 由 Chromium 在 window.open() 同步创建时处理。
 * about:blank、blob:、data: 只在首次 popup 创建时允许，以支持 OAuth 中转页和页面内生成的预览。
 */
export function isSupportedBrowserPopupUrl(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (value === 'about:blank' || /^(?:blob:|data:)/i.test(value)) return true
  try {
    assertSafeBrowserUrl(value)
    return true
  } catch {
    return false
  }
}

export function isTransientBrowserPopupUrl(input: string): boolean {
  const value = input.trim()
  return value === 'about:blank' || /^(?:blob:|data:)/i.test(value)
}

/**
 * 判断受管浏览器里触发的下载地址是否可解析。
 * blob: / data: 是页面内存资源；HTTP(S) 和其他可解析地址交给 Chromium 处理。
 */
export async function assertSafeBrowserDownloadUrl(input: string): Promise<string> {
  const value = input.trim()
  if (!value) throw new Error('下载地址为空。')
  if (/^(?:blob:|data:)/i.test(value)) return value
  return assertSafeBrowserDestination(value)
}

function isLikelyUrl(value: string): boolean {
  if (value.startsWith('//') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return true
  if (/\s/.test(value)) return false

  try {
    const candidate = new URL(`http://${value}`)
    const hostname = candidate.hostname.toLowerCase()
    return hostname.includes('.') || isLocalNetworkAddress(hostname)
  } catch {
    return false
  }
}

/**
 * 把地址栏/BrowserNavigate 输入解析成 URL 或 Google 搜索地址。
 * 明确的 URL 和可识别的主机名保持直达，普通文本按搜索词处理。
 */
export function resolveBrowserDestination(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('浏览器地址或搜索内容不能为空。')
  if (isLikelyUrl(value)) return normalizeBrowserUrl(value)
  return `${GOOGLE_SEARCH_URL}?q=${encodeURIComponent(value)}`
}

/**
 * 仅拒绝空值或无法被 URL 标准解析的输入；搜索词会先被转换为 Google 搜索 URL。
 */
export async function assertSafeBrowserDestination(input: string): Promise<string> {
  const resolved = resolveBrowserDestination(input)
  try {
    return new URL(resolved).toString()
  } catch {
    throw new Error('浏览器地址或搜索内容无效。')
  }
}

export { GOOGLE_SEARCH_URL, USER_NEW_TAB_URL }
