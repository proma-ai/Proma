/**
 * 认证 API（纯函数，不依赖 React）
 *
 * 从 proma-frontend/src/api/auth.ts 迁移，去除 React Query hooks
 */

import type { CloudApiClient } from './client'
import type {
  AuthResponse,
  FastAPIAuthResponse,
  RefreshTokenResponse,
  LoginRequest,
  RegisterRequest,
  VerifyEmailRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ResendCodeRequest,
  CloudUser,
  WelcomeBonusInfo,
} from '../types/user'

/** 转换 FastAPI 响应为前端格式 */
function transformAuthResponse(response: FastAPIAuthResponse): AuthResponse {
  return {
    user: response.user,
    token: response.access_token,
    refreshToken: response.refresh_token,
  }
}

/** 创建认证 API */
export function createAuthApi(client: CloudApiClient) {
  return {
    /** 登录 */
    login: async (data: LoginRequest): Promise<AuthResponse> => {
      const response = await client.post<FastAPIAuthResponse>('/auth/login', data)
      return transformAuthResponse(response.data)
    },

    /** 注册 */
    register: async (data: RegisterRequest): Promise<AuthResponse> => {
      const response = await client.post<FastAPIAuthResponse>('/auth/register', data)
      return transformAuthResponse(response.data)
    },

    /** 邮箱验证 */
    verifyEmail: async (data: VerifyEmailRequest): Promise<void> => {
      await client.post('/auth/verify-email', data)
    },

    /** 忘记密码 */
    forgotPassword: async (data: ForgotPasswordRequest): Promise<void> => {
      await client.post('/auth/forgot-password', data)
    },

    /** 重置密码 */
    resetPassword: async (data: ResetPasswordRequest): Promise<void> => {
      await client.post('/auth/reset-password', data)
    },

    /** 重发验证码 */
    resendCode: async (data: ResendCodeRequest): Promise<void> => {
      await client.post('/auth/resend-code', data)
    },

    /** 获取当前用户信息 */
    getMe: async (): Promise<CloudUser> => {
      const response = await client.get<CloudUser>('/auth/me')
      return response.data
    },

    /** 刷新 token */
    refreshToken: async (refreshToken: string): Promise<RefreshTokenResponse> => {
      const response = await client.post<RefreshTokenResponse>('/auth/refresh', {
        refresh_token: refreshToken,
      })
      return response.data
    },

    /** 获取 Google OAuth 状态 */
    getGoogleOAuthStatus: async (): Promise<{ configured: boolean }> => {
      const response = await client.get<{ configured: boolean }>('/auth/google/status')
      return response.data
    },

    /** 获取 Google 登录 URL */
    getGoogleLoginUrl: (baseUrl: string, redirectUrl: string = '/'): string => {
      const params = new URLSearchParams({ redirect_url: redirectUrl })
      return `${baseUrl}/auth/google?${params}`
    },

    /** 获取欢迎奖励信息 */
    getWelcomeBonusInfo: async (): Promise<WelcomeBonusInfo> => {
      const response = await client.get<WelcomeBonusInfo>('/auth/welcome-bonus')
      return response.data
    },

    /** 更新用户档案 */
    updateProfile: async (data: { name?: string; image?: string }): Promise<CloudUser> => {
      const response = await client.patch<CloudUser>('/user/profile', data)
      return response.data
    },
  }
}

/** Auth API 实例类型 */
export type AuthApi = ReturnType<typeof createAuthApi>
