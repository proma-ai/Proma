/**
 * RechargeTab - 充值标签页（内嵌在 BillingSettings）
 *
 * 套餐选择 → 支付方式（仅微信） → 支付 → 自动刷新
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { TierSelector } from './TierSelector'
import { PaymentMethodRadio } from './PaymentMethodRadio'
import { WechatPayArea } from './WechatPayArea'
import type { WechatPayStatus } from './WechatPayArea'
import { VipVerifyInput } from './VipVerifyInput'
import {
  paymentTiersAtom,
  selectedTierIdAtom,
  selectedPaymentMethodAtom,
} from '@/atoms/cloud-billing'

interface RechargeTabProps {
  onPaymentComplete: () => Promise<void>
  onVipVerified: () => Promise<void>
}

/** 微信支付状态 */
interface WechatPayState {
  codeUrl: string
  orderNo: string
  amount: number
  expireAt: string
  status: WechatPayStatus
}

export function RechargeTab({ onPaymentComplete, onVipVerified }: RechargeTabProps): React.ReactElement {
  const tiers = useAtomValue(paymentTiersAtom)
  const [selectedTierId, setSelectedTierId] = useAtom(selectedTierIdAtom)
  const [paymentMethod, setPaymentMethod] = useAtom(selectedPaymentMethodAtom)

  const [loading, setLoading] = React.useState(false)
  const [wechatPay, setWechatPay] = React.useState<WechatPayState | null>(null)

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
      {/* 套餐选择 */}
      <TierSelector
        tiers={tiers}
        selectedTier={selectedTierId}
        onSelect={setSelectedTierId}
      />

      {/* 支付方式 */}
      <PaymentMethodRadio
        value={paymentMethod}
        onChange={setPaymentMethod}
      />

      {/* VIP 验证 */}
      <VipVerifyInput onVerified={onVipVerified} />

      {/* 支付按钮 */}
      <Button
        className="w-full"
        size="lg"
        disabled={!selectedTierId || loading}
        onClick={handlePay}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        确认充值
      </Button>
    </div>
  )
}
