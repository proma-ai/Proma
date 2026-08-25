import type { BillingInfo } from '@proma/shared'

function formatPoints(value: number | string | null | undefined): string {
  const numericValue = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) return '0.00'
  return numericValue.toFixed(2)
}

/**
 * 模型选择器中 Proma 官方渠道的紧凑额度说明。
 * 仅呈现当前存在的订阅和企业额度，避免占用模型行的可用宽度。
 */
export function buildOfficialChannelQuotaSummary(billing: BillingInfo | null): string | null {
  if (!billing) return null

  const parts: string[] = []
  if (billing.hasActiveSubscription) {
    parts.push(`订阅剩余 ${formatPoints(billing.subscriptionQuotaRemaining)} 积分`)
  }
  if (billing.enterprise != null) {
    parts.push(`企业分配额度 ${formatPoints(billing.enterpriseAllocatedBalance)} 积分`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
