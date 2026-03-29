/**
 * Cloud 模式相关类型和常量
 */

/** 应用运行模式 */
export type PromaMode = 'local' | 'cloud'

/** Cloud 用户基础信息（跨 IPC 传输的轻量用户数据） */
export interface CloudUserInfo {
  id: string
  email: string
  name: string
  image?: string | null
  avatar?: string | null
  status: 'PENDING' | 'APPROVED' | 'DISABLED'
}

/** Cloud 认证状态快照 */
export interface CloudAuthState {
  isAuthenticated: boolean
  user: CloudUserInfo | null
}

/** Cloud 认证 IPC 响应 */
export interface CloudAuthIpcResponse {
  success: boolean
  user?: CloudUserInfo
  error?: string
}

// ===== 账单/支付相关类型 =====

/** 支付方式 */
export type PaymentMethod = 'wechat' | 'stripe'

/** 支付渠道（后端返回） */
export type PaymentChannel = 'WECHAT' | 'STRIPE'

/** 计费模式 */
export type BillingMode = 'PREPAID' | 'SUBSCRIPTION'

/** 订单状态 */
export type OrderStatusType = 'PENDING' | 'PAID' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'REFUNDED'

/** 支付套餐 */
export interface PaymentTier {
  id: string
  name: string
  credits: number
  amount_cny: number
  amount_usd: number
  original_cny: number
  original_usd: number
  has_discount: boolean
}

/** 套餐列表响应 */
export interface PaymentTiersResponse {
  tiers: PaymentTier[]
  discount_level: number
  is_vip: boolean
}

/** 微信支付创建响应 */
export interface CreateWechatPaymentResponse {
  order_no: string
  code_url: string
  amount: number
  expire_at: string
}

/** Stripe 支付创建响应 */
export interface CreateStripePaymentResponse {
  order_no: string
  checkout_url: string
}

/** 订单记录 */
export interface OrderRecord {
  order_no: string
  status: OrderStatusType
  tier: string
  amount: number
  credits: number
  payment_channel: PaymentChannel
  created_at: string
  paid_at: string | null
  completed_at: string | null
}

/** 账单信息 */
export interface BillingInfo {
  billingMode: BillingMode
  credits: number
  monthlyQuota: number
  usedQuotaMonthly: number
  usedQuota: number
  discountLevel: number
  /** 订阅额度汇总 */
  subscriptionQuotaTotal: number
  subscriptionQuotaUsed: number
  subscriptionQuotaRemaining: number
  hasActiveSubscription: boolean
}

// ===== 订阅相关类型 =====

/** 订阅订单状态 */
export type SubscriptionOrderStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'

/** 订阅档位 */
export interface SubscriptionTier {
  id: string       // lite/standard/pro/max
  name: string     // Lite/Standard/Pro/Max
  quota: number    // 额度（积分）
  amount_cny: number // 价格 (分)
}

/** 订阅档位列表响应 */
export interface SubscriptionTiersResponse {
  tiers: SubscriptionTier[]
}

/** 订阅订单记录 */
export interface SubscriptionOrderRecord {
  id: string
  tier: string
  tier_name: string
  quota: number
  used_quota: number
  remaining_quota: number
  amount: number
  order_no: string
  status: SubscriptionOrderStatus
  start_at: string
  expires_at: string
  paid_at: string | null
  created_at: string
}

/** 当前订阅汇总 */
export interface SubscriptionStatusResponse {
  has_active: boolean
  total_quota: number
  total_used: number
  total_remaining: number
  subscriptions: SubscriptionOrderRecord[]
}

/** 创建订阅微信支付响应 */
export interface CreateSubscriptionWechatResponse {
  order_no: string
  code_url: string
  amount: number
  expire_at: string
}

/** 余额检查响应 */
export interface CheckBalanceResponse {
  sufficient: boolean
  message: string
  credits: number
  billingMode: BillingMode
}

/** VIP 验证响应 */
export interface VerifyVipResponse {
  success: boolean
  discount_level: number
  message: string
}

/** 账单 IPC 通用响应 */
export interface BillingIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ===== Cloud 模型相关类型 =====

/** System API Key 响应（Agent SDK 使用 pk_xxx 格式 key 走后端代理） */
export interface SystemApiKeyResponse {
  id: string
  key: string      // pk_xxx 格式
  name: string
  type: 'SYSTEM' | 'CUSTOM'
  status: 'ACTIVE' | 'DISABLED' | 'EXPIRED'
  createdAt: string
}

