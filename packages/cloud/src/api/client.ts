/** Cloud API Client：有界请求、按账号隔离的共享刷新、有限安全重试。 */
import { getCloudApiConfig } from '../config'
import type { RefreshTokenResponse } from '../types/user'
import {
  assertCloudRequestActive, cancelledCloudRequest, createApiError, invalidCloudResponse,
  isApiError, withCloudDeadline, withCloudRequest,
} from './cloud-request'
import type { CloudOperation } from './cloud-request'
export { isApiError, getSafeCloudFailureMessage } from './cloud-request'
export type { ApiError, CloudFailureKind } from './cloud-request'

export interface ApiResponse<T> { data: T; status: number; ok: boolean }

export interface TokenStorage {
  getToken: () => string | null
  setToken: (token: string) => void
  getRefreshToken: () => string | null
  setRefreshToken: (token: string) => void
  clearTokens: () => void
  /** 登录、登出、替换账号时递增；正常token刷新不递增。 */
  getSessionRevision: () => number
}
export type QuotaExceededHandler = () => void
export type AuthFailedHandler = () => void
export interface CloudApiClient {
  get: <T>(path: string, options?: RequestInit) => Promise<ApiResponse<T>>
  post: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  put: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  patch: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  del: <T>(path: string, options?: RequestInit) => Promise<ApiResponse<T>>
  /** 主动恢复和401拦截共享入口；失败抛出安全ApiError。 */
  refreshAuthToken: () => Promise<string>
}
interface ClientOptions {
  tokenStorage?: TokenStorage
  onQuotaExceeded?: QuotaExceededHandler
  onAuthFailed?: AuthFailedHandler
  attemptTimeoutMs?: number
  operationTimeoutMs?: number
  retryDelayMs?: number
}

export function createApiClient(options: ClientOptions = {}): CloudApiClient {
  const config = getCloudApiConfig()
  const storage = options.tokenStorage
  const attemptTimeout = options.attemptTimeoutMs ?? config.timeout
  const operationTimeout = options.operationTimeoutMs ?? config.timeout * 2 + 1_000
  let refreshing: { revision: number; promise: Promise<string> } | null = null
  const revision = () => storage?.getSessionRevision() ?? 0
  const assertSession = (expected: number) => {
    if (revision() !== expected) throw cancelledCloudRequest()
  }

  function refreshAuthToken(): Promise<string> {
    const expected = revision()
    if (refreshing?.revision === expected) return refreshing.promise
    const promise = (async () => {
      try {
        const refreshToken = storage?.getRefreshToken()
        if (!storage || !refreshToken) throw createApiError(401)
        const data = await withCloudRequest(
          `${config.baseUrl}/auth/refresh`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) },
          async response => {
            const body: unknown = await response.json()
            if (!body || typeof body !== 'object' || !('access_token' in body)
              || typeof body.access_token !== 'string' || !body.access_token.trim()
              || ('refresh_token' in body && body.refresh_token != null
                && (typeof body.refresh_token !== 'string' || !body.refresh_token.trim()))) throw invalidCloudResponse()
            return body as RefreshTokenResponse
          },
          { timeoutMs: attemptTimeout, operation: 'refresh' },
        )
        assertSession(expected)
        storage.setToken(data.access_token)
        if (data.refresh_token) storage.setRefreshToken(data.refresh_token)
        return data.access_token
      } catch (error) {
        // 旧账号的401不能清除新账号；迟到成功也不能写回。
        assertSession(expected)
        if (isApiError(error) && error.kind === 'auth' && storage) {
          storage.clearTokens()
          options.onAuthFailed?.()
        }
        throw error
      }
    })()
    const flight = { revision: expected, promise }
    refreshing = flight
    // 不使用未被消费的finally派生promise，避免刷新失败产生unhandled rejection。
    const clear = () => { if (refreshing === flight) refreshing = null }
    void promise.then(clear, clear)
    return promise
  }

  async function request<T>(path: string, init: RequestInit): Promise<ApiResponse<T>> {
    const expected = revision()
    const isPublicAuth = path === '/auth/login' || path === '/auth/register'
    const operation: CloudOperation = path === '/auth/login' ? 'login'
      : path === '/api-keys/system' ? 'system_key' : 'cloud'
    return withCloudDeadline(async signal => {
      let retried = false
      let refreshed = false
      let attempt = 0
      while (true) {
        assertCloudRequestActive(signal)
        assertSession(expected)
        const token = storage?.getToken()
        const headers = new Headers(init.headers)
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
        if (token) headers.set('Authorization', `Bearer ${token}`)
        try {
          const result = await withCloudRequest(
            `${config.baseUrl}${path}`, { ...init, headers, signal },
            async response => ({ data: response.status === 204 ? undefined as T : await response.json() as T, status: response.status, ok: true }),
            { timeoutMs: attemptTimeout, operation, attempt: attempt++ },
          )
          assertCloudRequestActive(signal)
          assertSession(expected)
          return result
        } catch (error) {
          assertCloudRequestActive(signal)
          assertSession(expected)
          if (!isApiError(error)) throw error
          if (error.status === 401 && isPublicAuth) throw createApiError(401, 'auth', '邮箱或密码错误')
          if (error.status === 401 && storage && !refreshed && !isPublicAuth && path !== '/auth/refresh') {
            refreshed = true
            // 迟到401若发出时使用的是旧access token，优先复用已经更新的token。
            if (storage.getToken() === token) {
              // refresh有自己的deadline；本调用取消不影响其他等待者。
              await refreshAuthToken()
            }
            continue
          }
          if (error.status === 402) options.onQuotaExceeded?.()
          if (!retried && error.retryable && (init.method === 'GET' || (init.method === 'POST' && path === '/auth/login'))) {
            retried = true
            await waitBeforeRetry(options.retryDelayMs ?? 250 + Math.floor(Math.random() * 251), signal)
            continue
          }
          throw error
        }
      }
    }, operationTimeout, init.signal)
  }

  const mutation = <T>(method: string, path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method, body: body === undefined ? undefined : JSON.stringify(body) })
  return {
    get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'GET' }),
    post: <T>(path: string, body?: unknown, init?: RequestInit) => mutation<T>('POST', path, body, init),
    put: <T>(path: string, body?: unknown, init?: RequestInit) => mutation<T>('PUT', path, body, init),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) => mutation<T>('PATCH', path, body, init),
    del: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'DELETE' }),
    refreshAuthToken,
  }
}

function waitBeforeRetry(delay: number, signal: AbortSignal): Promise<void> {
  assertCloudRequestActive(signal)
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(cancelledCloudRequest()) }
    const timer = setTimeout(() => { cleanup(); resolve() }, delay)
    signal.addEventListener('abort', abort, { once: true })
  })
}
