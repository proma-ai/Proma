/**
 * Cloud 账单服务（主进程）
 *
 * 复用 auth service 的 API Client，封装账单/订阅 API 调用。
 * 所有方法统一返回 BillingIpcResponse<T> 格式。
 */

import { BrowserWindow } from 'electron'
import {
  createBillingApi,
  createSubscriptionApi,
  isApiError,
} from '@proma/cloud'
import type { BillingApi, SubscriptionApi } from '@proma/cloud'
import type {
  BillingInfo,
  CheckBalanceResponse,
  BillingIpcResponse,
  SubscriptionTiersResponse,
  SubscriptionStatusResponse,
  SubscriptionOrderRecord,
  CreateSubscriptionWechatResponse,
} from '@proma/shared'
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import { getApiClient, setQuotaExceededHandler } from './cloud-auth-service'
import { AsyncTtlCache } from './async-ttl-cache'

// ===== API 实例（延迟初始化） =====

let billingApi: BillingApi | null = null
let subscriptionApi: SubscriptionApi | null = null

// 聚合同一轮 focus/多窗口事件的重复读取；扣费完成时会显式失效。
const billingCache = new AsyncTtlCache<BillingInfo>(5_000)

function getBillingApi(): BillingApi {
  if (!billingApi) {
    billingApi = createBillingApi(getApiClient())
  }
  return billingApi
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
    const data = await billingCache.getOrLoad(() => getBillingApi().getBilling())
    return { success: true, data }
  } catch (error) {
    return { success: false, error: wrapError(error) }
  }
}

/** 扣费完成后失效；并发窗口会合并为一次新的余额读取。 */
export function invalidateBillingCache(): void {
  billingCache.invalidate()
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
