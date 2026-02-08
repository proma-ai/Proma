/**
 * Cloud 认证服务（主进程）
 *
 * 功能：
 * - Token 持久化：safeStorage 加密 → ~/.proma/cloud-auth.json
 * - 内存缓存 + 文件持久化双层架构
 * - TokenStorage 接口适配 @proma/cloud API client
 * - 认证状态变化时广播到所有渲染进程窗口
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { safeStorage, BrowserWindow } from 'electron'
import { getCloudAuthPath } from './config-paths'
import { updateUserProfile } from './user-profile-service'
import {
  createApiClient,
  createAuthApi,
  isApiError,
  getCloudApiConfig,
} from '@proma/cloud'
import type { TokenStorage, CloudApiClient, AuthApi } from '@proma/cloud'
import type {
  LoginRequest,
  RegisterRequest,
  CloudUser,
  VerifyEmailRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResendCodeRequest,
} from '@proma/cloud'
import type { CloudUserInfo, CloudAuthState, CloudAuthIpcResponse } from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'

// ===== 持久化数据结构 =====

/** 持久化到文件的认证数据 */
interface PersistedAuthData {
  /** 加密后的 access token (base64) */
  accessToken: string
  /** 加密后的 refresh token (base64) */
  refreshToken: string
}

// ===== 内存缓存 =====

let cachedAccessToken: string | null = null
let cachedRefreshToken: string | null = null
let cachedUser: CloudUserInfo | null = null
let apiClient: CloudApiClient | null = null
let authApi: AuthApi | null = null

/** 额度不足回调（由 billing service 注册，避免循环依赖） */
let quotaExceededHandler: (() => void) | null = null

// ===== Token 加密/解密 =====

function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Cloud Auth] safeStorage 加密不可用，将以明文存储')
    return token
  }
  const encrypted = safeStorage.encryptString(token)
  return encrypted.toString('base64')
}

function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return encrypted
  }
  try {
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[Cloud Auth] 解密 token 失败:', error)
    throw new Error('解密 token 失败')
  }
}

// ===== 文件持久化 =====

function loadTokensFromFile(): void {
  const path = getCloudAuthPath()
  if (!existsSync(path)) return

  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as PersistedAuthData

    if (data.accessToken) {
      cachedAccessToken = decryptToken(data.accessToken)
    }
    if (data.refreshToken) {
      cachedRefreshToken = decryptToken(data.refreshToken)
    }

    console.log('[Cloud Auth] 已从文件恢复 token')
  } catch (error) {
    console.error('[Cloud Auth] 读取认证文件失败:', error)
    // 文件损坏则清除
    clearPersistedTokens()
  }
}

function saveTokensToFile(): void {
  if (!cachedAccessToken) return

  const path = getCloudAuthPath()
  const data: PersistedAuthData = {
    accessToken: encryptToken(cachedAccessToken),
    refreshToken: cachedRefreshToken ? encryptToken(cachedRefreshToken) : '',
  }

  try {
    writeFileSync(path, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error('[Cloud Auth] 保存认证文件失败:', error)
  }
}

function clearPersistedTokens(): void {
  const path = getCloudAuthPath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      // 忽略删除失败
    }
  }
}

// ===== TokenStorage 适配器 =====

const tokenStorage: TokenStorage = {
  getToken: () => cachedAccessToken,
  setToken: (token: string) => {
    cachedAccessToken = token
    saveTokensToFile()
  },
  getRefreshToken: () => cachedRefreshToken,
  setRefreshToken: (token: string) => {
    cachedRefreshToken = token
    saveTokensToFile()
  },
  clearTokens: () => {
    cachedAccessToken = null
    cachedRefreshToken = null
    cachedUser = null
    clearPersistedTokens()
  },
}

// ===== 广播认证状态变化 =====

function broadcastAuthStateChanged(): void {
  const state = getAuthState()
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.AUTH_STATE_CHANGED, state)
  })
}

// ===== CloudUser → CloudUserInfo 转换 =====

function toUserInfo(user: CloudUser): CloudUserInfo {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    avatar: user.avatar,
    status: user.status,
  }
}

/** 将 Cloud 用户信息同步到本地 user-profile.json（离线回退） */
function syncCloudUserToLocalProfile(user: CloudUserInfo): void {
  try {
    updateUserProfile({
      userName: user.name,
      avatar: user.image || user.avatar || undefined,
    })
    console.log('[Cloud Auth] 已同步 Cloud 用户档案到本地')
  } catch (error) {
    console.warn('[Cloud Auth] 同步本地用户档案失败:', error)
  }
}

