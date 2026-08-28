/**
 * BillingSettings - 账单设置主页
 *
 * 显示在设置面板的"账单"tab 中（仅 Cloud 模式）
 * 包含：余额卡片 + 订阅计划
 */

import * as React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { BalanceCard } from './BalanceCard'
import { SubscriptionTab } from './SubscriptionTab'
import { WhyPromaOfficial, BillingNotes } from './WhyPromaOfficial'
import {
  billingInfoAtom,
  billingLoadingAtom,
  subscriptionTiersAtom,
  subscriptionStatusAtom,
} from '@/atoms/cloud-billing'

interface BillingSettingsProps {
  /** onboarding 弹窗模式：隐藏余额卡片，「为什么选择 Proma 官方的 AI 渠道？」由弹窗顶部统一展示 */
  onboarding?: boolean
}

export function BillingSettings({ onboarding = false }: BillingSettingsProps): React.ReactElement {
  const billingLoading = useAtomValue(billingLoadingAtom)
  const billingInfo = useAtomValue(billingInfoAtom)
  const setBillingInfo = useSetAtom(billingInfoAtom)
  const setSubTiers = useSetAtom(subscriptionTiersAtom)
  const setSubStatus = useSetAtom(subscriptionStatusAtom)

  /** 加载账单信息 */
  const refreshBilling = React.useCallback(async () => {
    const result = await window.electronAPI.cloudBilling.getBilling()
    if (result.success && result.data) {
      setBillingInfo(result.data)
    }
  }, [setBillingInfo])

  /** 加载订阅档位和当前订阅 */
  const refreshSubscription = React.useCallback(async () => {
    const [tiersResult, currentResult] = await Promise.all([
      window.electronAPI.cloudSubscription.getTiers(),
      window.electronAPI.cloudSubscription.getCurrent(),
    ])
    if (tiersResult.success && tiersResult.data) {
      setSubTiers(tiersResult.data.tiers)
    }
    if (currentResult.success && currentResult.data) {
      setSubStatus(currentResult.data)
    }
  }, [setSubTiers, setSubStatus])

  /** 刷新全部数据 */
  const refreshAll = React.useCallback(async () => {
    await Promise.all([refreshBilling(), refreshSubscription()])
  }, [refreshBilling, refreshSubscription])

  // 初始加载
  React.useEffect(() => {
    refreshAll()
  }, [refreshAll])

  if (billingLoading && !billingInfo) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 余额卡片（onboarding 弹窗面向新用户，隐藏账户余额） */}
      {!onboarding && <BalanceCard />}

      {/* 为什么选择 Proma 官方的 AI 渠道：设置页置顶展示；onboarding 弹窗由外层统一展示 */}
      {!onboarding && <WhyPromaOfficial />}

      {/* 订阅计划（底部 WhyProma 已上移，两种模式统一隐藏避免重复） */}
      <SubscriptionTab
        onSubscriptionComplete={refreshAll}
        hideWhyProma
        hideHeading={onboarding}
        hideOrderHistory={onboarding}
      />

      {/* 计费说明固定在最底部 */}
      <BillingNotes />
    </div>
  )
}
