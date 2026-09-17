/**
 * Cloud IPC 处理器
 *
 * 仅在 PROMA_MODE=cloud 时注册。
 * 内部调用 cloud-auth-service 和 cloud-billing-service 的函数。
 */

import { ipcMain } from 'electron'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import type { SubscriptionHistoryQuery } from '@proma/shared'
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
  getPendingCloudNotifications,
  acknowledgeCloudNotification,
} from './lib/cloud-notification-service'
import {
  initBillingService,
  getBilling,
  checkBalance,
  getSubscriptionTiers,
  getSubscriptionCurrent,
  createSubscriptionWechat,
  getSubscriptionOrderStatus,
  getSubscriptionHistory,
} from './lib/cloud-billing-service'
import {
  initOfficialChannel,
  refreshOfficialModels,
  startModelsPolling,
} from './lib/cloud-channel-service'
import {
  listApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
} from './lib/cloud-api-keys-service'
import { downloadCloudPrompts } from './lib/cloud-prompts-service'
import { getModelHealth } from './lib/cloud-health-service'
import { getAgentWorkspaceBySlug } from './lib/agent-workspace-manager'
import {
  getUsageLogs,
  getToolUsageLogs,
  getSpeechUsageLogs,
  getAgentUsageLogs,
  getAgentTokenActivity,
  getAgentTurnUsage,
  getCombinedUsageLogs,
} from './lib/cloud-usage-service'
import {
  checkEnterpriseSkillUpdates,
  getEnterpriseSkill,
  getEnterpriseSkills,
  installEnterpriseSkill,
  publishEnterpriseSkill,
  publishEnterpriseSkillVersion,
} from './lib/enterprise-skills-service'
import type {
  ApiKeyCreateParams,
  ApiKeyUpdateParams,
  UsageQueryParams,
  EnterpriseSkill,
  EnterpriseSkillPublishInput,
  SkillMeta,
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

  // ===== 实时通知 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_PENDING_NOTIFICATIONS,
    async () => getPendingCloudNotifications(),
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.ACKNOWLEDGE_NOTIFICATION,
    async (_, notificationId: string) => acknowledgeCloudNotification(notificationId),
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
    async (_, params?: SubscriptionHistoryQuery) => {
      return getSubscriptionHistory(params)
    },
  )

  // ===== 提示词下载 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.DOWNLOAD_CLOUD_PROMPTS,
    async () => {
      return downloadCloudPrompts()
    },
  )

  // ===== 模型健康检查 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_MODEL_HEALTH,
    async () => {
      return getModelHealth()
    },
  )

  // 启动官方模型列表定时轮询（每 20 分钟）
  startModelsPolling()

  // ===== 用量日志 =====

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getUsageLogs(params)
    },
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_COMBINED_USAGE_LOGS,
    async (_, params?: UsageQueryParams) => {
      return getCombinedUsageLogs(params)
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

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_AGENT_TOKEN_ACTIVITY,
    async () => getAgentTokenActivity(),
  )

  ipcMain.handle(
    CLOUD_IPC_CHANNELS.GET_AGENT_TURN_USAGE,
    async (_, turnId: string) => getAgentTurnUsage(turnId),
  )

  // ===== 企业 Skills =====
  // Renderer 传入的 slug 不可信：只允许已注册的工作区，阻止 ../ 等路径穿越进入配置目录。
  const requireRegisteredWorkspaceSlug = (workspaceSlug: string): string => {
    if (!/^[a-z0-9-]+$/i.test(workspaceSlug) || !getAgentWorkspaceBySlug(workspaceSlug)) {
      throw new Error('无效或不存在的 Agent 工作区')
    }
    return workspaceSlug
  }
  ipcMain.handle(CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_LIST, async () => getEnterpriseSkills())
  ipcMain.handle(CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_GET, async (_, skillId: string) => getEnterpriseSkill(skillId))
  ipcMain.handle(
    CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_PUBLISH,
    async (_, workspaceSlug: string, input: EnterpriseSkillPublishInput) => publishEnterpriseSkill(requireRegisteredWorkspaceSlug(workspaceSlug), input),
  )
  ipcMain.handle(
    CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_PUBLISH_VERSION,
    async (_, workspaceSlug: string, skillId: string, input: EnterpriseSkillPublishInput) => publishEnterpriseSkillVersion(requireRegisteredWorkspaceSlug(workspaceSlug), skillId, input),
  )
  ipcMain.handle(
    CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_INSTALL,
    async (_, workspaceSlug: string, skill: EnterpriseSkill) => installEnterpriseSkill(requireRegisteredWorkspaceSlug(workspaceSlug), skill),
  )
  ipcMain.handle(
    CLOUD_IPC_CHANNELS.ENTERPRISE_SKILLS_CHECK_UPDATES,
    async (_, workspaceSlug: string, skills: SkillMeta[]) => checkEnterpriseSkillUpdates(requireRegisteredWorkspaceSlug(workspaceSlug), skills),
  )

  console.log('[Cloud IPC] 已注册 Cloud 认证、通知、账单、渠道、用量与企业 Skills处理器')
}
