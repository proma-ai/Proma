/**
 * Cloud API Client（基于原生 fetch）
 *
 * 功能：
 * - 请求拦截：自动注入 Authorization token
 * - 响应拦截：401 自动刷新 token，402 额度不足事件
 * - Token 刷新队列：并发请求共享同一个刷新流程
 */

import { getCloudApiConfig } from '../config'
import type { RefreshTokenResponse } from '../types/user'

/** API 响应包装 */
export interface ApiResponse<T> {
  data: T
  status: number
  ok: boolean
}

/** 可安全传递到 UI 的 Cloud 请求失败类别。 */
export type CloudFailureKind = 'network' | 'timeout' | 'server' | 'rate_limited' | 'auth' | 'client' | 'unknown'

/** API 错误。message 始终是可展示的固定文案，不含传输层或服务端原文。 */
export interface ApiError {
  status: number
  message: string
  kind: CloudFailureKind
  retryable: boolean
}

export function getSafeCloudFailureMessage(kind: CloudFailureKind): string {
  switch (kind) {
    case 'network': return '无法连接 Proma Cloud，请检查网络后重试'
    case 'timeout': return '连接 Proma Cloud 超时，请稍后重试'
    case 'server': return 'Proma Cloud 暂时不可用，请稍后重试'
    case 'rate_limited': return '请求过于频繁，请稍后重试'
    case 'auth': return '认证已过期，请重新登录'
    case 'client': return '请求未能完成，请检查输入后重试'
    default: return '请求失败，请稍后重试'
  }
}

function classifyFailure(status: number, timedOut = false): { kind: CloudFailureKind; retryable: boolean } {
  if (timedOut) return { kind: 'timeout', retryable: true }
  if (status === 0) return { kind: 'network', retryable: true }
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false }
  if (status === 408) return { kind: 'timeout', retryable: true }
  if (status === 429) return { kind: 'rate_limited', retryable: true }
  if (status >= 500) return { kind: 'server', retryable: true }
  if (status >= 400) return { kind: 'client', retryable: false }
  return { kind: 'unknown', retryable: false }
}

/** Token 存取接口（由调用方注入，适配不同环境） */
export interface TokenStorage {
  getToken: () => string | null
  setToken: (token: string) => void
  getRefreshToken: () => string | null
  setRefreshToken: (token: string) => void
  clearTokens: () => void
}

/** 额度不足事件回调 */
export type QuotaExceededHandler = () => void

/** 认证失败事件回调 */
export type AuthFailedHandler = () => void

/** API Client 实例 */
export interface CloudApiClient {
  /** 发起 GET 请求 */
  get: <T>(path: string, options?: RequestInit) => Promise<ApiResponse<T>>
  /** 发起 POST 请求 */
  post: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  /** 发起 PUT 请求 */
  put: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  /** 发起 PATCH 请求 */
  patch: <T>(path: string, body?: unknown, options?: RequestInit) => Promise<ApiResponse<T>>
  /** 发起 DELETE 请求 */
  del: <T>(path: string, options?: RequestInit) => Promise<ApiResponse<T>>
}

// Token 刷新状态管理
let isRefreshing = false
let refreshSubscribers: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []

/** 刷新成功后，通知所有等待的请求 */
function onTokenRefreshed(token: string): void {
  refreshSubscribers.forEach(({ resolve }) => resolve(token))
  refreshSubscribers = []
}

/** 刷新失败后，拒绝所有等待的请求 */
function onRefreshFailed(error: Error): void {
  refreshSubscribers.forEach(({ reject }) => reject(error))
  refreshSubscribers = []
}

/** 等待 token 刷新完成 */
function waitForTokenRefresh(): Promise<string> {
  return new Promise((resolve, reject) => {
    refreshSubscribers.push({ resolve, reject })
    // 超时保护
    setTimeout(() => {
      reject(new Error('Token 刷新超时'))
    }, 10_000)
  })
}

type TokenRefreshResult =
  | { status: 'refreshed'; token: string }
  | { status: 'expired' }
  | { status: 'transient_failure'; error: ApiError }

/**
 * 刷新 access token，并严格区分 refresh token 已失效与暂时故障。
 *
 * 只有服务端明确拒绝 refresh token（401/403）或本地根本没有 refresh token
 * 才可清理用户会话；网络中断和 5xx 时保留会话，允许稍后重试。
 */
async function tryRefreshToken(
  baseUrl: string,
  tokenStorage: TokenStorage,
): Promise<TokenRefreshResult> {
  const refreshToken = tokenStorage.getRefreshToken()
  if (!refreshToken) return { status: 'expired' }

  try {
    // 直接用 fetch 调用刷新接口，不经过拦截器以避免循环
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { status: 'expired' }
      }
      return {
        status: 'transient_failure',
        error: createApiError(response.status),
      }
    }

    const data = (await response.json()) as RefreshTokenResponse
    tokenStorage.setToken(data.access_token)
    if (data.refresh_token) {
      tokenStorage.setRefreshToken(data.refresh_token)
    }

    console.log('[CloudApiClient] Token 刷新成功')
    return { status: 'refreshed', token: data.access_token }
  } catch (error) {
    console.error('[CloudApiClient] Token 刷新失败:', error)
    return {
      status: 'transient_failure',
      error: createApiError(0),
    }
  }
}

