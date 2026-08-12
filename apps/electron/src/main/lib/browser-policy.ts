/** 受管浏览器的纯 URL 边界；保持无 Electron 依赖，便于在普通 Bun 测试中验证。 */
import { lookup } from 'node:dns/promises'

/** 仅允许本机 loopback 用于本地开发；局域网与其他私网仍须隔离。 */
function isLoopbackAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  if (ipv6 === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return Number(match?.[1]) === 127
}

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (isLoopbackAddress(host)) return false
  if (host.endsWith('.local')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  // IPv6 unspecified、IPv4-mapped、ULA、link-local 与 multicast 都不能作为
  // 受管浏览器的网络目的地。IPv4-mapped 地址一律拒绝，避免映射后绕过 IPv4 私网段判断。
  if (ipv6 === '::' || ipv6.startsWith('::ffff:') || ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe8') || ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb') || ipv6.startsWith('ff')) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const a = Number(match[1] ?? 0)
  const b = Number(match[2] ?? 0)
  return a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0 || a >= 224
}

/**
 * 地址栏可直接输入域名或路径（例如 `example.com/docs`）；缺省协议时按 HTTPS 打开。
 * 显式协议仍按原安全策略校验，绝不把 `javascript:` / `//host` 等输入误当作域名。
 */
export function normalizeBrowserUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('浏览器地址不能为空。')
  if (value.startsWith('//')) throw new Error('浏览器地址必须使用 HTTP 或 HTTPS 协议。')
  // `localhost:3000` 和 `example.com:8080` 是没有协议的常见地址栏输入，不能被误判为 scheme。
  if (/^[^/?#:\s]+:\d+(?:[/?#]|$)/.test(value)) {
    const localCandidate = new URL(`http://${value}`)
    // 本机开发服务通常未配置 TLS；其他地址仍默认 HTTPS。
    return isLoopbackAddress(localCandidate.hostname) ? `http://${value}` : `https://${value}`
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return value
  // `localhost` / `app.localhost` 没有端口时同样按 HTTP 打开。
  try {
    const localCandidate = new URL(`http://${value}`)
    if (isLoopbackAddress(localCandidate.hostname)) return `http://${value}`
  } catch { /* 交由后续 URL 校验输出统一错误 */ }
  return `https://${value}`
}

export function assertSafeBrowserUrl(input: string): string {
  const normalized = normalizeBrowserUrl(input)
  let parsed: URL
  try { parsed = new URL(normalized) } catch { throw new Error('浏览器地址无效。请输入公共域名或完整的 HTTP/HTTPS URL。') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('受管浏览器不允许此 URL 协议。')
  if (parsed.username || parsed.password || isPrivateAddress(parsed.hostname)) throw new Error('受管浏览器仅允许访问公网或本机 loopback 地址；私网及带认证信息的 URL 不受支持。')
  return parsed.toString()
}

/**
 * 导航/请求开始前再次解析域名，并拒绝落到私网（本机 loopback 除外）的结果。
 * Chromium 仍是最终网络栈；完整 DNS-rebinding 防护需要后续接入受控 egress proxy，
 * 但这个 guard 可以阻断当前解析即指向局域网或其他私网的常见攻击路径。
 */
export async function assertSafeBrowserDestination(input: string): Promise<string> {
  const safeUrl = assertSafeBrowserUrl(input)
  const hostname = new URL(safeUrl).hostname
  // IPv6 字面量带方括号时，Node DNS lookup 不会将它当作地址；本机 loopback
  // 已在同步 URL 校验阶段允许，无需经过 DNS，避免误解析到其他地址。
  if (isLoopbackAddress(hostname)) return safeUrl
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('受管浏览器拒绝访问解析到私网的地址（本机 loopback 除外）。')
  }
  return safeUrl
}
