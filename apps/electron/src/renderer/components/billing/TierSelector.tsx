/**
 * TierSelector - 充值套餐选择网格
 *
 * 彩色渐变卡片 + 玻璃质感，价格层级清晰
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check, Zap, Crown, Rocket, Flame } from 'lucide-react'
import type { PaymentTier } from '@proma/shared'

interface TierSelectorProps {
  tiers: PaymentTier[]
  selectedTier: string | null
  onSelect: (tierId: string) => void
}

/** 充值档位的视觉配置 */
interface RechargeTierVisual {
  icon: React.ReactNode
  subtitle: string
  cardBg: string
  cardExtra: string
  textColor: string
  mutedColor: string
  priceColor: string
  buttonClass: string
  dividerColor: string
}

const RECHARGE_VISUALS: RechargeTierVisual[] = [
  {
    icon: <Zap size={18} />,
    subtitle: '尝鲜体验',
    cardBg: 'bg-stone-50/80 dark:bg-stone-900/40',
    cardExtra: 'backdrop-blur-sm border border-stone-200/60 dark:border-stone-700/40',
    textColor: 'text-stone-800 dark:text-stone-200',
    mutedColor: 'text-stone-500 dark:text-stone-400',
    priceColor: 'text-stone-800 dark:text-stone-100',
    buttonClass: 'bg-stone-200/60 hover:bg-stone-200 text-stone-700 dark:bg-stone-700/50 dark:hover:bg-stone-700/70 dark:text-stone-200',
    dividerColor: 'border-stone-200/80 dark:border-stone-700/50',
  },
  {
    icon: <Crown size={18} />,
    subtitle: '轻度使用',
    cardBg: 'bg-gradient-to-b from-indigo-600/90 via-indigo-700/88 to-slate-700/85 dark:from-indigo-700/88 dark:via-indigo-800/85 dark:to-slate-800/82',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-slate-100',
    mutedColor: 'text-slate-300/80',
    priceColor: 'text-white',
    buttonClass: 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm',
    dividerColor: 'border-white/12',
  },
  {
    icon: <Rocket size={18} />,
    subtitle: '日常使用',
    cardBg: 'bg-gradient-to-b from-rose-600/90 via-orange-600/88 to-amber-700/85 dark:from-rose-700/88 dark:via-orange-700/85 dark:to-amber-800/82',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-orange-50',
    mutedColor: 'text-orange-200/70',
    priceColor: 'text-white',
    buttonClass: 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm',
    dividerColor: 'border-white/12',
  },
  {
    icon: <Flame size={18} />,
    subtitle: '大量使用',
    cardBg: 'bg-gradient-to-b from-neutral-900/95 via-stone-900/93 to-black/90 dark:from-black/95 dark:via-neutral-950/93 dark:to-black/90',
    cardExtra: 'backdrop-blur-md border border-white/10',
    textColor: 'text-neutral-200',
    mutedColor: 'text-neutral-400',
    priceColor: 'text-white',
    buttonClass: 'bg-white/12 hover:bg-white/20 text-neutral-200 backdrop-blur-sm',
    dividerColor: 'border-white/8',
  },
]

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_VISUAL = RECHARGE_VISUALS[0]!

export function TierSelector({ tiers, selectedTier, onSelect }: TierSelectorProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {tiers.map((tier, index) => {
          const isSelected = selectedTier === tier.id
          const hasDis = tier.has_discount
          const actualCny = (tier.amount_cny / 100).toFixed(0)
          const originalCny = (tier.original_cny / 100).toFixed(0)
          const visual = RECHARGE_VISUALS[index] ?? DEFAULT_VISUAL
          const discount = hasDis
            ? Math.round((1 - tier.amount_cny / tier.original_cny) * 100)
            : 0

          const isLight = index === 0

          return (
            <div
              key={tier.id}
              className={cn(
                'relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200',
                visual.cardBg,
                visual.cardExtra,
                isSelected
                  ? isLight
                    ? 'ring-2 ring-stone-400/60 shadow-xl scale-[1.02]'
                    : 'ring-2 ring-white/60 shadow-xl scale-[1.02]'
                  : 'shadow-lg hover:shadow-xl hover:scale-[1.01]',
              )}
              onClick={() => onSelect(tier.id)}
            >
              <div className="px-4 pt-5 pb-5">
                {/* 图标 + 档位名 */}
                <div className="flex items-center gap-2 mb-1">
                  <div className={isLight ? 'text-stone-500 dark:text-stone-400' : 'text-white/80'}>{visual.icon}</div>
                  <h3 className={cn('text-base font-bold', visual.textColor)}>{tier.name}</h3>
                </div>
                <p className={cn('text-[11px] mb-4', visual.mutedColor)}>{visual.subtitle}</p>

                {/* 价格区域 */}
                <div className="mb-1">
                  <div className="flex items-baseline gap-1">
                    <span className={cn('text-2xl font-bold tracking-tight', visual.priceColor)}>
                      ¥{actualCny}
                    </span>
                  </div>
                  <p className={cn('text-[11px] mt-0.5', visual.mutedColor)}>
                    {tier.credits} 积分
                  </p>
                  {hasDis && discount > 0 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={cn('text-[11px] line-through', visual.mutedColor)}>
                        ¥{originalCny}
                      </span>
                      <span className="text-[10px] font-medium text-emerald-300 bg-emerald-400/15 px-1.5 py-0.5 rounded">
                        省 {discount}%
                      </span>
                    </div>
                  )}
                </div>

                {/* 分隔线 */}
                <div className={cn('border-t my-3', visual.dividerColor)} />

                {/* 选择按钮 */}
                <button
                  className={cn(
                    'w-full py-2 rounded-lg text-xs font-medium transition-all',
                    isSelected
                      ? isLight
                        ? 'bg-stone-800 text-white shadow-sm dark:bg-stone-200 dark:text-stone-900'
                        : 'bg-white text-stone-800 shadow-sm dark:bg-white dark:text-stone-900'
                      : visual.buttonClass,
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(tier.id)
                  }}
                >
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1">
                      <Check size={12} strokeWidth={2.5} />
                      已选择
                    </span>
                  ) : '选择'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
