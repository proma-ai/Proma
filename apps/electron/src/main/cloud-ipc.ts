/**
 * Cloud IPC 处理器
 *
 * 仅在 PROMA_MODE=cloud 时注册。
 * 内部调用 cloud-auth-service 和 cloud-billing-service 的函数。
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
  updateCloudProfile,
} from './lib/cloud-auth-service'
import {
  initBillingService,
  getBilling,
  checkBalance,
  getTiers,
  createWechatPayment,
  createStripePayment,
  getOrderStatus,
  getOrders,
  verifyVip,
  queryExternalBalance,
  transferCredits,
  getSubscriptionTiers,
  getSubscriptionCurrent,
  createSubscriptionWechat,
  getSubscriptionOrderStatus,
  getSubscriptionHistory,
} from './lib/cloud-billing-service'
import {
  initOfficialChannel,
  refreshOfficialModels,
} from './lib/cloud-channel-service'
import {
  listApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
} from './lib/cloud-api-keys-service'
import { downloadCloudPrompts } from './lib/cloud-prompts-service'
import {
  getUsageLogs,
  getToolUsageLogs,
  getSpeechUsageLogs,
  getAgentUsageLogs,
} from './lib/cloud-usage-service'
import type {
  ApiKeyCreateParams,
  ApiKeyUpdateParams,
  UsageQueryParams,
} from '@proma/shared'

/**
 * 注册 Cloud IPC 处理器
 *
 * 初始化认证服务并注册所有 Cloud IPC 通道
 */
export async function registerCloudIpcHandlers(): Promise<void> {
  // 初始化认证服务（恢复 token + 验证）
  await initCloudAuthService()

  // 初始化账单服务（注册 402 回调）
  initBillingService()

  // 初始化官方渠道（认证成功后拉取模型列表）
  await initOfficialChannel()

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

  // ===== 用户档案更新 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.UPDATE_PROFILE,
    async (_, data: { name?: string; image?: string }) => {
      return updateCloudProfile(data)
    },
  )

  // ===== 官方渠道同步 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.SYNC_OFFICIAL_CHANNEL,
    async () => {
      return refreshOfficialModels()
    },
  )

  // ===== 账单相关 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_BILLING,
    async () => {
      return getBilling()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.CHECK_BALANCE,
    async () => {
      return checkBalance()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_TIERS,
    async () => {
      return getTiers()
    },
  )

  // ===== 支付相关 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.CREATE_WECHAT_PAYMENT,
    async (_, tierId: string) => {
      return createWechatPayment(tierId)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.CREATE_STRIPE_PAYMENT,
    async (_, tierId: string) => {
      return createStripePayment(tierId)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_ORDER_STATUS,
    async (_, orderNo: string) => {
      return getOrderStatus(orderNo)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_ORDERS,
    async () => {
      return getOrders()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.VERIFY_VIP,
    async (_, apiKey: string) => {
      return verifyVip(apiKey)
    },
  )

  // ===== 额度迁移 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.QUERY_EXTERNAL_BALANCE,
    async (_, apiKey: string) => {
      return queryExternalBalance(apiKey)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.TRANSFER_CREDITS,
    async (_, apiKey: string, amount: number) => {
      return transferCredits(apiKey, amount)
    },
  )

  // ===== API Key 管理 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.LIST_API_KEYS,
    async () => {
      return listApiKeys()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.CREATE_API_KEY,
    async (_, params: ApiKeyCreateParams) => {
      return createApiKey(params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.UPDATE_API_KEY,
    async (_, keyId: string, params: ApiKeyUpdateParams) => {
      return updateApiKey(keyId, params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.DELETE_API_KEY,
    async (_, keyId: string) => {
      return deleteApiKey(keyId)
    },
  )

  // ===== 订阅相关 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_TIERS,
    async () => {
      return getSubscriptionTiers()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_CURRENT,
    async () => {
      return getSubscriptionCurrent()
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.CREATE_SUBSCRIPTION_WECHAT,
    async (_, tierId: string) => {
      return createSubscriptionWechat(tierId)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_ORDER_STATUS,
    async (_, orderNo: string) => {
      return getSubscriptionOrderStatus(orderNo)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_HISTORY,
    async () => {
      return getSubscriptionHistory()
    },
  )

  // ===== 提示词下载 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.DOWNLOAD_CLOUD_PROMPTS,
    async () => {
      return downloadCloudPrompts()
    },
  )

  // ===== 用量日志 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getUsageLogs(params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_TOOL_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getToolUsageLogs(params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_SPEECH_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getSpeechUsageLogs(params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_AGENT_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getAgentUsageLogs(params)
    },
  )

  console.log('[Cloud IPC] 已注册 Cloud 认证 + 账单 + 官方渠道 + API Key + 订阅 + 提示词下载 + 用量日志 处理器')
}
