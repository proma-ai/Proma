/**
 * SidebarCreditTooltip - 侧边栏额度悬浮提示
 *
 * 用户悬浮左下角资料区时显示精确余额，并提示可在通用设置调整常驻显示。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { sidebarCreditIndicatorVisibleAtom } from '@/atoms/ui-preferences'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { calcTotalAvailable } from '@proma/shared'

interface SidebarCreditTooltipProps {
  children: React.ReactElement
}

export function SidebarCreditTooltip({ children }: SidebarCreditTooltipProps): React.ReactElement {
  const billing = useAtomValue(billingInfoAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const sidebarCreditIndicatorVisible = useAtomValue(sidebarCreditIndicatorVisibleAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  if (!isCloudMode() || !isAuthenticated || !billing) return children

  const totalAvailable = calcTotalAvailable(billing)
  const formattedTotal = totalAvailable < 10 ? totalAvailable.toFixed(2) : Math.floor(totalAvailable)

  const handleRecharge = (): void => {
    setSettingsTab('billing')
    setSettingsOpen(true)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="pointer-events-auto text-xs">
          <p>剩余 {formattedTotal} 积分</p>
          {billing.enterprise != null && Number(billing.enterpriseAllocatedBalance ?? 0) > 0 && (
            <p className="text-muted-foreground">
              含团队 {Number(billing.enterpriseAllocatedBalance ?? 0).toFixed(2)} 积分
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            {sidebarCreditIndicatorVisible
              ? '可在通用设置关闭常驻显示'
              : '已关闭常驻显示，可在通用设置重新开启'}
          </p>
          <button
            type="button"
            onClick={handleRecharge}
            className="mt-2 inline-flex h-7 w-full items-center justify-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            去充值
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