/**
 * 创建 Cloud API Client
 */
export function createApiClient(options?: {
  tokenStorage?: TokenStorage
  onQuotaExceeded?: QuotaExceededHandler
  onAuthFailed?: AuthFailedHandler
}): CloudApiClient {
  const config = getCloudApiConfig()
  const tokenStorage = options?.tokenStorage
  const onQuotaExceeded = options?.onQuotaExceeded
  const onAuthFailed = options?.onAuthFailed

  /** 核心请求方法 */
  async function request<T>(
    path: string,
    init: RequestInit = {},
    isRetry = false,
    networkRetryAttempt = 0,
  ): Promise<ApiResponse<T>> {
    const url = `${config.baseUrl}${path}`

    // 注入 Authorization header
    const headers = new Headers(init.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const token = tokenStorage?.getToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    // 超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.timeout)

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // 401 处理：尝试刷新 token
      if (response.status === 401 && tokenStorage && !isRetry) {
        // 公开认证端点返回 401，直接透传服务器错误（不触发 token 刷新）
        // /auth/login 返回 401 = 用户名或密码错误，不是 token 过期
        // /auth/refresh 返回 401 = refresh token 已失效，清除会话
        if (path.includes('/auth/login') || path.includes('/auth/register')) {
          throw createApiError(response.status, { safeMessage: '邮箱或密码错误' })
        }

        if (path.includes('/auth/refresh')) {
          tokenStorage.clearTokens()
          onAuthFailed?.()
          throw createApiError(response.status)
        }

        // 如果已在刷新中，等待刷新完成后重试
        if (isRefreshing) {
          const newToken = await waitForTokenRefresh()
          headers.set('Authorization', `Bearer ${newToken}`)
          return request<T>(path, init, true)
        }

        isRefreshing = true
        const refreshResult = await tryRefreshToken(config.baseUrl, tokenStorage)

        if (refreshResult.status === 'refreshed') {
          onTokenRefreshed(refreshResult.token)
          isRefreshing = false
          return request<T>(path, init, true)
        }

        if (refreshResult.status === 'expired') {
          onRefreshFailed(new Error('认证已过期，请重新登录'))
          isRefreshing = false
          tokenStorage.clearTokens()
          onAuthFailed?.()
          throw createApiError(401)
        }

        onRefreshFailed(new Error(refreshResult.error.message))
        isRefreshing = false
        throw refreshResult.error
      }

      // 402 处理：额度不足
      if (response.status === 402) {
        onQuotaExceeded?.()
      }

      // 非 2xx 状态码抛出错误
      if (!response.ok) {
        throw createApiError(response.status)
      }

      // 解析响应
      const data = (await response.json()) as T

      return {
        data,
        status: response.status,
        ok: true,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      // AbortError = 超时
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw createApiError(0, { timedOut: true })
      }

      // Only idempotent reads and the explicitly opted-in login request get one
      // short retry. Other mutations must never be retried implicitly.
      if (isApiError(error)) {
        if (shouldRetryRequest(path, init, error, networkRetryAttempt)) {
          await waitBeforeRetry()
          return request<T>(path, init, isRetry, networkRetryAttempt + 1)
        }
        throw error
      }

      const networkError = createApiError(0)
      if (shouldRetryRequest(path, init, networkError, networkRetryAttempt)) {
        await waitBeforeRetry()
        return request<T>(path, init, isRetry, networkRetryAttempt + 1)
      }
      throw networkError
    }
  }

  return {
    get: <T>(path: string, options?: RequestInit) =>
      request<T>(path, { ...options, method: 'GET' }),

    post: <T>(path: string, body?: unknown, options?: RequestInit) =>
      request<T>(path, {
        ...options,
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      }),

    put: <T>(path: string, body?: unknown, options?: RequestInit) =>
      request<T>(path, {
        ...options,
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      }),

    patch: <T>(path: string, body?: unknown, options?: RequestInit) =>
      request<T>(path, {
        ...options,
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      }),

    del: <T>(path: string, options?: RequestInit) =>
      request<T>(path, { ...options, method: 'DELETE' }),
  }
}

/** 创建只含安全诊断信息的 API 错误对象。 */
function createApiError(
  status: number,
  options: { safeMessage?: string; timedOut?: boolean } = {},
): ApiError {
  const { kind, retryable } = classifyFailure(status, options.timedOut)
  return {
    status,
    kind,
    retryable,
    message: options.safeMessage ?? getSafeCloudFailureMessage(kind),
  }
}

function shouldRetryRequest(path: string, init: RequestInit, error: ApiError, attempt: number): boolean {
  if (attempt >= 1 || !error.retryable) return false
  return init.method === 'GET' || path === '/auth/login'
}

async function waitBeforeRetry(): Promise<void> {
  const delay = 250 + Math.floor(Math.random() * 251)
  await new Promise<void>((resolve) => setTimeout(resolve, delay))
}

/** 类型守卫：判断是否为 ApiError */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  )
}
