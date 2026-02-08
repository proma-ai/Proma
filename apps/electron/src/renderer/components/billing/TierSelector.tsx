/**
 * TierSelector - 套餐选择网格
 */

import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PaymentTier } from '@proma/shared'

interface TierSelectorProps {
  tiers: PaymentTier[]
  selectedTier: string | null
  onSelect: (tierId: string) => void
}

export function TierSelector({ tiers, selectedTier, onSelect }: TierSelectorProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">选择充值档位</h3>
      <div className="grid grid-cols-4 gap-3">
        {tiers.map((tier) => (
          <Card
            key={tier.id}
            className={cn(
              'cursor-pointer transition-all border hover:shadow-md',
              selectedTier === tier.id && 'ring-2 ring-primary border-primary'
            )}
            onClick={() => onSelect(tier.id)}
          >
            <CardContent className="pt-4 pb-4 text-center">
              <p className="font-semibold text-sm">{tier.name}</p>
              <p className="text-xl font-bold text-primary mt-1">${tier.credits}</p>
              <div className="mt-2 text-xs">
                {tier.has_discount ? (
                  <>
                    <p className="text-muted-foreground line-through">
                      ¥{(tier.original_cny / 100).toFixed(0)}
                    </p>
                    <p className="text-green-600 dark:text-green-400 font-medium">
                      ¥{(tier.amount_cny / 100).toFixed(0)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    ¥{(tier.amount_cny / 100).toFixed(0)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
