/**
 * Cloud 账单状态 Atoms
 *
 * 管理渲染进程的账单/支付状态
 */

import { atom } from 'jotai'
import type {
  BillingInfo,
  PaymentTier,
  PaymentMethod,
  OrderRecord,
  SubscriptionTier,
  SubscriptionStatusResponse,
} from '@proma/shared'
import { calcTotalAvailable } from '@proma/shared'

// ===== 账单状态 =====

/** 账单信息 */
export const billingInfoAtom = atom<BillingInfo | null>(null)

/** 账单加载中 */
export const billingLoadingAtom = atom<boolean>(false)

/** 额度不足弹窗是否显示 */
export const quotaExceededDialogAtom = atom<boolean>(false)

// ===== 支付状态 =====

/** 套餐列表 */
export const paymentTiersAtom = atom<PaymentTier[]>([])

/** 是否 VIP */
export const isVipAtom = atom<boolean>(false)

/** 折扣等级 */
export const discountLevelAtom = atom<number>(0)

/** 当前选择的套餐 ID */
export const selectedTierIdAtom = atom<string | null>(null)

/** 当前选择的支付方式 */
export const selectedPaymentMethodAtom = atom<PaymentMethod>('wechat')

// ===== 订单历史 =====

/** 订单列表 */
export const orderHistoryAtom = atom<OrderRecord[]>([])

// ===== 订阅状态 =====

/** 订阅档位列表 */
export const subscriptionTiersAtom = atom<SubscriptionTier[]>([])

/** 当前订阅汇总 */
export const subscriptionStatusAtom = atom<SubscriptionStatusResponse | null>(null)

// ===== 派生 Atoms =====

/** 余额显示（格式化后的字符串，包含订阅额度和企业分配额度） */
export const creditsDisplayAtom = atom<string>((get) => {
  const billing = get(billingInfoAtom)
  if (!billing) return '0.00 积分'
  const total = calcTotalAvailable(billing)
  return `${total.toFixed(2)} 积分`
})

// ===== 初始化函数 =====

/**
 * 初始化账单数据
 *
 * 从主进程获取账单信息 + 订阅额度不足事件
 * 返回清理函数
 */
export function initializeBilling(
  setBillingInfo: (info: BillingInfo | null) => void,
  setBillingLoading: (loading: boolean) => void,
  setQuotaExceededDialog: (open: boolean) => void,
): () => void {
  setBillingLoading(true)

  // 获取账单信息
  window.electronAPI.cloudBilling.getBilling()
    .then((result) => {
      if (result.success && result.data) {
        setBillingInfo(result.data)
      }
      setBillingLoading(false)
    })
    .catch((error) => {
      console.error('[Cloud Billing] 获取账单信息失败:', error)
      setBillingLoading(false)
    })

  // 订阅额度不足事件
  const unsubscribe = window.electronAPI.cloudBilling.onQuotaExceeded(() => {
    setQuotaExceededDialog(true)
  })

  return unsubscribe
}
