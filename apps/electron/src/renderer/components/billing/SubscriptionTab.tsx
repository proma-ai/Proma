/**
 * SubscriptionTab - 订阅计划标签页
 *
 * 莫兰迪色调 + 玻璃质感卡片 + 功能列表
 * 支持多订阅共存，FIFO 消耗
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Zap, Crown, Rocket, Flame, Clock,
  ChevronDown, ChevronUp, Check, X,
} from 'lucide-react'
import { WechatPayArea } from './WechatPayArea'
import type { WechatPayStatus } from './WechatPayArea'
// 开发者信封弹窗暂时停用；购买按钮直接发起微信支付。
import { TeamPromoBanner } from './TeamPromoBanner'
import { SubscriptionOrderHistory } from './SubscriptionOrderHistory'
import { subscriptionTiersAtom, subscriptionStatusAtom } from '@/atoms/cloud-billing'
import { OFFICIAL_COMPARISON, BILLING_NOTES } from '@/lib/official-channels'
import type { SubscriptionTier } from '@proma/shared'

interface SubscriptionTabProps {
  onSubscriptionComplete: () => Promise<void>
  /** onboarding 弹窗模式：隐藏底部「为什么选择 Proma 官方的 AI 渠道？」区块（由弹窗顶部统一展示） */
  hideWhyProma?: boolean
  /** onboarding 弹窗模式：隐藏「购买 Proma 商业版额度」标题块（弹窗标题已展示） */
  hideHeading?: boolean
  /** onboarding 弹窗模式：不展示个人订单记录，避免打断首次购买引导 */
  hideOrderHistory?: boolean
  /** 插入当前订阅与购买套餐之间的额度使用洞察区块。 */
  activity?: React.ReactNode
}

interface WechatPayState {
  codeUrl: string
  orderNo: string
  amount: number
  expireAt: string
  status: WechatPayStatus
}

/** 档位视觉配置 */
interface TierVisual {
  icon: React.ReactNode
  subtitle: string
  /** 卡片背景 */
  cardBg: string
  /** 额外卡片 class（玻璃效果等） */
  cardExtra: string
  /** 文字颜色 */
  textColor: string
  /** 次要文字颜色 */
  mutedColor: string
  /** 价格颜色 */
  priceColor: string
  /** 按钮样式 */
  buttonClass: string
  /** 勾选图标颜色 */
  checkColor: string
  /** 分隔线颜色 */
  dividerColor: string
  /** 推荐条背景（仅推荐档位用） */
  recommendBg: string
}

