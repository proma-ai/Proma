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

/** 可安全展示的 Cloud 认证失败类别。 */
export type CloudAuthErrorReason = 'network' | 'timeout' | 'server' | 'rate_limited' | 'auth' | 'client' | 'unknown'

/** Cloud 认证 IPC 响应 */
export interface CloudAuthIpcResponse {
  success: boolean
  user?: CloudUserInfo
  error?: string
  errorReason?: CloudAuthErrorReason
  retryable?: boolean
}

// ===== 实时通知相关类型 =====

/** Proma Cloud 向桌面端投递的富媒体通知。 */
export interface CloudNotification {
  id: string
  title: string
  bodyMarkdown: string
  /** 旧服务端不会返回媒体字段。 */
  mediaUrl?: string | null
  mediaType?: 'image' | 'video' | null
  platform: string
  publishedAt: string
}

/** 桌面客户端向 API 标识的目标平台。 */
export type CloudNotificationClientPlatform = 'macos' | 'windows'

/** 通知 IPC 通用响应。 */
export interface CloudNotificationIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 验证来自 Cloud 通知 API 的负载，避免不完整数据进入渲染进程。 */
export function isCloudNotification(value: unknown): value is CloudNotification {
  if (typeof value !== 'object' || value === null) return false
  const notification = value as Record<string, unknown>
  return typeof notification.id === 'string'
    && typeof notification.title === 'string'
    && typeof notification.bodyMarkdown === 'string'
    && typeof notification.platform === 'string'
    && typeof notification.publishedAt === 'string'
}

// ===== 账单/支付相关类型 =====

/** 计费模式 */
export type BillingMode = 'PREPAID' | 'SUBSCRIPTION'

/** 企业成员可见的 Skills 权益；实际操作仍由服务端二次鉴权。 */
export interface EnterpriseSkillsCapability {
  enabled: boolean
  canPublish: boolean
}

/** 企业成员可见的功能集合。 */
export interface EnterpriseCapabilities {
  skills: EnterpriseSkillsCapability
}

/** 企业基础信息与权益（账单响应内嵌） */
export interface EnterpriseBrief {
  id: string
  name: string
  role: 'ADMIN' | 'MEMBER'
  capabilities: EnterpriseCapabilities
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
  /** 当前正在消费的订阅包（FIFO 第一个有剩余额度的） */
  currentSubscriptionQuota?: number
  currentSubscriptionUsed?: number
  /** 企业信息（仅企业成员返回，非成员为 null） */
  enterprise?: EnterpriseBrief | null
  /** 企业分配额度（非成员时后端返回 0） */
  enterpriseAllocatedBalance?: number
}

// ===== 订阅相关类型 =====

/** 订阅订单状态 */
export type SubscriptionOrderStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'

/** 订阅档位 */
export interface SubscriptionTier {
  id: string       // lite/standard/pro/max
  name: string     // Lite/Standard/Pro/Max
  base_quota: number // 购买基础额度（积分）
  bonus_quota: number // 赠送额度（积分）
  quota: number    // 实际到账总额度（积分）
  amount_cny: number // 价格 (分)
  duration_days: number // 每笔购买独立有效期（天）
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

/** 订阅订单历史查询参数 */
export interface SubscriptionHistoryQuery {
  page?: number
  page_size?: number
}

/** 订阅订单历史分页结果 */
export interface SubscriptionOrderHistoryResponse {
  items: SubscriptionOrderRecord[]
  total: number
  page: number
  page_size: number
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
  quotaLimit: number | string | null
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
  quotaLimit: number | string | null
  createdAt: string
}

/** 创建 API Key 的请求参数 */
export interface ApiKeyCreateParams {
  name: string
  description?: string
  expiresAt?: string
  quotaLimit?: number | null
}

/** 更新 API Key 的请求参数 */
export interface ApiKeyUpdateParams {
  name?: string
  description?: string
  status?: ApiKeyStatus
  quotaLimit?: number | null
}

/** Cloud 模型配置（单个模型） */
export interface CloudModelConfig {
  id: string
  name: string
  icon: string
  provider: string
  supportsReasoning?: boolean
  /** Existing model metadata from the Cloud catalog; the desktop only reads modelListHint. */
  metadata?: { modelListHint?: unknown } | null
  /** Global order for the official Chat model picker. Optional for API rollout compatibility. */
  chatSortOrder?: number
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
  // 实时通知
  GET_PENDING_NOTIFICATIONS: 'cloud:notifications:get-pending',
  ACKNOWLEDGE_NOTIFICATION: 'cloud:notifications:acknowledge',
  // 账单相关
  GET_BILLING: 'cloud:billing:get',
  CHECK_BALANCE: 'cloud:billing:check-balance',
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
  GET_AGENT_TOKEN_ACTIVITY: 'cloud:usage:get-agent-token-activity',
  GET_AGENT_TURN_USAGE: 'cloud:usage:get-agent-turn',
  GET_COMBINED_USAGE_LOGS: 'cloud:usage:get-combined',
  // 企业 Skills（远端请求与本地制品处理都由主进程负责）
  ENTERPRISE_SKILLS_LIST: 'cloud:enterprise-skills:list',
  ENTERPRISE_SKILLS_GET: 'cloud:enterprise-skills:get',
  ENTERPRISE_SKILLS_PUBLISH: 'cloud:enterprise-skills:publish',
  ENTERPRISE_SKILLS_PUBLISH_VERSION: 'cloud:enterprise-skills:publish-version',
  ENTERPRISE_SKILLS_INSTALL: 'cloud:enterprise-skills:install',
  ENTERPRISE_SKILLS_CHECK_UPDATES: 'cloud:enterprise-skills:check-updates',
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

/** Proma Agent / API Key 每日 Token 用量（不包含 Chat、工具和语音） */
export interface AgentTokenActivityItem {
  date: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
}

export interface AgentTokenActivityResponse {
  items: AgentTokenActivityItem[]
  startDate: string
  endDate: string
}

/** Inclusive Beijing-calendar date range for Agent Token activity. */
export interface AgentTokenActivityQuery {
  startDate?: string
  endDate?: string
}

/** Authoritative current-user ledger aggregate for one official Agent turn. */
export interface AgentTurnUsage {
  turnId: string
  found: boolean
  requestCount: number
  totalCost: number | string
}

/** 统一调用日志项：Proma 模型调用或 Agent API 调用 */
export interface CombinedUsageLogItem {
  id: string
  source: 'model' | 'agent'
  modelId: string | null
  modelName: string
  apiKeyName: string | null
  endpoint: string | null
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

/** 统一调用日志统计 */
export interface CombinedUsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalCost: number | string
}

/** 统一调用日志响应 */
export interface CombinedUsageLogResponse {
  items: CombinedUsageLogItem[]
  total: number
  page: number
  pageSize: number
  stats: CombinedUsageStats
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
