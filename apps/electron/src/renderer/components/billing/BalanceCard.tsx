/**
 * BalanceCard - 账户总览卡片
 *
 * 干净白底风格，左侧主额度 + 右侧分区统计
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Badge } from '@/components/ui/badge'
import { billingInfoAtom, isVipAtom, discountLevelAtom } from '@/atoms/cloud-billing'
import { calcTotalAvailable } from '@proma/shared'

function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0.00 积分'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0.00 积分'
  return `${num.toFixed(2)} 积分`
}

export function BalanceCard(): React.ReactElement | null {
  const billing = useAtomValue(billingInfoAtom)
  const isVip = useAtomValue(isVipAtom)
  const discountLevel = useAtomValue(discountLevelAtom)

  if (!billing) return null

  const discountPercent = discountLevel > 0 ? Math.round((1 - discountLevel) * 100) : 0
  const hasSubscription = billing.hasActiveSubscription

  const totalAvailable = calcTotalAvailable(billing)
  const hasEnterprise = billing.enterprise != null
  const enterpriseBalance = billing.enterpriseAllocatedBalance ?? 0

  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between">
          {/* 左侧：总额度 */}
          <div>
            <p className="text-xs text-muted-foreground font-medium">总可用额度</p>
            <p className="text-3xl font-bold tracking-tight mt-1">{formatCurrency(totalAvailable)}</p>
            <div className="flex items-center gap-2 mt-2.5">
              {hasSubscription && (
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 font-medium bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  订阅中
                </Badge>
              )}
              {isVip && (
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  VIP {discountPercent > 0 ? `${100 - discountPercent}折` : ''}
                </Badge>
              )}
            </div>
          </div>

          {/* 右侧：统计数据 */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-right">
            <div>
              <p className="text-[11px] text-muted-foreground">预充值</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(billing.credits)}</p>
            </div>
            {hasSubscription ? (
              <div>
                <p className="text-[11px] text-muted-foreground">订阅剩余</p>
                <p className="text-sm font-semibold mt-0.5">{formatCurrency(billing.subscriptionQuotaRemaining)}</p>
              </div>
            ) : (
              <div />
            )}
            {hasEnterprise && (
              <div className="col-span-2">
                <p className="text-[11px] text-muted-foreground">
                  团队额度
                  <span className="ml-1 text-muted-foreground/60">来自: {billing.enterprise?.name}</span>
                </p>
                <p className="text-sm font-semibold mt-0.5">{formatCurrency(enterpriseBalance)}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] text-muted-foreground">本月用量</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(billing.usedQuotaMonthly)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">累计用量</p>
              <p className="text-sm font-semibold mt-0.5">{formatCurrency(billing.usedQuota)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
