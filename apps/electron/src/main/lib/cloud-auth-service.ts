/**
 * Cloud 认证服务（主进程）
 *
 * 功能：
 * - Token 持久化：safeStorage 加密 → ~/.proma/cloud-auth.json
 * - 内存缓存 + 文件持久化双层架构
 * - TokenStorage 接口适配 @proma/cloud API client
 * - 认证状态变化时广播到所有渲染进程窗口
 */

import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { safeStorage, BrowserWindow } from 'electron'
import { writeTextFileAtomic } from './safe-file'
import { getCloudAuthPath } from './config-paths'
import { updateUserProfile } from './user-profile-service'
import { cloudUserToProfile } from '../../lib/user-profile'
import {
  createApiClient,
  createAuthApi,
  isApiError,
  getCloudApiConfig,
  withCloudDeadline,
  assertCloudRequestActive,
  cancelledCloudRequest,
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
import type { CloudUserInfo, CloudAuthState, CloudAuthIpcResponse, CloudAuthErrorReason } from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'

// ===== 持久化数据结构 =====

/** 持久化到文件的认证数据 */
function toSafeAuthFailure(error: unknown, fallback: string): Pick<CloudAuthIpcResponse, 'error' | 'errorReason' | 'retryable'> {
  if (isApiError(error)) {
    return {
      error: error.message,
      errorReason: error.kind as CloudAuthErrorReason,
      retryable: error.retryable,
    }
  }
  return { error: fallback, errorReason: 'unknown', retryable: true }
}

interface PersistedAuthData {
  /** 加密后的 access token (base64) */
  accessToken: string
  /** 加密后的 refresh token (base64) */
  refreshToken: string
  /** 加密后的最小用户快照；仅在离线恢复时维持已登录界面。 */
  userSnapshot?: string
}

// ===== 内存缓存 =====

let sessionRevision = 0
let authActionRevision = 0

/** 账号代际，正常token轮换不改变。 */
export function getCloudSessionRevision(): number { return sessionRevision }

function assertSessionRevision(expected: number): void {
  if (sessionRevision !== expected) throw cancelledCloudRequest()
}

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
    if (data.userSnapshot) {
      try {
        const snapshot = JSON.parse(decryptToken(data.userSnapshot)) as Partial<CloudUserInfo>
        if (typeof snapshot.id === 'string' && typeof snapshot.email === 'string' && typeof snapshot.name === 'string'
          && (snapshot.status === 'PENDING' || snapshot.status === 'APPROVED' || snapshot.status === 'DISABLED')) {
          cachedUser = snapshot as CloudUserInfo
        }
      } catch {
        // A stale/corrupt user snapshot must not discard otherwise valid tokens.
      }
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
    userSnapshot: cachedUser ? encryptToken(JSON.stringify(cachedUser)) : '',
  }

  try {
    writeTextFileAtomic(path, JSON.stringify(data, null, 2))
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
  getSessionRevision: getCloudSessionRevision,
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
    sessionRevision += 1
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

/** 清理仅在已登出或确认认证失效后才可继续使用的运行时状态。 */
async function cleanupCloudSessionRuntime(expected = sessionRevision): Promise<void> {
  // 清理官方渠道（延迟导入避免循环依赖）
  try {
    const { cleanupOfficialChannel, stopModelsPolling } = await import('./cloud-channel-service')
    if (sessionRevision !== expected) return
    cleanupOfficialChannel()
    stopModelsPolling()
  } catch {
    // 清理失败不应阻塞认证状态恢复
  }
  // 清理 inner key 进程内缓存（1h TTL），避免旧账号凭据继续被复用。
  try {
    const { invalidatePromaAgentInnerKeyCache } = await import('./proma-agent-key-service')
    if (sessionRevision !== expected) return
    invalidatePromaAgentInnerKeyCache()
  } catch {
    // 清理失败不应阻塞认证状态恢复
  }
  // 清理账号相关的 Cloud 数据缓存，避免下个账号复用前一账号的数据。
  try {
    const [{ clearHealthCache }, { clearAgentTokenActivityCache, clearAgentTurnUsageCache }] = await Promise.all([
      import('./cloud-health-service'),
      import('./cloud-usage-service'),
    ])
    if (sessionRevision !== expected) return
    clearHealthCache()
    clearAgentTokenActivityCache()
    clearAgentTurnUsageCache()
  } catch {
    // 清理失败不应阻塞认证状态恢复
  }
}

/**
 * 仅用于服务端明确确认认证失效的场景。
 * 认证广播会让 CloudAuthGate 立即展示登录页；网络、超时和 5xx 不得调用此函数。
 */
function invalidateExpiredCloudSession(tokensAlreadyCleared = false): void {
  if (!tokensAlreadyCleared) tokenStorage.clearTokens()
  void cleanupCloudSessionRuntime()
  broadcastAuthStateChanged()
}

/** Clear account-scoped runtime state before replacing credentials for another user. */
async function prepareCloudAccountChange(nextUserId?: string): Promise<void> {
  sessionRevision += 1
  if (cachedUser?.id === nextUserId && nextUserId !== undefined) return
  await cleanupCloudSessionRuntime()
}

/**
 * 登录时先使官方渠道和 Agent system key 就绪，再通知渲染进程进入主界面。
 *
 * 首次设备登录后，Onboarding 会紧随认证广播自动发送欢迎 Agent 消息。此前只同步
 * `proma-official` 的模型，system key 仍在该首条消息的 preflight 中惰性创建；
 * 任意短暂失败都会被误报为“登录已失效”。这里将 key 的创建/缓存移到广播之前。
 * 初始化失败不阻断登录，后续首条消息仍会重试获取凭据。
 */
async function initializeOfficialChannelForLogin(): Promise<void> {
  const expected = sessionRevision
  try {
    await withCloudDeadline(async signal => {
      const { clearSystemKeyCache, getSystemApiKey, initOfficialChannel } = await import('./cloud-channel-service')
      assertCloudRequestActive(signal)
      assertSessionRevision(expected)
      clearSystemKeyCache()
      await initOfficialChannel(signal)
      assertCloudRequestActive(signal)
      assertSessionRevision(expected)
      // system key为共享缓存加载，独立有界；取消预热等待不能中断其他Agent调用。
      await getSystemApiKey()
    }, getCloudApiConfig().timeout)
  } catch (error) {
    console.warn('[Cloud Auth] 登录预热未完成，后续请求将重试:', isApiError(error) ? error.kind : 'unknown')
  }
  assertSessionRevision(expected)
  const { startModelsPolling } = await import('./cloud-channel-service')
  assertSessionRevision(expected)
  startModelsPolling(false)
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
    updateUserProfile(cloudUserToProfile(user))
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
        console.log('[Cloud Auth] 认证已失效，切换到登录页')
        invalidateExpiredCloudSession(true)
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

/** 主动恢复与CloudApiClient的401恢复共享同一个有界刷新流程。 */
export async function tryRefreshAuthToken(expectedRevision = sessionRevision): Promise<string | null> {
  if (expectedRevision !== sessionRevision || !cachedRefreshToken) return null
  try {
    const token = await getApiClient().refreshAuthToken()
    assertSessionRevision(expectedRevision)
    return token
  } catch (error) {
    console.warn('[Cloud Auth] Token 刷新失败:', isApiError(error) ? error.kind : 'unknown')
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
    const expected = sessionRevision
    try {
      const user = await getAuthApi().getMe()
      assertSessionRevision(expected)
      cachedUser = toUserInfo(user)
      saveTokensToFile()
      syncCloudUserToLocalProfile(cachedUser)
      console.log('[Cloud Auth] 会话恢复成功:', cachedUser.email)
    } catch (error) {
      const failure = toSafeAuthFailure(error, '会话恢复失败，请稍后重试')
      console.warn('[Cloud Auth] 会话恢复失败:', failure.errorReason)
      // 网络、超时与服务端暂时故障不能把用户错误登出；只有服务端确认
      // 的 401/403 认证失效才可清除本地凭据。
      if (failure.errorReason === 'auth' && expected === sessionRevision) invalidateExpiredCloudSession()
    }
  }
}

/** 登录 */
export async function login(data: LoginRequest): Promise<CloudAuthIpcResponse> {
  const action = ++authActionRevision
  try {
    const result = await getAuthApi().login(data)

    // PENDING 状态：不保存认证，返回用户信息供渲染进程判断
    if (result.user.status === 'PENDING') {
      return { success: false, error: '请先验证邮箱', user: toUserInfo(result.user) }
    }

    if (action !== authActionRevision) throw cancelledCloudRequest()
    const nextUser = toUserInfo(result.user)
    await prepareCloudAccountChange(nextUser.id)
    if (action !== authActionRevision) throw cancelledCloudRequest()

    // 原子提交新代际和凭据：清理窗口内新建的旧账号请求也必须失效。
    sessionRevision += 1
    // 保存 token 和可离线恢复的最小用户快照。
    cachedAccessToken = result.token
    cachedRefreshToken = result.refreshToken ?? null
    cachedUser = nextUser
    saveTokensToFile()
    syncCloudUserToLocalProfile(cachedUser)

    // 必须在认证状态广播前完成首次官方渠道同步，避免新用户的 AppShell
    // 在渠道/默认模型尚不存在时挂载，导致首次登录黑屏。
    await initializeOfficialChannelForLogin()
    if (action !== authActionRevision) throw cancelledCloudRequest()
    broadcastAuthStateChanged()

    return { success: true, user: cachedUser }
  } catch (error) {
    return { success: false, ...toSafeAuthFailure(error, '登录失败，请稍后重试') }
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
  authActionRevision += 1
  tokenStorage.clearTokens()
  await cleanupCloudSessionRuntime()
  broadcastAuthStateChanged()
  return { success: true }
}

/** 获取当前用户信息 */
export async function getMe(): Promise<CloudAuthIpcResponse> {
  if (!cachedAccessToken) {
    return { success: false, error: '未登录' }
  }

  try {
    const expected = sessionRevision
    const user = await getAuthApi().getMe()
    assertSessionRevision(expected)
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
  const action = ++authActionRevision
  let acceptedRevision: number | undefined
  try {
    // The callback does not include a user ID, so clear old account state before
    // accepting its credentials. This prevents a new token from being paired
    // with a previous user's cached profile during a transient /auth/me failure.
    await prepareCloudAccountChange()
    if (action !== authActionRevision) throw cancelledCloudRequest()
    sessionRevision += 1
    cachedUser = null
    cachedAccessToken = token
    cachedRefreshToken = refreshToken ?? null
    acceptedRevision = sessionRevision
    saveTokensToFile()

    const expected = sessionRevision
    const user = await getAuthApi().getMe()
    assertSessionRevision(expected)
    cachedUser = toUserInfo(user)
    saveTokensToFile()
    syncCloudUserToLocalProfile(cachedUser)

    // OAuth 登录与密码登录必须共享相同的“渠道就绪后再进入主界面”时序。
    // Onboarding 会在认证成功后立即创建欢迎 Agent 会话；若先广播，首次
    // Google 登录可能在 proma-official 渠道/默认模型落盘前抢先发送首条消息。
    await initializeOfficialChannelForLogin()
    if (action !== authActionRevision) throw cancelledCloudRequest()
    broadcastAuthStateChanged()

    return { success: true, user: cachedUser }
  } catch (error) {
    const failure = toSafeAuthFailure(error, '获取用户信息失败')
    if (failure.errorReason === 'auth' && acceptedRevision === sessionRevision) invalidateExpiredCloudSession()
    return { success: false, ...failure }
  }
}

/** base64 data URL 中 MIME 类型到文件扩展名的映射（仅允许安全的图片格式） */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** 将 base64 data URL 上传到 OSS，返回公开访问 URL */
async function uploadDataUrlToOss(dataUrl: string): Promise<string> {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches || !matches[1] || !matches[2]) throw new Error('无效的 data URL 格式')

  const contentType: string = matches[1]
  const base64Data: string = matches[2]
  const ext = MIME_TO_EXT[contentType] ?? 'png'

  // 使用 ArrayBuffer 传入 fetch body，兼容 TypeScript DOM 类型
  const buffer = Buffer.from(base64Data, 'base64')
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

  const signRes = await getApiClient().post<{ uploadUrl: string; ossPath: string }>('/oss/sign', {
    filename: `avatar.${ext}`,
    contentType,
    prefix: 'avatars',
  })
  const { uploadUrl } = signRes.data

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: arrayBuffer as ArrayBuffer,
  })
  if (!uploadRes.ok) {
    throw new Error(`OSS 上传失败: ${uploadRes.status} ${uploadRes.statusText}`)
  }

  // 去掉签名参数，返回公开访问 URL（与 proma-frontend 保持一致）
  const url = new URL(uploadUrl)
  return `${url.origin}${url.pathname}`
}

/** 更新 Cloud 用户档案 */
export async function updateCloudProfile(data: { name?: string; image?: string }): Promise<CloudAuthIpcResponse> {
  if (!cachedAccessToken) {
    return { success: false, error: '未登录' }
  }

  try {
    const updateData = { ...data }

    // 如果 image 是 base64 data URL，先上传到 OSS 再存 URL
    if (updateData.image?.startsWith('data:')) {
      updateData.image = await uploadDataUrlToOss(updateData.image)
    }

    const user = await getAuthApi().updateProfile(updateData)
    cachedUser = toUserInfo(user)
    saveTokensToFile()
    broadcastAuthStateChanged()
    return { success: true, user: cachedUser }
  } catch (error) {
    const message = isApiError(error) ? error.message : '更新档案失败'
    return { success: false, error: message }
  }
}
