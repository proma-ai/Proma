/**
 * SidebarCreditIndicator - 侧边栏余额常驻指示器
 *
 * 仅在 Cloud 模式下显示，点击跳转到账单设置。
 * 用户可在通用设置关闭，关闭后仍能从左下角资料区的悬浮提示查看余额。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Sparkles, Wallet } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { cn } from '@/lib/utils'
import { calcTotalAvailable } from '@proma/shared'

/** 根据总可用额度返回进度条百分比和颜色（阈值制）。 */
function getThresholdVisual(totalAvailable: number): { percent: number; color: string } {
  if (totalAvailable >= 200) return { percent: 100, color: 'bg-emerald-500' }
  if (totalAvailable >= 50) return { percent: 70, color: 'bg-emerald-500' }
  if (totalAvailable >= 20) return { percent: 40, color: 'bg-amber-500' }
  if (totalAvailable >= 5) return { percent: 15, color: 'bg-orange-500' }
  return { percent: Math.max(2, totalAvailable), color: 'bg-orange-500' }
}

export function SidebarCreditIndicator(): React.ReactElement | null {
  const billing = useAtomValue(billingInfoAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  if (!isCloudMode() || !isAuthenticated || !billing) return null

  const totalAvailable = calcTotalAvailable(billing)
  const { percent, color: barColor } = getThresholdVisual(totalAvailable)
  const formattedTotal = totalAvailable < 10 ? totalAvailable.toFixed(2) : Math.floor(totalAvailable)
  const hasSubscription = billing.hasActiveSubscription
  const isLow = totalAvailable < 1
  const iconColor = isLow ? 'text-orange-500' : hasSubscription ? 'text-purple-500' : 'text-muted-foreground'

  const handleClick = (): void => {
    setSettingsTab('billing')
    setSettingsOpen(true)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50 titlebar-no-drag"
          >
            <Wallet size={15} className={cn(iconColor, 'shrink-0')} />
            <div className="min-w-0 flex-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/80">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', barColor)}
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              </div>
            </div>
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
              {formattedTotal}
            </span>
            {hasSubscription && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-purple-500">
                <Sparkles size={8} />
                Pro
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>剩余 {formattedTotal} 积分</p>
          {billing.enterprise != null && Number(billing.enterpriseAllocatedBalance ?? 0) > 0 && (
            <p className="text-muted-foreground">
              含团队 {Number(billing.enterpriseAllocatedBalance ?? 0).toFixed(2)} 积分
            </p>
          )}
          <p className="mt-1 text-muted-foreground">可在通用设置关闭常驻显示</p>
          <button
            type="button"
            onClick={handleClick}
            className="mt-2 inline-flex h-7 w-full items-center justify-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            去充值
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