const TIER_VISUALS: Record<string, TierVisual> = {
  lite: {
    icon: <Zap size={18} />,
    subtitle: '轻度使用',
    cardBg: 'bg-stone-50/80 dark:bg-stone-900/40',
    cardExtra: 'backdrop-blur-sm border border-stone-200/60 dark:border-stone-700/40',
    textColor: 'text-stone-800 dark:text-stone-200',
    mutedColor: 'text-stone-500 dark:text-stone-400',
    priceColor: 'text-stone-800 dark:text-stone-100',
    buttonClass: 'bg-stone-200/60 hover:bg-stone-200 text-stone-700 dark:bg-stone-700/50 dark:hover:bg-stone-700/70 dark:text-stone-200',
    checkColor: 'text-stone-500 dark:text-stone-400',
    dividerColor: 'border-stone-200/80 dark:border-stone-700/50',
    recommendBg: '',
  },
  standard: {
    icon: <Crown size={18} />,
    subtitle: '日常使用',
    cardBg: 'bg-gradient-to-b from-indigo-600/90 via-indigo-700/88 to-slate-700/85 dark:from-indigo-700/88 dark:via-indigo-800/85 dark:to-slate-800/82',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-slate-100',
    mutedColor: 'text-slate-300/80',
    priceColor: 'text-white',
    buttonClass: 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm',
    checkColor: 'text-emerald-400',
    dividerColor: 'border-white/12',
    recommendBg: '',
  },
  pro: {
    icon: <Rocket size={18} />,
    subtitle: '高频使用',
    cardBg: 'bg-gradient-to-b from-rose-600/90 via-orange-600/88 to-amber-700/85 dark:from-rose-700/88 dark:via-orange-700/85 dark:to-amber-800/82',
    cardExtra: 'backdrop-blur-md border border-white/15',
    textColor: 'text-orange-50',
    mutedColor: 'text-orange-200/70',
    priceColor: 'text-white',
    buttonClass: 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm',
    checkColor: 'text-emerald-400',
    dividerColor: 'border-white/12',
    recommendBg: '',
  },
  max: {
    icon: <Flame size={18} />,
    subtitle: '重度使用',
    cardBg: 'bg-gradient-to-b from-neutral-900/95 via-stone-900/93 to-black/90 dark:from-black/95 dark:via-neutral-950/93 dark:to-black/90',
    cardExtra: 'backdrop-blur-md border border-white/10',
    textColor: 'text-neutral-200',
    mutedColor: 'text-neutral-400',
    priceColor: 'text-white',
    buttonClass: 'bg-white/12 hover:bg-white/20 text-neutral-200 backdrop-blur-sm',
    checkColor: 'text-emerald-400',
    dividerColor: 'border-white/8',
    recommendBg: '',
  },
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_VISUAL = TIER_VISUALS.lite!

/** 所有档位共享的功能列表 */
const FEATURES = [
  'Proma Cloud 官方模型',
  'Proma Agent',
  'Agent 专用模型',
  '联网搜索与图像生成工具',
  '统一额度与用量管理',
]

/** 档位描述 */
const TIER_DESC: Record<string, string> = {
  lite: '适合体验 Proma Cloud 与轻度日常对话',
  standard: '适合日常对话、开发辅助与偶尔的 Agent 任务',
  pro: '适合高频开发工作流与密集 Agent 任务',
  max: '适合重度使用与更高额度的长期工作流',
}

const RECOMMENDED_TIER = 'standard'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '0.00 积分'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0.00 积分'
  return `${num.toFixed(2)} 积分`
}

