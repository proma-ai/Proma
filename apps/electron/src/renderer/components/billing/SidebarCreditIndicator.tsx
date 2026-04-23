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
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { cn } from '@/lib/utils'
import { calcTotalAvailable } from '@proma/shared'

/** 根据百分比返回进度条颜色 */
function getBarColor(percent: number): string {
  if (percent <= 15) return 'bg-orange-500'
  if (percent <= 40) return 'bg-amber-500'
  return 'bg-emerald-500'
}

/** 纯积分模式：根据余额阈值返回指示色 */
function getCreditThresholdColor(credits: number): string {
  if (credits < 20) return 'bg-red-500'
  if (credits < 50) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function SidebarCreditIndicator(): React.ReactElement | null {
  const billing = useAtomValue(billingInfoAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  if (!isCloudMode() || !isAuthenticated || !billing) return null

  const handleClick = (): void => {
    setSettingsTab('billing')
    setSettingsOpen(true)
  }

  // 计算可用额度（含企业分配额度）
  const totalAvailable = calcTotalAvailable(billing)

  const rawCredits = typeof billing.credits === 'string' ? parseFloat(billing.credits) : billing.credits
  const creditsVal = isNaN(rawCredits) ? 0 : rawCredits

  // 进度百分比：基于当前正在消费的订阅包，而非所有订阅总和
  // - 有当前消费中的订阅包 → 进度条 = 该包剩余 / 该包总额度
  // - 所有订阅已用完或无订阅，仍有积分 → 100%（积分无固定容量上限）
  // - 无任何额度 → 0%
  const curQuota = typeof billing.currentSubscriptionQuota === 'string'
    ? parseFloat(billing.currentSubscriptionQuota) : (billing.currentSubscriptionQuota ?? 0)
  const curUsed = typeof billing.currentSubscriptionUsed === 'string'
    ? parseFloat(billing.currentSubscriptionUsed) : (billing.currentSubscriptionUsed ?? 0)

  let percent: number
  const hasCurrentSub = curQuota > 0
  if (hasCurrentSub) {
    percent = Math.min(100, ((curQuota - curUsed) / curQuota) * 100)
  } else if (creditsVal > 0) {
    percent = 100
  } else {
    percent = 0
  }

  const hasSubscription = billing.hasActiveSubscription
  const isLow = totalAvailable < 1

  const barColor = hasCurrentSub ? getBarColor(percent) : getCreditThresholdColor(creditsVal)
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

            {hasCurrentSub ? (
              /* 订阅模式：进度条 */
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-muted/80 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', barColor)}
                    style={{ width: `${Math.max(2, percent)}%` }}
                  />
                </div>
              </div>
            ) : (
              /* 纯积分模式：阈值色小圆点 */
              <div className="flex-1 min-w-0 flex items-center">
                <div className={cn('size-2 rounded-full', barColor)} />
              </div>
            )}

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
          <p>剩余 {totalAvailable < 10 ? totalAvailable.toFixed(2) : Math.floor(totalAvailable)} 积分</p>
          {billing.enterprise != null && Number(billing.enterpriseAllocatedBalance ?? 0) > 0 && (
            <p className="text-muted-foreground">
              含团队 {Number(billing.enterpriseAllocatedBalance ?? 0).toFixed(2)} 积分
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
