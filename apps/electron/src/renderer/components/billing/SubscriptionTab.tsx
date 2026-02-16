/**
 * SubscriptionTab - 订阅计划标签页
 *
 * 订阅档位选择 → 微信支付 → 激活订阅
 * 支持多订阅共存，FIFO 消耗
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Loader2, Zap, Crown, Rocket, Flame, Clock, Star, ChevronDown, ChevronUp } from 'lucide-react'
import { WechatPayArea } from './WechatPayArea'
import type { WechatPayStatus } from './WechatPayArea'
import { subscriptionTiersAtom, subscriptionStatusAtom } from '@/atoms/cloud-billing'
import type { SubscriptionTier } from '@proma/shared'

interface SubscriptionTabProps {
  onSubscriptionComplete: () => Promise<void>
}

/** 微信支付状态 */
interface WechatPayState {
  codeUrl: string
  orderNo: string
  amount: number
  expireAt: string
  status: WechatPayStatus
}

/** 档位图标映射 */
const TIER_ICONS: Record<string, React.ReactNode> = {
  lite: <Zap size={20} />,
  standard: <Crown size={20} />,
  pro: <Rocket size={20} />,
  max: <Flame size={20} />,
}

/** 档位推荐标签 */
const TIER_LABELS: Record<string, string> = {
  lite: '轻度使用',
  standard: '日常使用',
  pro: '高频使用',
  max: '重度使用',
}

/** 推荐档位 */
const RECOMMENDED_TIER = 'standard'

/** 汇率：1 USD = 7 CNY */
const USD_TO_CNY_RATE = 7

/** 计算折扣百分比（按 7:1 汇率换算的等价原价 vs 实际价格） */
function calcDiscount(tier: SubscriptionTier): number {
  const equivalentCny = tier.quota_usd * USD_TO_CNY_RATE * 100 // 等价原价（分）
  if (equivalentCny <= 0) return 0
  return Math.round((1 - tier.amount_cny / equivalentCny) * 100)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '$0.00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '$0.00'
  return `$${num.toFixed(2)}`
}

