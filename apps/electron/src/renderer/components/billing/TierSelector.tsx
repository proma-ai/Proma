/**
 * TierSelector - 充值套餐选择网格
 *
 * 莫兰迪色调 + 玻璃质感卡片，与订阅计划保持一致的设计范式
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import type { PaymentTier } from '@proma/shared'

interface TierSelectorProps {
  tiers: PaymentTier[]
  selectedTier: string | null
  onSelect: (tierId: string) => void
}

/** 充值档位的视觉配置，莫兰迪色调 */
interface RechargeTierVisual {
  cardBg: string
  cardExtra: string
  textColor: string
  mutedColor: string
  priceColor: string
  accentColor: string
  discountBg: string
  discountText: string
}

const RECHARGE_VISUALS: RechargeTierVisual[] = [
  {
    cardBg: 'bg-stone-50/80 dark:bg-stone-900/40',
    cardExtra: 'backdrop-blur-sm border border-stone-200/60 dark:border-stone-700/40',
    textColor: 'text-stone-800 dark:text-stone-200',
    mutedColor: 'text-stone-500 dark:text-stone-400',
    priceColor: 'text-stone-800 dark:text-stone-100',
    accentColor: 'text-primary',
    discountBg: 'bg-emerald-500/90',
    discountText: 'text-white',
  },
  {
    cardBg: 'bg-gradient-to-br from-slate-500/80 via-stone-500/80 to-stone-600/80 dark:from-slate-600/75 dark:via-stone-600/75 dark:to-stone-700/75',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-stone-100',
    mutedColor: 'text-stone-300/80',
    priceColor: 'text-white',
    accentColor: 'text-white',
    discountBg: 'bg-emerald-400/20',
    discountText: 'text-emerald-300',
  },
  {
    cardBg: 'bg-gradient-to-br from-indigo-600/80 via-slate-600/80 to-slate-700/80 dark:from-indigo-700/75 dark:via-slate-600/75 dark:to-slate-700/75',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-slate-100',
    mutedColor: 'text-slate-300/80',
    priceColor: 'text-white',
    accentColor: 'text-white',
    discountBg: 'bg-emerald-400/20',
    discountText: 'text-emerald-300',
  },
  {
    cardBg: 'bg-gradient-to-br from-rose-600/75 via-orange-600/75 to-amber-700/75 dark:from-rose-700/70 dark:via-orange-700/70 dark:to-amber-800/70',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-orange-50',
    mutedColor: 'text-orange-200/70',
    priceColor: 'text-white',
    accentColor: 'text-white',
    discountBg: 'bg-emerald-400/20',
    discountText: 'text-emerald-300',
  },
]

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_VISUAL = RECHARGE_VISUALS[0]!

export function TierSelector({ tiers, selectedTier, onSelect }: TierSelectorProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">选择充值档位</h3>
      <div className="grid grid-cols-4 gap-3">
        {tiers.map((tier, index) => {
          const isSelected = selectedTier === tier.id
          const hasDis = tier.has_discount
          const actualCny = (tier.amount_cny / 100).toFixed(0)
          const originalCny = (tier.original_cny / 100).toFixed(0)
          const visual = RECHARGE_VISUALS[index] ?? DEFAULT_VISUAL

          return (
            <div
              key={tier.id}
              className={cn(
                'relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200',
                visual.cardBg,
                visual.cardExtra,
                isSelected
                  ? 'ring-2 ring-white/60 shadow-xl scale-[1.02]'
                  : 'shadow-lg hover:shadow-xl hover:scale-[1.01]',
              )}
              onClick={() => onSelect(tier.id)}
            >
              {/* 折扣条 */}
              {hasDis && (
                <div className={cn('text-center py-1', visual.discountBg)}>
                  <span className={cn('text-[10px] font-semibold tracking-wide', visual.discountText)}>优惠</span>
                </div>
              )}

              <div className={cn('px-4 py-5 text-center', hasDis && 'pt-3')}>
                <p className={cn('font-semibold text-sm', visual.textColor)}>{tier.name}</p>
                <p className={cn('text-xl font-bold mt-2', visual.accentColor)}>${tier.credits}</p>

                <div className="mt-3 space-y-0.5">
                  {hasDis ? (
                    <>
                      <p className={cn('text-xs line-through', visual.mutedColor)}>¥{originalCny}</p>
                      <p className="text-base text-emerald-400 font-bold">¥{actualCny}</p>
                    </>
                  ) : (
                    <p className={cn('text-base font-medium', visual.mutedColor)}>¥{actualCny}</p>
                  )}
                </div>

                {/* 选中指示器 */}
                {isSelected && (
                  <div className="mt-3">
                    <div className={cn('inline-flex items-center gap-1 text-xs font-medium', visual.accentColor)}>
                      <Check size={12} strokeWidth={2.5} />
                      已选择
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
