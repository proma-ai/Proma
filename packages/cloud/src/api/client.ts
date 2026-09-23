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

/** API 错误 */
export interface ApiError {
  status: number
  message: string
  data?: unknown
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
      const errorData = await response.json().catch(() => null)
      return {
        status: 'transient_failure',
        error: createApiError(
          response.status,
          (errorData as Record<string, string>)?.detail ||
            (errorData as Record<string, string>)?.message ||
            `Token 刷新失败: ${response.status}`,
          errorData,
        ),
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
      error: createApiError(0, `网络错误: ${error instanceof Error ? error.message : '未知错误'}`),
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
          const errorData = await response.json().catch(() => null)
          throw createApiError(
            response.status,
            (errorData as Record<string, string>)?.detail ||
              (errorData as Record<string, string>)?.message ||
              '邮箱或密码错误',
            errorData,
          )
        }

        if (path.includes('/auth/refresh')) {
          tokenStorage.clearTokens()
          onAuthFailed?.()
          throw createApiError(response.status, '认证已过期，请重新登录')
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
          throw createApiError(401, '认证已过期，请重新登录')
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
        const errorData = await response.json().catch(() => null)
        throw createApiError(
          response.status,
          (errorData as Record<string, string>)?.detail ||
            (errorData as Record<string, string>)?.message ||
            `请求失败: ${response.status}`,
          errorData,
        )
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
        throw createApiError(0, '请求超时')
      }

      // 已经是 ApiError 直接抛出
      if (isApiError(error)) {
        throw error
      }

      throw createApiError(0, `网络错误: ${error instanceof Error ? error.message : '未知错误'}`)
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

/** 创建 API 错误对象 */
function createApiError(status: number, message: string, data?: unknown): ApiError {
  return { status, message, data }
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
