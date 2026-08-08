/**
 * Pi 的部分错误不会保留 HTTP 402 状态；仅供 Proma 官方渠道把额度不足的错误文本分类为账单错误。
 */
const PROMA_BILLING_ERROR_PATTERN = /insufficient_quota|payment_required|积分不足|余额不足/i

export function isPromaBillingErrorText(value: string): boolean {
  return PROMA_BILLING_ERROR_PATTERN.test(value)
}
