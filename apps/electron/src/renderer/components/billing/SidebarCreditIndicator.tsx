/**
 * SidebarCreditIndicator - 侧边栏余额指示器
 *
 * 仅在 Cloud 模式下显示，点击跳转到账单设置
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Wallet } from 'lucide-react'
import { creditsDisplayAtom, billingInfoAtom } from '@/atoms/cloud-billing'
import { activeViewAtom } from '@/atoms/active-view'
import { settingsTabAtom } from '@/atoms/settings-tab'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'

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

  // 余额不足时高亮显示
  const rawCredits = typeof billing.credits === 'string' ? parseFloat(billing.credits) : billing.credits
  const isLow = !isNaN(rawCredits) && rawCredits < 1

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted/50 titlebar-no-drag"
    >
      <Wallet size={16} className={isLow ? 'text-orange-500' : 'text-muted-foreground'} />
      <span className={isLow ? 'text-orange-500 font-medium' : 'text-muted-foreground'}>
        {credits}
      </span>
    </button>
  )
}
