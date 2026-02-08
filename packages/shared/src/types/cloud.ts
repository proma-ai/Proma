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

/** 外部余额查询响应 */
export interface QueryExternalBalanceResponse {
  credits: number
  usedQuota: number
  remainQuotaInUsd: number
}

/** 额度迁移响应 */
export interface TransferCreditsResponse {
  success: boolean
  message: string
  newBalance?: number
  credits?: number
}

/** 账单 IPC 通用响应 */
export interface BillingIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ===== Cloud 模型相关类型 =====

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
  // 额度迁移
  QUERY_EXTERNAL_BALANCE: 'cloud:payment:query-external-balance',
  TRANSFER_CREDITS: 'cloud:payment:transfer-credits',
  // 额度不足推送通道（主进程 → 渲染进程）
  QUOTA_EXCEEDED: 'cloud:billing:quota-exceeded',
  // 余额变动推送通道（主进程 → 渲染进程，如对话扣费后）
  BILLING_CHANGED: 'cloud:billing:changed',
  // 官方渠道同步
  SYNC_OFFICIAL_CHANNEL: 'cloud:channel:sync-official',
  // 官方渠道更新推送通道（主进程 → 渲染进程）
  OFFICIAL_CHANNEL_UPDATED: 'cloud:channel:official-updated',
} as const
