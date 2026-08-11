/** 受管浏览器的纯 URL 边界；保持无 Electron 依赖，便于在普通 Bun 测试中验证。 */
import { lookup } from 'node:dns/promises'

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '')
  // IPv6 loopback/unspecified、IPv4-mapped、ULA、link-local 与 multicast 都不能作为
  // 受管浏览器的网络目的地。对 IPv4-mapped 地址一律拒绝，避免映射后绕过 IPv4 私网段判断。
  if (ipv6 === '::' || ipv6 === '::1' || ipv6.startsWith('::ffff:') || ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe8') || ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb') || ipv6.startsWith('ff')) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const a = Number(match[1] ?? 0)
  const b = Number(match[2] ?? 0)
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0 || a >= 224
}

export function assertSafeBrowserUrl(input: string): string {
  let parsed: URL
  try { parsed = new URL(input) } catch { throw new Error('浏览器只接受完整的 HTTP/HTTPS URL。') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('受管浏览器不允许此 URL 协议。')
  if (parsed.username || parsed.password || isPrivateAddress(parsed.hostname)) throw new Error('受管浏览器不允许访问本机、私网或带认证信息的 URL。')
  return parsed.toString()
}

/**
 * 导航/请求开始前再次解析域名并拒绝落到非公网地址的结果。
 * Chromium 仍是最终网络栈；完整 DNS-rebinding 防护需要后续接入受控 egress proxy，
 * 但这个 guard 可以阻断当前解析即指向私网的常见攻击路径。
 */
export async function assertSafeBrowserDestination(input: string): Promise<string> {
  const safeUrl = assertSafeBrowserUrl(input)
  const hostname = new URL(safeUrl).hostname
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('受管浏览器拒绝访问解析到本机或私网的地址。')
  }
  return safeUrl
}
