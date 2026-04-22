/**
 * 账单计算工具函数
 */

import type { BillingInfo } from '../types/cloud'

/**
 * 计算总可用额度：预充值 + 订阅剩余 + 企业分配额度
 */
export function calcTotalAvailable(info: BillingInfo): number {
  const credits = typeof info.credits === 'string'
    ? parseFloat(info.credits as string)
    : info.credits
  const subRemaining = typeof info.subscriptionQuotaRemaining === 'string'
    ? parseFloat(info.subscriptionQuotaRemaining as string)
    : (info.subscriptionQuotaRemaining ?? 0)
  const enterpriseBalance = typeof info.enterpriseAllocatedBalance === 'string'
    ? parseFloat(info.enterpriseAllocatedBalance as string)
    : (info.enterpriseAllocatedBalance ?? 0)

  return (isNaN(credits) ? 0 : credits)
    + (isNaN(subRemaining) ? 0 : subRemaining)
    + (isNaN(enterpriseBalance) ? 0 : enterpriseBalance)
}