// ===== 用户 API Key 管理相关类型 =====

/** API Key 类型 */
export type ApiKeyType = 'SYSTEM' | 'CUSTOM'

/** API Key 状态 */
export type ApiKeyStatus = 'ACTIVE' | 'DISABLED' | 'EXPIRED'

/** API Key 响应 */
export interface ApiKeyResponse {
  id: string
  name: string
  description: string | null
  key: string
  type: ApiKeyType
  status: ApiKeyStatus
  expiresAt: string | null
  lastUsedAt: string | null
  totalCost: number | string
  requestCount: number
  createdAt: string
  updatedAt: string
}

/** 创建 API Key 的响应（包含实际 key，仅在创建时返回一次） */
export interface ApiKeyCreateResponse {
  id: string
  name: string
  description: string | null
  key: string
  type: ApiKeyType
  status: ApiKeyStatus
  expiresAt: string | null
  createdAt: string
}

/** 创建 API Key 的请求参数 */
export interface ApiKeyCreateParams {
  name: string
  description?: string
  expiresAt?: string
}

/** 更新 API Key 的请求参数 */
export interface ApiKeyUpdateParams {
  name?: string
  description?: string
  status?: ApiKeyStatus
}

/** Cloud 模型配置（单个模型） */
export interface CloudModelConfig {
  id: string
  name: string
  icon: string
  provider: string
  supportsReasoning?: boolean
}

/** Cloud 模型分组（按供应商分组） */
export interface CloudModelGroup {
  provider: { id: string; name: string; icon: string }
  models: CloudModelConfig[]
}

/** Cloud IPC 通道常量（用于主进程和渲染进程通信） */
export const CLOUD_IPC_CHANNELS = {
  // 认证相关
  LOGIN: 'cloud:auth:login',
  REGISTER: 'cloud:auth:register',
  LOGOUT: 'cloud:auth:logout',
  REFRESH_TOKEN: 'cloud:auth:refresh-token',
  GET_ME: 'cloud:auth:get-me',
  GET_AUTH_STATE: 'cloud:auth:get-state',
  // 邮箱验证 / 密码重置
  VERIFY_EMAIL: 'cloud:auth:verify-email',
  FORGOT_PASSWORD: 'cloud:auth:forgot-password',
  RESET_PASSWORD: 'cloud:auth:reset-password',
  RESEND_CODE: 'cloud:auth:resend-code',
  // Google OAuth
  GET_GOOGLE_OAUTH_STATUS: 'cloud:auth:google-oauth-status',
  OPEN_GOOGLE_LOGIN: 'cloud:auth:open-google-login',
  // 用户档案更新
  UPDATE_PROFILE: 'cloud:auth:update-profile',
  // 认证状态变化推送通道（主进程 → 渲染进程）
  AUTH_STATE_CHANGED: 'cloud:auth:state-changed',
  // 账单相关
  GET_BILLING: 'cloud:billing:get',
  CHECK_BALANCE: 'cloud:billing:check-balance',
  GET_TIERS: 'cloud:billing:get-tiers',
  // 支付相关
  CREATE_WECHAT_PAYMENT: 'cloud:payment:create-wechat',
  CREATE_STRIPE_PAYMENT: 'cloud:payment:create-stripe',
  GET_ORDER_STATUS: 'cloud:payment:order-status',
  GET_ORDERS: 'cloud:payment:orders',
  VERIFY_VIP: 'cloud:payment:verify-vip',
  // 额度不足推送通道（主进程 → 渲染进程）
  QUOTA_EXCEEDED: 'cloud:billing:quota-exceeded',
  // 余额变动推送通道（主进程 → 渲染进程，如对话扣费后）
  BILLING_CHANGED: 'cloud:billing:changed',
  // 官方渠道同步
  SYNC_OFFICIAL_CHANNEL: 'cloud:channel:sync-official',
  // 官方渠道更新推送通道（主进程 → 渲染进程）
  OFFICIAL_CHANNEL_UPDATED: 'cloud:channel:official-updated',
  // API Key 管理
  LIST_API_KEYS: 'cloud:api-keys:list',
  CREATE_API_KEY: 'cloud:api-keys:create',
  UPDATE_API_KEY: 'cloud:api-keys:update',
  DELETE_API_KEY: 'cloud:api-keys:delete',
  // 订阅相关
  GET_SUBSCRIPTION_TIERS: 'cloud:subscription:get-tiers',
  GET_SUBSCRIPTION_CURRENT: 'cloud:subscription:get-current',
  CREATE_SUBSCRIPTION_WECHAT: 'cloud:subscription:create-wechat',
  GET_SUBSCRIPTION_ORDER_STATUS: 'cloud:subscription:order-status',
  GET_SUBSCRIPTION_HISTORY: 'cloud:subscription:history',
  // 提示词下载
  DOWNLOAD_CLOUD_PROMPTS: 'cloud:prompts:download',
  // 模型健康检查
  GET_MODEL_HEALTH: 'cloud:model-health:get',
  /** 健康数据更新推送通道（主进程 → 渲染进程） */
  MODEL_HEALTH_UPDATED: 'cloud:model-health:updated',
  // 用量日志
  GET_USAGE_LOGS: 'cloud:usage:get',
  GET_TOOL_USAGE_LOGS: 'cloud:usage:get-tool',
  GET_SPEECH_USAGE_LOGS: 'cloud:usage:get-speech',
  GET_AGENT_USAGE_LOGS: 'cloud:usage:get-agent',
} as const