// ===== 获取 API 实例 =====

/**
 * 注册额度不足回调
 *
 * 由 billing service 调用，避免 auth service 反向依赖 billing
 */
export function setQuotaExceededHandler(handler: () => void): void {
  quotaExceededHandler = handler
}

/** 获取共享的 API Client（供 billing service 复用） */
export function getApiClient(): CloudApiClient {
  if (!apiClient) {
    apiClient = createApiClient({
      tokenStorage,
      onQuotaExceeded: () => {
        quotaExceededHandler?.()
      },
      onAuthFailed: () => {
        console.log('[Cloud Auth] 认证失败，清除状态')
        cachedUser = null
        broadcastAuthStateChanged()
      },
    })
  }
  return apiClient
}

function getAuthApi(): AuthApi {
  if (!authApi) {
    authApi = createAuthApi(getApiClient())
  }
  return authApi
}

// ===== 公开 API =====

/**
 * 获取当前 access token（供官方渠道使用）
 *
 * @returns 明文 access token，未登录时返回 null
 */
export function getAuthToken(): string | null {
  return cachedAccessToken
}

/** Token 刷新响应 */
interface RefreshTokenData {
  access_token: string
  refresh_token?: string
}

/**
 * 尝试刷新 access token
 *
 * 使用 refresh token 直接调用后端刷新接口（不经过 CloudApiClient，
 * 避免 client 内部 401 处理逻辑的干扰）。
 *
 * @returns 新的 access token，刷新失败时返回 null
 */