export function SubscriptionTab({
  onSubscriptionComplete,
  hideWhyProma = false,
  hideHeading = false,
  hideOrderHistory = false,
  activity,
}: SubscriptionTabProps): React.ReactElement {
  const tiers = useAtomValue(subscriptionTiersAtom)
  const [subStatus, setSubStatus] = useAtom(subscriptionStatusAtom)

  const [selectedTier, setSelectedTier] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [wechatPay, setWechatPay] = React.useState<WechatPayState | null>(null)
  const activeOrderRef = React.useRef<string | null>(null)
  const pollingRef = React.useRef(false)
  const completedOrderRef = React.useRef<string | null>(null)
  const [showUsedUp, setShowUsedUp] = React.useState(false)

  const refreshSubscription = React.useCallback(async () => {
    const result = await window.electronAPI.cloudSubscription.getCurrent()
    if (result.success && result.data) {
      setSubStatus(result.data)
    }
  }, [setSubStatus])

  React.useEffect(() => {
    refreshSubscription()
  }, [refreshSubscription])

  const handleSubscribe = async (tierId: string): Promise<void> => {
    setLoading(true)
    const result = await window.electronAPI.cloudSubscription.createWechatPayment(tierId)
    setLoading(false)
    if (result.success && result.data) {
      activeOrderRef.current = result.data.order_no
      completedOrderRef.current = null
      setWechatPay({
        codeUrl: result.data.code_url,
        orderNo: result.data.order_no,
        amount: result.data.amount,
        expireAt: result.data.expire_at,
        status: 'paying',
      })
    }
  }

  const orderNo = wechatPay?.orderNo
  const handleWechatPoll = React.useCallback(async () => {
    if (!orderNo || pollingRef.current || completedOrderRef.current === orderNo) return
    pollingRef.current = true
    try {
      const result = await window.electronAPI.cloudSubscription.getOrderStatus(orderNo)
      // 用户可能已取消并创建新订单；旧轮询结果不得污染新支付流程。
      if (activeOrderRef.current !== orderNo || !result.success || !result.data) return
      const { status } = result.data
      if (status === 'ACTIVE') {
        completedOrderRef.current = orderNo
        setWechatPay((prev) => prev?.orderNo === orderNo ? { ...prev, status: 'success' } : prev)
        await onSubscriptionComplete()
        await refreshSubscription()
      } else if (status === 'CANCELLED') {
        setWechatPay((prev) => prev?.orderNo === orderNo ? { ...prev, status: 'failed' } : prev)
      }
    } catch (error) {
      // 网络错误不能当成付款失败；下次轮询可继续确认订单。
      console.warn('[微信支付] 查询订单或刷新订阅失败:', error)
    } finally {
      pollingRef.current = false
    }
  }, [orderNo, onSubscriptionComplete, refreshSubscription])

  const handleReset = async (): Promise<void> => {
    activeOrderRef.current = null
    setWechatPay(null)
    await onSubscriptionComplete()
    await refreshSubscription()
  }

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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">当前订阅</h3>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                支持随时叠加
              </Badge>
            </div>

            {activeSubs.map((sub) => {
              const quota = typeof sub.quota === 'string' ? parseFloat(sub.quota) : sub.quota
              const used = typeof sub.used_quota === 'string' ? parseFloat(sub.used_quota) : sub.used_quota
              const remaining = quota - used
              const percent = quota > 0 ? Math.max(0, Math.min(100, (remaining / quota) * 100)) : 0
              const daysLeft = Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))

              return (
                <Card key={sub.id} className="overflow-hidden border-0 shadow-sm">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{sub.tier_name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 font-normal">
                          <Clock size={9} />
                          {daysLeft}天后到期
                        </Badge>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        剩余 {formatCurrency(remaining)}
                      </span>
                    </div>
                    <Progress value={percent} className="h-2" />
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        剩余 {formatCurrency(remaining)} / {formatCurrency(quota)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(sub.expires_at)} 到期
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {usedUpSubs.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowUsedUp(!showUsedUp)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showUsedUp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>已用完 ({usedUpSubs.length})</span>
                </button>
                {showUsedUp && usedUpSubs.map((sub) => {
                  const quota = typeof sub.quota === 'string' ? parseFloat(sub.quota) : sub.quota
                  const used = typeof sub.used_quota === 'string' ? parseFloat(sub.used_quota) : sub.used_quota
                  const daysLeft = Math.max(0, Math.ceil((new Date(sub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                  return (
                    <Card key={sub.id} className="opacity-50 border-dashed">
                      <CardContent className="py-2.5 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{sub.tier_name}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">已用完</Badge>
                            <span className="text-[10px] text-muted-foreground">{daysLeft}天后到期</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {formatCurrency(used)} / {formatCurrency(quota)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {!hideOrderHistory && <SubscriptionOrderHistory />}

      {/* Token 活跃地图等用量洞察置于当前订阅和购买套餐之间。 */}
      {activity}

      {/* 订阅计划卡片 */}
      <div className="space-y-4">
        {!hideHeading && (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">购买 Proma 商业版额度</h3>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              一次性购买，不自动续费或自动扣款；建议按需少量多次叠加。
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier: SubscriptionTier) => {
            const isSelected = selectedTier === tier.id
            const isRecommended = tier.id === RECOMMENDED_TIER
            const actualCny = tier.amount_cny / 100
            const baseQuota = Number(tier.base_quota ?? tier.quota)
            const bonusQuota = Number(tier.bonus_quota ?? 0)
            const durationDays = tier.duration_days ?? 31
            const hasBonus = bonusQuota > 0
            const visual = TIER_VISUALS[tier.id] ?? DEFAULT_VISUAL

            return (
              <div
                key={tier.id}
                className={cn(
                  'relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200',
                  visual.cardBg,
                  visual.cardExtra,
                  isSelected
                    ? 'ring-2 ring-white/60 shadow-xl scale-[1.02]'
                    : 'shadow-lg hover:shadow-xl hover:scale-[1.01]',
                )}
                onClick={() => setSelectedTier(tier.id)}
              >
                <div className="px-4 pt-5 pb-5">
                  {/* 档位名称 */}
                  <div className="mb-4">
                    <h3 className={cn('text-base font-bold', visual.textColor)}>{tier.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge className={cn('border-0 px-1.5 py-0 text-[10px] font-medium', visual.buttonClass)}>
                        {durationDays} 天有效
                      </Badge>
                      {bonusQuota > 0 && (
                        <Badge className={cn('border-0 px-1.5 py-0 text-[10px] font-medium', visual.buttonClass)}>
                          额外赠送 {bonusQuota} 积分
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* 价格与到账额度 */}
                  <div className="mb-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn('text-2xl font-bold tracking-tight', visual.priceColor)}>
                        ¥{actualCny}
                      </span>
                    </div>
                    <p className={cn('mt-0.5 text-[11px] font-medium', visual.mutedColor)}>
                      {hasBonus && <span className="line-through opacity-65">{baseQuota} 积分</span>}
                      {hasBonus && <span className="mx-1">→</span>}
                      到账 {tier.quota} 积分
                    </p>
                  </div>

                  {/* 描述 */}
                  <p className={cn('text-[11px] mt-2 mb-4 leading-relaxed', visual.mutedColor)}>
                    {TIER_DESC[tier.id] ?? ''}
                  </p>

                  {/* 一次性购买按钮 */}
                  <button
                    className={cn(
                      'w-full py-2 rounded-lg text-xs font-medium transition-all mb-4',
                      visual.buttonClass,
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTier(tier.id)
                      // 跳过 DeveloperLetterDialog，直接创建微信支付订单。
                      void handleSubscribe(tier.id)
                    }}
                  >
                    一次性购买 · ¥{actualCny}
                  </button>

                  {/* 分隔线 */}
                  <div className={cn('border-t mb-3', visual.dividerColor)} />

                  {/* 功能列表 */}
                  <div className="space-y-1.5">
                    <p className={cn('text-[10px] font-medium mb-1', visual.mutedColor)}>包含:</p>
                    {FEATURES.map((feature) => (
                      <div key={feature} className="flex items-center gap-1.5">
                        <Check size={12} className={visual.checkColor} strokeWidth={2.5} />
                        <span className={cn('text-[11px]', visual.textColor)}>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 团队版推广 */}
        <TeamPromoBanner />
      </div>

      {/* 为什么选择 Proma 官方的 AI 渠道（onboarding 弹窗顶部统一展示时隐藏） */}
      {!hideWhyProma && (
        <section className="overflow-hidden rounded-2xl border border-stone-200/60 bg-stone-50/80 backdrop-blur-sm dark:border-stone-700/40 dark:bg-stone-900/40">
        <div className="px-5 pb-3 pt-4">
          <h3 className="text-balance text-sm font-semibold text-foreground">为什么选择 Proma 官方的 AI 渠道？</h3>
          <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
            Proma Cloud 以可核验的计费明细、官方托管的安全链路和具有竞争力的模型折扣，让商业版额度的使用更清楚、更安心。
          </p>
        </div>

        <div className="overflow-x-auto border-t border-stone-200/60 dark:border-stone-700/40">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-stone-100/70 text-[11px] text-muted-foreground dark:bg-stone-800/40">
              <tr>
                <th className="px-5 py-2.5 font-medium">对比项</th>
                <th className="px-5 py-2.5 font-semibold text-foreground">Proma 官方</th>
                <th className="px-5 py-2.5 font-medium">非官方 / 不透明中转</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/60 dark:divide-stone-700/40">
              {OFFICIAL_COMPARISON.map((item) => (
                <tr key={item.label}>
                  <th className="whitespace-nowrap px-5 py-3 font-medium text-foreground">{item.label}</th>
                  <td className="px-5 py-3 text-muted-foreground">
                    <span className="flex items-start gap-2">
                      <Check size={15} strokeWidth={2.5} className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{item.official}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    <span className="flex items-start gap-2">
                      {item.alternativePositive ? (
                        <Check size={15} strokeWidth={2.5} className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <X size={15} strokeWidth={2.5} className="mt-px shrink-0 text-rose-500 dark:text-rose-400" />
                      )}
                      <span>{item.alternative}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-stone-200/60 px-5 py-4 dark:border-stone-700/40">
          <h4 className="text-xs font-semibold text-foreground">计费说明</h4>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
            {BILLING_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>
      )}

    </div>
  )
}
