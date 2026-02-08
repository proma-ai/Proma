/**
 * Cloud IPC 处理器
 *
 * 仅在 PROMA_MODE=cloud 时注册。
 * 内部调用 cloud-auth-service 的函数。
 */

import { ipcMain } from 'electron'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import type {
  LoginRequest,
  RegisterRequest,
  VerifyEmailRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResendCodeRequest,
} from '@proma/cloud'
import {
  initCloudAuthService,
  login,
  register,
  logout,
  getMe,
  getAuthState,
  verifyEmail,
  forgotPassword,
  resetPassword,
  resendCode,
  getGoogleOAuthStatus,
  openGoogleLogin,
} from './lib/cloud-auth-service'

/**
 * 注册 Cloud IPC 处理器
 *
 * 初始化认证服务并注册所有 Cloud IPC 通道
 */
export async function registerCloudIpcHandlers(): Promise<void> {
  // 初始化认证服务（恢复 token + 验证）
  await initCloudAuthService()

  // ===== 认证相关 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.LOGIN,
    async (_, data: LoginRequest) => {
      return login(data)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.REGISTER,
    async (_, data: RegisterRequest) => {
      return register(data)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.LOGOUT,
    async () => {
      return logout()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_ME,
    async () => {
      return getMe()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_AUTH_STATE,
    async () => {
      return getAuthState()
    },
  )

  // ===== 邮箱验证 / 密码重置 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.VERIFY_EMAIL,
    async (_, data: VerifyEmailRequest) => {
      return verifyEmail(data)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.FORGOT_PASSWORD,
    async (_, data: ForgotPasswordRequest) => {
      return forgotPassword(data)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.RESET_PASSWORD,
    async (_, data: ResetPasswordRequest) => {
      return resetPassword(data)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.RESEND_CODE,
    async (_, data: ResendCodeRequest) => {
      return resendCode(data)
    },
  )

  // ===== Google OAuth =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_GOOGLE_OAUTH_STATUS,
    async () => {
      return getGoogleOAuthStatus()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.OPEN_GOOGLE_LOGIN,
    async () => {
      return openGoogleLogin()
    },
  )

  console.log('[Cloud IPC] 已注册 Cloud 认证处理器')
}
