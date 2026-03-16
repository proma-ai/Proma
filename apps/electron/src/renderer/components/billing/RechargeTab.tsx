/**
 * RechargeTab - 充值标签页（内嵌在 BillingSettings）
 *
 * 套餐选择 → 支付 → 自动刷新
 * 顶部显示订阅推荐引导
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Loader2, ArrowRight, Sparkles, Info } from 'lucide-react'
import { TierSelector } from './TierSelector'
import { WechatPayArea } from './WechatPayArea'
import type { WechatPayStatus } from './WechatPayArea'
import {
  paymentTiersAtom,
  selectedTierIdAtom,
} from '@/atoms/cloud-billing'

interface RechargeTabProps {
  onPaymentComplete: () => Promise<void>
  onVipVerified: () => Promise<void>
  onSwitchToSubscription: () => void
}

/** 微信支付状态 */
interface WechatPayState {
  codeUrl: string
  orderNo: string
  amount: number
  expireAt: string
  status: WechatPayStatus
}

export function RechargeTab({ onPaymentComplete, onVipVerified, onSwitchToSubscription }: RechargeTabProps): React.ReactElement {
  const tiers = useAtomValue(paymentTiersAtom)
  const [selectedTierId, setSelectedTierId] = useAtom(selectedTierIdAtom)

  const [loading, setLoading] = React.useState(false)
  const [wechatPay, setWechatPay] = React.useState<WechatPayState | null>(null)

  // 获取选中套餐的金额（用于按钮显示）
  const selectedTierData = tiers.find((t) => t.id === selectedTierId)
  const selectedAmountCny = selectedTierData ? (selectedTierData.amount_cny / 100).toFixed(0) : 0

  /** 发起支付 */
  const handlePay = async (): Promise<void> => {
    if (!selectedTierId) return

    setLoading(true)
    const result = await window.electronAPI.cloudBilling.createWechatPayment(selectedTierId)
    setLoading(false)

    if (result.success && result.data) {
      setWechatPay({
        codeUrl: result.data.code_url,
        orderNo: result.data.order_no,
        amount: result.data.amount,
        expireAt: result.data.expire_at,
        status: 'paying',
      })
    }
  }

  /** 微信轮询回调 */
  const handleWechatPoll = React.useCallback(async () => {
    if (!wechatPay) return

    const result = await window.electronAPI.cloudBilling.getOrderStatus(wechatPay.orderNo)
    if (result.success && result.data) {
      const { status } = result.data
      if (status === 'COMPLETED' || status === 'PAID') {
        setWechatPay((prev) => prev ? { ...prev, status: 'success' } : null)
        await onPaymentComplete()
      } else if (status === 'FAILED') {
        setWechatPay((prev) => prev ? { ...prev, status: 'failed' } : null)
      } else if (status === 'EXPIRED') {
        setWechatPay((prev) => prev ? { ...prev, status: 'expired' } : null)
      }
    }
  }, [wechatPay, onPaymentComplete])

  /** 重置支付状态 */
  const handleReset = async (): Promise<void> => {
    setWechatPay(null)
    await onPaymentComplete()
  }

  // 如果正在微信支付，显示支付区域
  if (wechatPay) {
    return (
      <WechatPayArea
        codeUrl={wechatPay.codeUrl}
        orderNo={wechatPay.orderNo}
        amount={wechatPay.amount}
        expireAt={wechatPay.expireAt}
        status={wechatPay.status}
        onPoll={handleWechatPoll}
        onReset={handleReset}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* 订阅推荐引导 */}
      <button
        onClick={onSwitchToSubscription}
        className="w-full group rounded-2xl overflow-hidden text-left transition-all hover:shadow-xl bg-gradient-to-r from-indigo-700/85 via-violet-700/82 to-slate-700/80 dark:from-indigo-800/82 dark:via-violet-800/80 dark:to-slate-800/78 backdrop-blur-md border border-white/10"
      >
        <div className="px-5 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-11 w-11 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Sparkles size={20} className="text-white/90" />
              </div>
              <div>
                <p className="text-base font-semibold text-white">推荐使用订阅计划，更划算</p>
                <p className="text-sm text-white/70 mt-1">
                  订阅享更低价格，解锁 Claude API、Proma Agent、Nano Banana 等全部权益
                </p>
              </div>
            </div>
            <div className="h-8 w-8 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5">
              <ArrowRight size={16} className="text-white/90" />
            </div>
          </div>
        </div>
      </button>

      {/* 套餐选择 */}
      <TierSelector
        tiers={tiers}
        selectedTier={selectedTierId}
        onSelect={setSelectedTierId}
      />

      {/* 说明 */}
      <div className="rounded-2xl bg-indigo-50/40 dark:bg-indigo-950/20 backdrop-blur-sm border border-indigo-200/30 dark:border-indigo-800/20 px-4 py-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-indigo-400/70 dark:text-indigo-400/60 mt-0.5 shrink-0" />
          <div className="text-xs text-indigo-600/60 dark:text-indigo-300/50 space-y-0.5">
            <p>预充值余额不会过期，仅用于 Proma 应用内 AI 对话消耗以及 Proma 生成 API 外部调用消耗使用</p>
            <p>充值为一次性购买，不含订阅权益</p>
          </div>
        </div>
      </div>

      {/* 支付按钮 */}
      <Button
        className="w-full"
        size="lg"
        disabled={!selectedTierId || loading}
        onClick={handlePay}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {selectedTierId
          ? `微信支付 · ¥${selectedAmountCny}`
          : '请选择充值档位'}
      </Button>
    </div>
  )
}
