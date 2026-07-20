/**
 * Pi runtime 的请求级 HTTP 代理。
 *
 * Pi 的程序化 SDK 不会执行 CLI 入口的 configureHttpDispatcher()。这里用
 * AsyncLocalStorage 为每次模型 provider stream 绑定 dispatcher，避免进程级环境变量
 * 或 setGlobalDispatcher() 在并发会话间串线。
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import {
  Client,
  EnvHttpProxyAgent,
  Pool,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInfo,
  type RequestInit,
} from 'undici'

const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000
const requestDispatcherStorage = new AsyncLocalStorage<Dispatcher>()
const originalFetch = globalThis.fetch
const ignoreUndiciDispatcherError = (_error: Error): void => {}
let proxyFetchInstalled = false

function withUndiciErrorListener<T extends Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, 'error', ignoreUndiciDispatcherError)
  }
  return dispatcher
}

function createUndiciClient(origin: string | URL, options: Client.Options): Client {
  return withUndiciErrorListener(new Client(origin, options))
}

function createUndiciOriginDispatcher(origin: string | URL, options: Pool.Options): Dispatcher {
  if (options.connections === 1) {
    return createUndiciClient(origin, options)
  }
  return withUndiciErrorListener(new Pool(origin, {
    ...options,
    factory: createUndiciClient,
  }))
}

/** 在首次 Pi 请求前安装全局 fetch 路由；非 Pi 上下文仍调用 Proma 原 fetch。 */
export function installPiRequestProxyFetch(): void {
  if (proxyFetchInstalled) return
  proxyFetchInstalled = true

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const dispatcher = requestDispatcherStorage.getStore()
    if (!dispatcher) return (originalFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(input, init)
    return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])
  }) as typeof globalThis.fetch
}

export interface PiRequestProxyOptions {
  proxyUrl?: string
  noProxy?: string
  httpIdleTimeoutMs?: number
}

/**
 * 为单个 Pi 请求创建 dispatcher。调用者必须在请求结束时 close()，以释放连接池。
 */
export function createPiRequestProxyDispatcher(options: PiRequestProxyOptions): Dispatcher | undefined {
  const proxyUrl = options.proxyUrl?.trim()
  if (!proxyUrl) return undefined

  const timeoutMs = options.httpIdleTimeoutMs ?? DEFAULT_HTTP_IDLE_TIMEOUT_MS
  const normalizedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
  return withUndiciErrorListener(new EnvHttpProxyAgent({
    httpProxy: proxyUrl,
    httpsProxy: proxyUrl,
    ...(options.noProxy !== undefined && { noProxy: options.noProxy }),
    allowH2: false,
    headersTimeout: normalizedTimeoutMs,
    bodyTimeout: normalizedTimeoutMs,
    clientFactory: createUndiciClient,
    factory: createUndiciOriginDispatcher,
  }))
}

/** 仅让当前异步链内的 Pi 网络请求使用其 dispatcher。 */
export function runWithPiRequestProxy<T>(dispatcher: Dispatcher | undefined, operation: () => T): T {
  if (!dispatcher) return operation()
  return requestDispatcherStorage.run(dispatcher, operation)
}

/** 用于测试及诊断：不会暴露或修改全局 dispatcher。 */
export function getPiRequestProxyDispatcher(): Dispatcher | undefined {
  return requestDispatcherStorage.getStore()
}

export async function closePiRequestProxyDispatcher(dispatcher: Dispatcher | undefined): Promise<void> {
  const close = (dispatcher as (Dispatcher & { close?: () => Promise<void> }) | undefined)?.close
  if (!close) return
  await close.call(dispatcher).catch((error: unknown) => {
    console.warn('[Pi SDK] 关闭请求级代理 dispatcher 失败:', error)
  })
}
