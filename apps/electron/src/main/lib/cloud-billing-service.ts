/**
 * Cloud 账单服务（主进程）
 *
 * 复用 auth service 的 API Client，封装账单/支付 API 调用。
 * 所有方法统一返回 BillingIpcResponse<T> 格式。
 */

import { BrowserWindow } from 'electron'
import {
  createBillingApi,
  createPaymentApi,
  createSubscriptionApi,
  isApiError,
} from '@proma/cloud'
import type { BillingApi, PaymentApi, SubscriptionApi } from '@proma/cloud'
import type {
  BillingInfo,
  CheckBalanceResponse,
  PaymentTiersResponse,
  CreateWechatPaymentResponse,
  CreateStripePaymentResponse,
  OrderRecord,
  VerifyVipResponse,
  QueryExternalBalanceResponse,
  TransferCreditsResponse,
  BillingIpcResponse,
  SubscriptionTiersResponse,
  SubscriptionStatusResponse,
  SubscriptionOrderRecord,
  CreateSubscriptionWechatResponse,
} from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import { getApiClient, setQuotaExceededHandler } from './cloud-auth-service'

// ===== API 实例（延迟初始化） =====

let billingApi: BillingApi | null = null
let paymentApi: PaymentApi | null = null
let subscriptionApi: SubscriptionApi | null = null

function getBillingApi(): BillingApi {
  if (!billingApi) {
    billingApi = createBillingApi(getApiClient())
  }
  return billingApi
}

function getPaymentApi(): PaymentApi {
  if (!paymentApi) {
    paymentApi = createPaymentApi(getApiClient())
  }
  return paymentApi
}

function getSubscriptionApi(): SubscriptionApi {
  if (!subscriptionApi) {
    subscriptionApi = createSubscriptionApi(getApiClient())
  }
  return subscriptionApi
}

// ===== 额度不足广播 =====

/** 向所有窗口发送额度不足事件 */
function broadcastQuotaExceeded(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED)
  })
  console.log('[Cloud Billing] 已广播额度不足事件')
}

// ===== 初始化 =====

/** 初始化账单服务（注册 402 回调） */
export function initBillingService(): void {
  setQuotaExceededHandler(broadcastQuotaExceeded)
  console.log('[Cloud Billing] 账单服务已初始化')
}

// ===== 统一错误处理 =====

function wrapError(error: unknown): string {
  if (isApiError(error)) return error.message
  return error instanceof Error ? error.message : '未知错误'
}

// ===== 公开 API =====

/** 获取账单信息 */
export async function getBilling(): Promise<BillingIpcResponse<BillingInfo>> {
  try {
    const data = await getBillingApi().getBilling()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 检查余额 */
export async function checkBalance(): Promise<BillingIpcResponse<CheckBalanceResponse>> {
  try {
    const data = await getBillingApi().checkBalance()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取套餐列表 */
export async function getTiers(): Promise<BillingIpcResponse<PaymentTiersResponse>> {
  try {
    const data = await getPaymentApi().getTiers()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 创建微信支付 */
export async function createWechatPayment(tierId: string): Promise<BillingIpcResponse<CreateWechatPaymentResponse>> {
  try {
    const data = await getPaymentApi().createWechatPayment(tierId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 创建 Stripe 支付 */
export async function createStripePayment(tierId: string): Promise<BillingIpcResponse<CreateStripePaymentResponse>> {
  try {
    const data = await getPaymentApi().createStripePayment(tierId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 查询订单状态 */
export async function getOrderStatus(orderNo: string): Promise<BillingIpcResponse<OrderRecord>> {
  try {
    const data = await getPaymentApi().getOrderStatus(orderNo)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取订单历史 */
export async function getOrders(): Promise<BillingIpcResponse<OrderRecord[]>> {
  try {
    const data = await getPaymentApi().getOrders()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** VIP 验证 */
export async function verifyVip(apiKey: string): Promise<BillingIpcResponse<VerifyVipResponse>> {
  try {
    const data = await getPaymentApi().verifyVip(apiKey)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 查询外部余额 */
export async function queryExternalBalance(apiKey: string): Promise<BillingIpcResponse<QueryExternalBalanceResponse>> {
  try {
    const data = await getPaymentApi().queryExternalBalance(apiKey)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 迁移额度 */
export async function transferCredits(apiKey: string, amount: number): Promise<BillingIpcResponse<TransferCreditsResponse>> {
  try {
    const data = await getPaymentApi().transferCredits(apiKey, amount)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

// ===== 订阅相关 =====

/** 获取订阅档位列表 */
export async function getSubscriptionTiers(): Promise<BillingIpcResponse<SubscriptionTiersResponse>> {
  try {
    const data = await getSubscriptionApi().getTiers()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取当前活跃订阅 */
export async function getSubscriptionCurrent(): Promise<BillingIpcResponse<SubscriptionStatusResponse>> {
  try {
    const data = await getSubscriptionApi().getCurrent()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 创建订阅微信支付 */
export async function createSubscriptionWechat(tierId: string): Promise<BillingIpcResponse<CreateSubscriptionWechatResponse>> {
  try {
    const data = await getSubscriptionApi().createWechatPayment(tierId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 查询订阅订单状态 */
export async function getSubscriptionOrderStatus(orderNo: string): Promise<BillingIpcResponse<SubscriptionOrderRecord>> {
  try {
    const data = await getSubscriptionApi().getOrderStatus(orderNo)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 获取订阅历史 */
export async function getSubscriptionHistory(): Promise<BillingIpcResponse<SubscriptionOrderRecord[]>> {
  try {
    const data = await getSubscriptionApi().getHistory()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}
