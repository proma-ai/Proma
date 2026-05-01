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

/** 根据总可用额度返回进度条百分比和颜色（阈值制） */
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

  const handleClick = (): void => {
    setSettingsTab('billing')
    setSettingsOpen(true)
  }

  const totalAvailable = calcTotalAvailable(billing)
  const { percent, color: barColor } = getThresholdVisual(totalAvailable)

  const hasSubscription = billing.hasActiveSubscription
  const isLow = totalAvailable < 1
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

            {/* 阈值制进度条：基于总可用额度 */}
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
