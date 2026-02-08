/**
 * SidebarCreditIndicator - 侧边栏余额指示器
 *
 * 仅在 Cloud 模式下显示，点击跳转到账单设置
 * 显示订阅额度 + 预充值余额的合计值
 * 当订阅额度用完时，钱包图标变色提醒
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

  // 计算总可用额度
  const rawCredits = typeof billing.credits === 'string' ? parseFloat(billing.credits) : billing.credits
  const subRemaining = typeof billing.subscriptionQuotaRemaining === 'string'
    ? parseFloat(billing.subscriptionQuotaRemaining)
    : (billing.subscriptionQuotaRemaining ?? 0)
  const totalAvailable = (isNaN(rawCredits) ? 0 : rawCredits) + (isNaN(subRemaining) ? 0 : subRemaining)

  // 当有订阅且订阅额度即将用完时（< $1），显示橙色提醒
  const hasSubscription = billing.hasActiveSubscription
  const subLow = hasSubscription && !isNaN(subRemaining) && subRemaining < 1
  const isLow = totalAvailable < 1

  // 橙色：总余额不足 或 订阅额度耗尽
  const showWarning = isLow || subLow

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted/50 titlebar-no-drag"
    >
      <Wallet size={16} className={showWarning ? 'text-orange-500' : 'text-muted-foreground'} />
      <span className={showWarning ? 'text-orange-500 font-medium' : 'text-muted-foreground'}>
        {credits}
      </span>
    </button>
  )
}