// ===== 用量日志相关类型 =====

/** 日期筛选 */
export type DateFilter = 'today' | 'yesterday' | 'all'

/** 用量查询参数 */
export interface UsageQueryParams {
  dateFilter?: DateFilter
  page?: number
  pageSize?: number
}

/** 模型调用日志项 */
export interface UsageLogItem {
  id: string
  modelId: string
  modelName: string
  conversationId?: string | null
  inputTokens: number
  outputTokens: number
  totalCost: number | string
  createdAt: string
}

/** 模型调用统计 */
export interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number | string
}

/** 模型调用日志响应 */
export interface UsageLogResponse {
  items: UsageLogItem[]
  total: number
  page: number
  pageSize: number
  stats: UsageStats
}

/** 语音用量日志项 */
export interface SpeechUsageLogItem {
  id: string
  modelId: string | null
  modelName: string
  durationSeconds: number
  cost: number | string
  status: 'SUCCESS' | 'FAILED'
  errorMessage: string | null
  createdAt: string
}

/** 语音用量统计 */
export interface SpeechUsageStats {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalDurationSeconds: number
  totalCost: number | string
}

/** 语音用量日志响应 */
export interface SpeechUsageLogResponse {
  items: SpeechUsageLogItem[]
  total: number
  page: number
  pageSize: number
  stats: SpeechUsageStats
}

/** 工具调用日志项 */
export interface ToolUsageLogItem {
  id: string
  toolName: string
  toolInput: string | null
  conversationId: string | null
  cost: number | string
  createdAt: string
}

/** 工具调用统计 */
export interface ToolUsageStats {
  totalRequests: number
  totalCost: number | string
}

/** 工具调用日志响应 */
export interface ToolUsageLogResponse {
  items: ToolUsageLogItem[]
  total: number
  page: number
  pageSize: number
  stats: ToolUsageStats
}

/** Agent API 调用日志项 */
export interface AgentUsageLogItem {
  id: string
  apiKeyId: string
  apiKeyName: string
  endpoint: string
  modelId: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  webSearchRequests: number
  webFetchRequests: number
  totalCost: number | string
  responseStatus: number | null
  durationMs: number | null
  createdAt: string
}

/** Agent API 调用统计 */
export interface AgentUsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalCost: number | string
  successCount: number
  errorCount: number
}

/** Agent API 调用日志响应 */
export interface AgentUsageLogResponse {
  items: AgentUsageLogItem[]
  total: number
  page: number
  pageSize: number
  stats: AgentUsageStats
}

// ===== 云端提示词相关类型 =====

/** 云端提示词响应（后端 PromptResponse） */
export interface CloudPromptResponse {
  id: string
  name: string
  content: string
  description: string | null
  userId: string | null
  isDefault: boolean
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** 云端提示词列表响应 */
export interface CloudPromptsListResponse {
  privatePrompts: CloudPromptResponse[]
  publicPrompts: CloudPromptResponse[]
  globalDefault: CloudPromptResponse | null
  userDefault: CloudPromptResponse | null
  userDefaultPromptId: string | null
}

/** 下载云端提示词结果 */
export interface DownloadCloudPromptsResult {
  success: boolean
  imported: number
  error?: string
}
