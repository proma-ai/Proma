/**
 * SidebarCreditTooltip - 侧边栏额度悬浮提示
 *
 * 不在侧边栏常驻渲染额度样式；用户悬浮左下角资料区时才显示精确余额。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { billingInfoAtom } from '@/atoms/cloud-billing'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { calcTotalAvailable } from '@proma/shared'

interface SidebarCreditTooltipProps {
  children: React.ReactElement
}

export function SidebarCreditTooltip({ children }: SidebarCreditTooltipProps): React.ReactElement {
  const billing = useAtomValue(billingInfoAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)

  if (!isCloudMode() || !isAuthenticated || !billing) return children

  const totalAvailable = calcTotalAvailable(billing)
  const formattedTotal = totalAvailable < 10 ? totalAvailable.toFixed(2) : Math.floor(totalAvailable)

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>剩余 {formattedTotal} 积分</p>
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
