/**
 * BalanceCard - 余额卡片
 *
 * 显示账户余额、本月用量、累计用量、VIP 状态
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { billingInfoAtom, isVipAtom, discountLevelAtom } from '@/atoms/cloud-billing'

function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '$0.00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '$0.00'
  return `$${num.toFixed(2)}`
}

export function BalanceCard(): React.ReactElement | null {
  const billing = useAtomValue(billingInfoAtom)
  const isVip = useAtomValue(isVipAtom)
  const discountLevel = useAtomValue(discountLevelAtom)

  if (!billing) return null

  const discountPercent = discountLevel > 0 ? Math.round((1 - discountLevel) * 100) : 0

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs text-muted-foreground">账户余额</p>
              <p className="text-lg font-semibold">{formatCurrency(billing.credits)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">本月用量</p>
              <p className="text-lg font-semibold">{formatCurrency(billing.usedQuotaMonthly)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">累计用量</p>
              <p className="text-lg font-semibold">{formatCurrency(billing.usedQuota)}</p>
            </div>
          </div>
          {isVip && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              VIP {discountPercent > 0 ? `${100 - discountPercent}折` : ''}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
