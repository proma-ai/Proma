/**
 * @proma/cloud - Cloud 模式基础设施
 *
 * 提供商业版功能的基础设施：登录鉴权、云端同步、支付额度等
 * PROMA_MODE=local 时不影响任何现有功能
 */

// 模式工具
export { isCloudMode, getPromaMode } from './mode'

// 配置
export { getCloudApiConfig } from './config'
export type { CloudApiConfig } from './config'

// 类型
export * from './types/index'

// API
export {
  createApiClient,
  isApiError,
  createAuthApi,
  createBillingApi,
  createModelsApi,
  createApiKeysApi,
  createSubscriptionApi,
  createPromptsApi,
  createUsageApi,
  createNotificationsApi,
  normalizePendingNotifications,
} from './api/index'
export type {
  CloudApiClient,
  ApiResponse,
  ApiError,
  TokenStorage,
  QuotaExceededHandler,
  AuthFailedHandler,
  AuthApi,
  BillingApi,
  ModelsApi,
  ApiKeysApi,
  SubscriptionApi,
  PromptsApi,
  UsageApi,
  NotificationsApi,
  NotificationsApiClient,
} from './api/index'
