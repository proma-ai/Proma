/**
 * SidebarCreditIndicator - 侧边栏余额指示器
 *
 * 仅在 Cloud 模式下显示，点击跳转到账单设置
 * 默认显示进度条，hover 时 tooltip 显示精确金额，降低用户焦虑
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Wallet, Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { creditsDisplayAtom, billingInfoAtom } from '@/atoms/cloud-billing'
import { activeViewAtom } from '@/atoms/active-view'
import { settingsTabAtom } from '@/atoms/settings-tab'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { cn } from '@/lib/utils'

/** 根据百分比返回进度条颜色 */
function getBarColor(percent: number): string {
  if (percent <= 15) return 'bg-orange-500'
  if (percent <= 40) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function SidebarCreditIndicator(): React.ReactElement | null {
  const credits = useAtomValue(creditsDisplayAtom)
  const billing = useAtomValue(billingInfoAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  if (!isCloudMode() || !isAuthenticated || !billing) return null

  const handleClick = (): void => {
    setSettingsTab('billing')
    setActiveView('settings')
  }

  // 计算可用额度
  const rawCredits = typeof billing.credits === 'string' ? parseFloat(billing.credits) : billing.credits
  const subRemaining = typeof billing.subscriptionQuotaRemaining === 'string'
    ? parseFloat(billing.subscriptionQuotaRemaining)
    : (billing.subscriptionQuotaRemaining ?? 0)
  const subTotal = typeof billing.subscriptionQuotaTotal === 'string'
    ? parseFloat(billing.subscriptionQuotaTotal)
    : (billing.subscriptionQuotaTotal ?? 0)

  const creditsVal = isNaN(rawCredits) ? 0 : rawCredits
  const subRemainingVal = isNaN(subRemaining) ? 0 : subRemaining
  const subTotalVal = isNaN(subTotal) ? 0 : subTotal
  const totalAvailable = creditsVal + subRemainingVal

  // 进度百分比：(剩余额度 / 总额度上限) * 100
  // 总额度上限 = 预充值余额 + 订阅总额度（预充值部分视为 100% 可用）
  const totalCapacity = creditsVal + subTotalVal
  const percent = totalCapacity > 0 ? Math.min(100, (totalAvailable / totalCapacity) * 100) : 0

  const hasSubscription = billing.hasActiveSubscription
  const isLow = totalAvailable < 1

  const barColor = getBarColor(percent)
  const iconColor = isLow ? 'text-orange-500' : hasSubscription ? 'text-purple-500' : 'text-muted-foreground'

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted/50 titlebar-no-drag"
          >
            <Wallet size={15} className={cn(iconColor, 'shrink-0')} />

            {/* 进度条 */}
            <div className="flex-1 min-w-0">
              <div className="h-1.5 rounded-full bg-muted/80 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', barColor)}
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              </div>
            </div>

            {/* 余额数字 */}
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
              {totalAvailable < 10 ? totalAvailable.toFixed(2) : Math.floor(totalAvailable)}
            </span>

            {hasSubscription && (
              <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500">
                <Sparkles size={8} />
                Pro
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          剩余 {credits}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
