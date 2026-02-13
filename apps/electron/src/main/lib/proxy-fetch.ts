/**
 * 代理 Fetch 工具
 *
 * 基于 undici ProxyAgent 创建支持 HTTP 代理的 fetch 函数。
 * 用于渠道配置了代理地址时，让 AI API 请求走指定代理。
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { RequestInfo, RequestInit } from 'undici'

/**
 * 创建代理 fetch 函数
 *
 * @param proxyUrl 代理地址（如 http://127.0.0.1:7890）
 * @returns 走代理的 fetch 函数，签名兼容全局 fetch
 */
export function createProxyFetch(proxyUrl: string): typeof globalThis.fetch {
  const dispatcher = new ProxyAgent(proxyUrl)

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    return undiciFetch(input as RequestInfo, {
      ...init,
      dispatcher,
    })
  }) as unknown as typeof globalThis.fetch
}

/**
 * 根据代理地址获取 fetch 函数
 *
 * 如果 proxyUrl 有值则返回代理 fetch，否则返回全局 fetch。
 */
export function getFetchFn(proxyUrl?: string): typeof globalThis.fetch {
  if (proxyUrl?.trim()) {
    return createProxyFetch(proxyUrl.trim())
  }
  return fetch
}
