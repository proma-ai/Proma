/**
 * BillingSettings - 账单设置主页
 *
 * 显示在设置面板的"账单"tab 中（仅 Cloud 模式）
 * 包含：余额卡片 + Tabs（订阅计划 / 立即充值 / 从 DeepClaude 迁移） + 订单历史
 */

import * as React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BalanceCard } from './BalanceCard'
import { RechargeTab } from './RechargeTab'
import { TransferTab } from './TransferTab'
import { SubscriptionTab } from './SubscriptionTab'
import { OrderHistory } from './OrderHistory'
import {
  billingInfoAtom,
  billingLoadingAtom,
  paymentTiersAtom,
  isVipAtom,
  discountLevelAtom,
  orderHistoryAtom,
  subscriptionTiersAtom,
  subscriptionStatusAtom,
} from '@/atoms/cloud-billing'

export function BillingSettings(): React.ReactElement {
  const billingLoading = useAtomValue(billingLoadingAtom)
  const billingInfo = useAtomValue(billingInfoAtom)
  const setBillingInfo = useSetAtom(billingInfoAtom)
  const setTiers = useSetAtom(paymentTiersAtom)
  const setIsVip = useSetAtom(isVipAtom)
  const setDiscountLevel = useSetAtom(discountLevelAtom)
  const setOrders = useSetAtom(orderHistoryAtom)
  const setSubTiers = useSetAtom(subscriptionTiersAtom)
  const setSubStatus = useSetAtom(subscriptionStatusAtom)

  /** 加载账单信息 */
  const refreshBilling = React.useCallback(async () => {
    const result = await window.electronAPI.cloudBilling.getBilling()
    if (result.success && result.data) {
      setBillingInfo(result.data)
    }
  }, [setBillingInfo])

  /** 加载套餐列表 */
  const refreshTiers = React.useCallback(async () => {
    const result = await window.electronAPI.cloudBilling.getTiers()
    if (result.success && result.data) {
      setTiers(result.data.tiers)
      setIsVip(result.data.is_vip)
      setDiscountLevel(result.data.discount_level)
    }
  }, [setTiers, setIsVip, setDiscountLevel])

  /** 刷新订单历史 */
  const refreshOrders = React.useCallback(async () => {
    const result = await window.electronAPI.cloudBilling.getOrders()
    if (result.success && result.data) {
      setOrders(result.data)
    }
  }, [setOrders])

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
    await Promise.all([refreshBilling(), refreshTiers(), refreshOrders(), refreshSubscription()])
  }, [refreshBilling, refreshTiers, refreshOrders, refreshSubscription])

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
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-semibold">账单</h2>

      {/* 余额卡片 */}
      <BalanceCard />

      {/* Tabs：订阅 / 充值 / 迁移 */}
      <Tabs defaultValue="subscription" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="subscription">订阅计划</TabsTrigger>
          <TabsTrigger value="recharge">余额充值</TabsTrigger>
          <TabsTrigger value="transfer">从 DeepClaude 迁移</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription" className="space-y-6 mt-4">
          <SubscriptionTab onSubscriptionComplete={refreshAll} />
        </TabsContent>

        <TabsContent value="recharge" className="space-y-6 mt-4">
          <RechargeTab
            onPaymentComplete={refreshAll}
            onVipVerified={refreshTiers}
          />
          <OrderHistory />
        </TabsContent>

        <TabsContent value="transfer" className="space-y-6 mt-4">
          <TransferTab onTransferComplete={refreshAll} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
