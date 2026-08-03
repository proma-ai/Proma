import { runWithPiRequestProxyScope } from './adapters/pi-request-proxy'
import { getEffectiveProxyUrl } from './proxy-settings-service'

// EnvHttpProxyAgent 以 URL hostname 匹配 IPv6；方括号形式才能正确匹配 http://[::1]/。
const LOOPBACK_NO_PROXY_HOSTS = ['localhost', '127.0.0.1', '[::1]']

export function readNoProxyEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // 与 EnvHttpProxyAgent 保持相同的 lowercase 优先级。
  const noProxy = env.no_proxy ?? env.NO_PROXY
  return noProxy?.trim() || undefined
}

/**
 * OAuth 的浏览器回调必须直接访问本地 loopback；保留用户已有的 NO_PROXY 规则并补齐它们。
 */
export function buildOAuthNoProxy(noProxy = readNoProxyEnvironment()): string {
  if (noProxy?.trim() === '*') return '*'

  const hosts = new Set(
    (noProxy ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  )
  for (const host of LOOPBACK_NO_PROXY_HOSTS) hosts.add(host)
  return [...hosts].join(',')
}

/**
 * 用 Proma 的全局代理配置执行一段 Pi OAuth 网络操作。
 *
 * Pi OAuth 内部使用全局 fetch；受管 scope 通过 AsyncLocalStorage 为该异步链路绑定
 * dispatcher，并在操作结束后关闭连接池。外部系统浏览器不属于此网络平面。
 */
export async function runWithOAuthProxyScope<T>(operation: () => Promise<T>): Promise<T> {
  return runWithPiRequestProxyScope({
    proxyUrl: await getEffectiveProxyUrl(),
    noProxy: buildOAuthNoProxy(),
  }, operation)
}
