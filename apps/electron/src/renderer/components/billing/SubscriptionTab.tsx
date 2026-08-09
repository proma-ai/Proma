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
import { subscriptionTiersAtom, subscriptionStatusAtom } from '@/atoms/cloud-billing'
import type { SubscriptionTier } from '@proma/shared'

interface SubscriptionTabProps {
  onSubscriptionComplete: () => Promise<void>
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

const OFFICIAL_COMPARISON = [
  {
    label: '透明计费',
    official: '按模型、Agent 与工具展示用量和扣费明细',
    alternative: '价格、扣费规则或明细难以核验',
    alternativePositive: false,
  },
  {
    label: '模型质量',
    official: '精选官方模型并持续验证实际模型能力与协议兼容性',
    alternative: '可能存在模型掺水或实际能力与宣传不符的问题',
    alternativePositive: false,
  },
  {
    label: '数据安全',
    official: '官方托管链路提供统一安全保障，减少第三方中转的不确定性',
    alternative: '数据流向与留存规则不透明，难以排除二次使用或倒卖风险',
    alternativePositive: false,
  },
  {
    label: '高峰稳定性',
    official: '持续监控模型健康状态并维护故障恢复能力',
    alternative: '高峰期可能降速，稳定性与故障恢复能力难以保障',
    alternativePositive: false,
  },
  {
    label: '价格优势',
    official: '以官方参考价为基础计算折扣，精选模型提供专属优惠',
    alternative: '可能具备更低价格，但价格来源和优惠依据不够透明',
    alternativePositive: true,
  },
] as const

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

export function SubscriptionTab({ onSubscriptionComplete }: SubscriptionTabProps): React.ReactElement {
  const tiers = useAtomValue(subscriptionTiersAtom)
  const [subStatus, setSubStatus] = useAtom(subscriptionStatusAtom)

  const [selectedTier, setSelectedTier] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [wechatPay, setWechatPay] = React.useState<WechatPayState | null>(null)
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
      setWechatPay({
        codeUrl: result.data.code_url,
        orderNo: result.data.order_no,
        amount: result.data.amount,
        expireAt: result.data.expire_at,
        status: 'paying',
      })
    }
  }

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

  const handleReset = async (): Promise<void> => {
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

      {/* 订阅计划卡片 */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">购买 Proma 商业版额度</h3>
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            一次性购买，不自动续费或自动扣款；建议按需少量多次叠加。
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3">
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

      {/* 为什么选择 Proma 官方 */}
      <section className="overflow-hidden rounded-2xl border border-stone-200/60 bg-stone-50/80 backdrop-blur-sm dark:border-stone-700/40 dark:bg-stone-900/40">
        <div className="px-5 pb-3 pt-4">
          <h3 className="text-balance text-sm font-semibold text-foreground">为什么选择 Proma 官方？</h3>
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
            <li>所有模型均按照官方价格的基础进行折扣计算；Proma Cloud 额度会按所选模型、输入输出长度及任务规模消耗。</li>
            <li>各额度包按所选档位独立计时，到期后未使用额度清零（团队采用单独计费层）。</li>
            <li>每次购买均为一次性支付，不会自动续费或自动扣款；赠送额度随对应额度包同时到期。</li>
            <li>支持少量多次购买叠加，各额度包独立计时，优先消耗先购买的额度（FIFO）。</li>
          </ul>
        </div>
      </section>

    </div>
  )
}