export function SubscriptionTab({ onSubscriptionComplete }: SubscriptionTabProps): React.ReactElement {
  const tiers = useAtomValue(subscriptionTiersAtom)
  const [subStatus, setSubStatus] = useAtom(subscriptionStatusAtom)

  const [selectedTier, setSelectedTier] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [wechatPay, setWechatPay] = React.useState<WechatPayState | null>(null)
  const [showUsedUp, setShowUsedUp] = React.useState(false)

  /** 加载订阅档位和当前订阅 */
  const refreshSubscription = React.useCallback(async () => {
    const result = await window.electronAPI.cloudSubscription.getCurrent()
    if (result.success && result.data) {
      setSubStatus(result.data)
    }
  }, [setSubStatus])

  React.useEffect(() => {
    refreshSubscription()
  }, [refreshSubscription])

  /** 发起订阅支付 */
  const handleSubscribe = async (): Promise<void> => {
    if (!selectedTier) return

    setLoading(true)
    const result = await window.electronAPI.cloudSubscription.createWechatPayment(selectedTier)
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

    const result = await window.electronAPI.cloudSubscription.getOrderStatus(wechatPay.orderNo)
    if (result.success && result.data) {
      const { status } = result.data
      if (status === 'ACTIVE') {
        setWechatPay((prev) => prev ? { ...prev, status: 'success' } : null)
        await onSubscriptionComplete()
        await refreshSubscription()
      } else if (status === 'CANCELLED') {
        setWechatPay((prev) => prev ? { ...prev, status: 'failed' } : null)
      }
    }
  }, [wechatPay, onSubscriptionComplete, refreshSubscription])

  /** 重置支付状态 */
  const handleReset = async (): Promise<void> => {
    setWechatPay(null)
    await onSubscriptionComplete()
    await refreshSubscription()
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
      {/* 当前活跃订阅 */}
      {subStatus && subStatus.has_active && (() => {
        // 将订阅分为活跃的和已用完的
        const activeSubs: typeof subStatus.subscriptions = []
        const usedUpSubs: typeof subStatus.subscriptions = []

        subStatus.subscriptions.forEach((sub) => {
          const quota = typeof sub.quota === 'string' ? parseFloat(sub.quota) : sub.quota
          const used = typeof sub.used_quota === 'string' ? parseFloat(sub.used_quota) : sub.used_quota
          const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0

          if (percent >= 100) {
            usedUpSubs.push(sub)
          } else {
            activeSubs.push(sub)
          }
        })

        return (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">当前订阅(支持随时叠加订阅)</h3>

            {/* 活跃订阅（有剩余额度） */}
            {activeSubs.map((sub) => {
              const quota = typeof sub.quota === 'string' ? parseFloat(sub.quota) : sub.quota
              const used = typeof sub.used_quota === 'string' ? parseFloat(sub.used_quota) : sub.used_quota
              const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
              const daysLeft = Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))

              return (
                <Card key={sub.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{sub.tier_name}</span>
                        <Badge variant="secondary" className="text-xs">
                          <Clock size={10} className="mr-1" />
                          {daysLeft} 天后到期
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(used)} / {formatCurrency(quota)}
                      </span>
                    </div>
                    <Progress value={percent} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
                      到期日: {formatDate(sub.expires_at)}
                    </p>
                  </CardContent>
                </Card>
              )
            })}

            {/* 已用完的订阅（可折叠） */}
            {usedUpSubs.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowUsedUp(!showUsedUp)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {showUsedUp ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  <span>已用完的订阅 ({usedUpSubs.length})</span>
                </button>

                {showUsedUp && usedUpSubs.map((sub) => {
                  const quota = typeof sub.quota === 'string' ? parseFloat(sub.quota) : sub.quota
                  const used = typeof sub.used_quota === 'string' ? parseFloat(sub.used_quota) : sub.used_quota
                  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0
                  const daysLeft = Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))

                  return (
                    <Card key={sub.id} className="opacity-60">
                      <CardContent className="py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{sub.tier_name}</span>
                            <Badge variant="outline" className="text-xs">
                              已用完
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              <Clock size={10} className="mr-1" />
                              {daysLeft} 天后到期
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatCurrency(used)} / {formatCurrency(quota)}
                          </span>
                        </div>
                        <Progress value={percent} className="h-1.5" />
                        <p className="text-xs text-muted-foreground mt-1">
                          到期日: {formatDate(sub.expires_at)}
                        </p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* 订阅档位选择 */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          {subStatus?.has_active ? '续订 / 叠加额度' : '选择订阅计划(推荐从低档位开始使用，支持随时叠加)'}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {tiers.map((tier: SubscriptionTier) => {
            const isSelected = selectedTier === tier.id
            const isRecommended = tier.id === RECOMMENDED_TIER
            const discount = calcDiscount(tier)
            const equivalentCny = tier.quota_usd * USD_TO_CNY_RATE // 等价原价（元）
            const actualCny = tier.amount_cny / 100

            return (
              <Card
                key={tier.id}
                className={cn(
                  'relative cursor-pointer transition-all hover:shadow-md',
                  isSelected && 'ring-2 ring-primary shadow-md',
                  isRecommended && !isSelected && 'ring-1 ring-primary/50 shadow-sm',
                  isRecommended && 'bg-primary/[0.03] dark:bg-primary/[0.06]'
                )}
                onClick={() => setSelectedTier(tier.id)}
              >
                {/* 推荐角标 */}
                {isRecommended && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-primary text-primary-foreground text-xs px-2.5 py-0.5 shadow-sm">
                      <Star size={10} className="mr-1 fill-current" />
                      推荐
                    </Badge>
                  </div>
                )}

                {/* 折扣角标 */}
                {discount > 0 && (
                  <div className="absolute -top-1.5 -right-1.5 z-10">
                    <span className="inline-flex items-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 shadow-sm">
                      -{discount}%
                    </span>
                  </div>
                )}

                <CardContent className={cn('py-4 text-center', isRecommended && 'pt-6')}>
                  <div className="flex justify-center mb-2 text-primary">
                    {TIER_ICONS[tier.id]}
                  </div>
                  <p className="font-semibold">{tier.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {TIER_LABELS[tier.id] ?? ''}
                  </p>

                  {/* 价格区域 */}
                  <div className="space-y-0.5">
                    {discount > 0 && (
                      <p className="text-sm text-muted-foreground line-through">
                        ¥{equivalentCny}
                      </p>
                    )}
                    <p className={cn(
                      'text-2xl font-bold',
                      isRecommended ? 'text-primary' : 'text-foreground'
                    )}>
                      ¥{actualCny}
                    </p>
                    <p className="text-xs text-muted-foreground">/月</p>
                  </div>

                  <p className="text-sm font-medium mt-1.5">
                    ${tier.quota_usd} 额度
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* 说明 */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>· 订阅有效期 31 天，到期后未使用额度清零</p>
        <p>· 支持重复购买，新额度独立计算，优先消耗先购买的额度</p>
        <p>· 订阅额度仅限应用内使用，API 调用请使用预充值余额</p>
        <p>· 折扣基于 1 USD = 7 CNY 的汇率换算</p>
      </div>

      {/* 支付按钮 */}
      <Button
        className="w-full"
        size="lg"
        disabled={!selectedTier || loading}
        onClick={handleSubscribe}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        立即订阅
      </Button>
    </div>
  )
}