export async function tryRefreshAuthToken(): Promise<string | null> {
  if (!cachedRefreshToken) return null

  try {
    const config = getCloudApiConfig()
    const response = await fetch(`${config.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: cachedRefreshToken }),
    })

    if (!response.ok) {
      console.warn('[Cloud Auth] Token 刷新失败:', response.status)
      return null
    }

    const data = (await response.json()) as RefreshTokenData
    cachedAccessToken = data.access_token
    if (data.refresh_token) {
      cachedRefreshToken = data.refresh_token
    }
    saveTokensToFile()

    console.log('[Cloud Auth] Token 刷新成功')
    return cachedAccessToken
  } catch (error) {
    console.warn('[Cloud Auth] Token 刷新失败:', error)
    return null
  }
}

/**
 * 初始化 Cloud 认证服务
 *
 * 启动时调用：从文件恢复 token，尝试获取用户信息
 */
export async function initCloudAuthService(): Promise<void> {
  loadTokensFromFile()

  // 有 token 则尝试获取用户信息验证 token 有效性
  if (cachedAccessToken) {
    try {
      const user = await getAuthApi().getMe()
      cachedUser = toUserInfo(user)
      syncCloudUserToLocalProfile(cachedUser)
      console.log('[Cloud Auth] 会话恢复成功:', cachedUser.email)
    } catch (error) {
      console.warn('[Cloud Auth] 会话恢复失败，token 可能已过期:', error)
      // token 无效，清除
      tokenStorage.clearTokens()
    }
  }
}

/** 登录 */
export async function login(data: LoginRequest): Promise<CloudAuthIpcResponse> {
  try {
    const result = await getAuthApi().login(data)

    // PENDING 状态：不保存认证，返回用户信息供渲染进程判断
    if (result.user.status === 'PENDING') {
      return { success: false, error: '请先验证邮箱', user: toUserInfo(result.user) }
    }

    // 保存 token
    cachedAccessToken = result.token
    if (result.refreshToken) {
      cachedRefreshToken = result.refreshToken
    }
    saveTokensToFile()

    // 缓存用户信息
    cachedUser = toUserInfo(result.user)
    syncCloudUserToLocalProfile(cachedUser)

    broadcastAuthStateChanged()

    return { success: true, user: cachedUser }
  } catch (error) {
    const message = isApiError(error) ? error.message : '登录失败，请稍后重试'
    return { success: false, error: message }
  }
}

/** 注册 */
export async function register(data: RegisterRequest): Promise<CloudAuthIpcResponse> {
  try {
    await getAuthApi().register(data)

    // 注册成功后不保存 token、不设置认证状态
    // 用户需要先验证邮箱，再通过登录流程进入
    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : '注册失败，请稍后重试'
    return { success: false, error: message }
  }
}

/** 登出 */
export async function logout(): Promise<CloudAuthIpcResponse> {
  tokenStorage.clearTokens()
  // 清理官方渠道（延迟导入避免循环依赖）
  try {
    const { cleanupOfficialChannel } = await import('./cloud-channel-service')
    cleanupOfficialChannel()
  } catch {
    // 清理失败不影响登出
  }
  broadcastAuthStateChanged()
  return { success: true }
}

/** 获取当前用户信息 */
export async function getMe(): Promise<CloudAuthIpcResponse> {
  if (!cachedAccessToken) {
    return { success: false, error: '未登录' }
  }

  try {
    const user = await getAuthApi().getMe()
    cachedUser = toUserInfo(user)
    return { success: true, user: cachedUser }
  } catch (error) {
    const message = isApiError(error) ? error.message : '获取用户信息失败'
    return { success: false, error: message }
  }
}

/** 获取认证状态 */
export function getAuthState(): CloudAuthState {
  return {
    isAuthenticated: cachedAccessToken !== null && cachedUser !== null,
    user: cachedUser,
  }
}

/** 邮箱验证 */
export async function verifyEmail(data: VerifyEmailRequest): Promise<CloudAuthIpcResponse> {
  try {
    await getAuthApi().verifyEmail(data)
    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : '验证失败'
    return { success: false, error: message }
  }
}

/** 忘记密码 */
export async function forgotPassword(data: ForgotPasswordRequest): Promise<CloudAuthIpcResponse> {
  try {
    await getAuthApi().forgotPassword(data)
    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : '发送失败'
    return { success: false, error: message }
  }
}

/** 重置密码 */
export async function resetPassword(data: ResetPasswordRequest): Promise<CloudAuthIpcResponse> {
  try {
    await getAuthApi().resetPassword(data)
    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : '重置失败'
    return { success: false, error: message }
  }
}

/** 重发验证码 */
export async function resendCode(data: ResendCodeRequest): Promise<CloudAuthIpcResponse> {
  try {
    await getAuthApi().resendCode(data)
    return { success: true }
  } catch (error) {
    const message = isApiError(error) ? error.message : '发送失败'
    return { success: false, error: message }
  }
}

/** 获取 Google OAuth 状态 */
export async function getGoogleOAuthStatus(): Promise<{ configured: boolean }> {
  try {
    return await getAuthApi().getGoogleOAuthStatus()
  } catch {
    return { configured: false }
  }
}

/** 打开 Google 登录（系统浏览器） */
export async function openGoogleLogin(): Promise<CloudAuthIpcResponse> {
  try {
    const { shell } = await import('electron')
    const { getCloudApiConfig } = await import('@proma/cloud')
    const config = getCloudApiConfig()
    const loginUrl = getAuthApi().getGoogleLoginUrl(config.baseUrl, 'proma://oauth/callback')
    await shell.openExternal(loginUrl)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google 登录打开失败'
    return { success: false, error: message }
  }
}

/**
 * 处理 OAuth 回调（deep-link: proma://oauth/callback?token=...）
 */
export async function handleOAuthCallback(token: string, refreshToken?: string): Promise<CloudAuthIpcResponse> {
  try {
    cachedAccessToken = token
    if (refreshToken) {
      cachedRefreshToken = refreshToken
    }
    saveTokensToFile()

    const user = await getAuthApi().getMe()
    cachedUser = toUserInfo(user)
    syncCloudUserToLocalProfile(cachedUser)
    broadcastAuthStateChanged()

    return { success: true, user: cachedUser }
  } catch (error) {
    tokenStorage.clearTokens()
    const message = isApiError(error) ? error.message : '获取用户信息失败'
    return { success: false, error: message }
  }
}

/** 更新 Cloud 用户档案 */
export async function updateCloudProfile(data: { name?: string; image?: string }): Promise<CloudAuthIpcResponse> {
  if (!cachedAccessToken) {
    return { success: false, error: '未登录' }
  }

  try {
    const user = await getAuthApi().updateProfile(data)
    cachedUser = toUserInfo(user)
    broadcastAuthStateChanged()
    return { success: true, user: cachedUser }
  } catch (error) {
    const message = isApiError(error) ? error.message : '更新档案失败'
    return { success: false, error: message }
  }
}
