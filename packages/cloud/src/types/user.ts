/**
 * 用户相关类型定义（Cloud 模式）
 * 参考 proma-frontend/src/types/user.ts，适配 Proma Electron 风格
 */

import type { CloudUserInfo } from '@proma/shared'

/** 用户角色 */
export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN'

/** 用户状态 */
export type UserStatus = 'PENDING' | 'APPROVED' | 'DISABLED'

/** 计费模式 */
export type BillingMode = 'PREPAID' | 'SUBSCRIPTION'

/** Cloud 用户完整信息（扩展基础用户信息） */
export interface CloudUser extends CloudUserInfo {
  role: UserRole
  status: UserStatus
  billingMode: BillingMode
  credits: number
  monthlyQuota: number
  usedQuotaMonthly: number
  usedQuota: number
  discountLevel: number
  vipVerifiedAt?: string | null
  vipSourceKey?: string | null
  createdAt: string
  updatedAt: string
  lastLoginAt?: string | null
}

/** 认证响应（前端格式） */
export interface AuthResponse {
  user: CloudUser
  token: string
  refreshToken?: string
}

/** FastAPI 原始认证响应 */
export interface FastAPIAuthResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  user: CloudUser
}

/** Token 刷新响应 */
export interface RefreshTokenResponse {
  access_token: string
  refresh_token?: string
}

/** 登录请求 */
export interface LoginRequest {
  email: string
  password: string
}

/** 注册请求 */
export interface RegisterRequest {
  email: string
  password: string
  name: string
}

/** 邮箱验证请求 */
export interface VerifyEmailRequest {
  email: string
  code: string
}

/** 忘记密码请求 */
export interface ForgotPasswordRequest {
  email: string
}

/** 重置密码请求 */
export interface ResetPasswordRequest {
  email: string
  code: string
  password: string
}

/** 重发验证码请求 */
export interface ResendCodeRequest {
  email: string
}

/** 欢迎奖励信息 */
export interface WelcomeBonusInfo {
  enabled: boolean
  amount: string
  currency: string
  messages: Record<string, string>
  descriptions: Record<string, string>
}
