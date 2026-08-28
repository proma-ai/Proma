/**
 * 代理 Fetch 工具
 *
 * 基于 undici ProxyAgent 创建支持 HTTP 代理的 fetch 函数。
 * 用于渠道配置了代理地址时，让 AI API 请求走指定代理。
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { Dispatcher, RequestInfo, RequestInit } from 'undici'

export interface ManagedProxyFetch {
  fetch: typeof globalThis.fetch
  close: () => Promise<void>
}

/**
 * 创建可释放的请求级代理 fetch。短生命周期操作（例如 MCP 验证）必须在 finally
 * 调用 close，长期 MCP 连接则由 connection 生命周期持有并在 close 时释放。
 */
export function createManagedProxyFetch(proxyUrl?: string): ManagedProxyFetch {
  const normalizedProxyUrl = proxyUrl?.trim()
  if (!normalizedProxyUrl) return { fetch, close: async () => undefined }

  const dispatcher = new ProxyAgent(normalizedProxyUrl)
  return {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      return undiciFetch(input as RequestInfo, { ...init, dispatcher })
    }) as unknown as typeof globalThis.fetch,
    close: async () => {
      await (dispatcher as Dispatcher & { close?: () => Promise<void> }).close?.().catch(() => undefined)
    },
  }
}

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
