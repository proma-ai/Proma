/**
 * WhyPromaOfficial - 「为什么选择 Proma 官方的 AI 渠道？」区块
 *
 * 用于 onboarding 结束后的购买额度弹窗顶部（新用户首屏）。
 * 包含：
 * - 官方 Agent 渠道与模型列表（云端同步，模型名可能带折扣）
 * - 官方 vs 非官方对比（卡片式，比表格更易读）
 * - 计费说明（固定放在区块最底部）
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Check, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { channelsAtom } from '@/atoms/chat-atoms'
import { PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import type { Channel } from '@proma/shared'
import {
  OFFICIAL_MODEL_CHANNELS,
  OFFICIAL_COMPARISON,
  matchOfficialProvider,
  OFFICIAL_DISCOUNT_NOTE,
  BILLING_NOTES,
} from '@/lib/official-channels'

/** 从云端同步的官方渠道模型名里匹配的渠道折扣模型（名称本身可能含「2 折」等）。 */
function buildChannelGroups(channels: Channel[]): Array<{
  provider: string
  model: string
  logo: string
  liveNames: string[]
}> {
  const official = channels.find((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID)
  const catalogModels = official?.agentModels ?? official?.models ?? []
  const liveByName = new Map<string, string[]>()
  for (const m of catalogModels) {
    const provider = matchOfficialProvider(m.id)
    if (!provider) continue
    const arr = liveByName.get(provider) ?? []
    arr.push(m.name)
    liveByName.set(provider, arr)
  }
  return OFFICIAL_MODEL_CHANNELS.map((ch) => ({
    provider: ch.provider,
    model: ch.model,
    logo: ch.logo,
    liveNames: liveByName.get(ch.provider) ?? [],
  }))
}

export function WhyPromaOfficial(): React.ReactElement {
  const channels = useAtomValue(channelsAtom)
  const groups = React.useMemo(() => buildChannelGroups(channels), [channels])
  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200/60 bg-stone-50/80 backdrop-blur-sm dark:border-stone-700/40 dark:bg-stone-900/40">
      <div className="px-5 pb-3 pt-4">
        <h3 className="text-balance text-sm font-semibold text-foreground">为什么选择 Proma 官方的 AI 渠道？</h3>
      </div>

      {/* 官方 Agent 渠道与模型 */}
      <div className="border-t border-stone-200/60 px-5 py-4 dark:border-stone-700/40">
        <p className="text-xs font-semibold text-foreground">当前 Proma 官方提供的 Agent 渠道</p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-foreground">
          <Info size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0 text-xs font-semibold leading-5">折扣说明</span>
          <p className="text-xs font-medium leading-5">{OFFICIAL_DISCOUNT_NOTE}</p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(({ provider, model, logo, liveNames }) => (
            <div key={provider} className="min-w-0">
              <div className="flex items-center gap-2">
                <img src={logo} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 rounded-md" />
                <span className="whitespace-nowrap text-sm font-medium text-foreground">
                  {provider} · {model}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {liveNames.length > 0 ? liveNames.map((name) => (
                  <span
                    key={name}
                    className="rounded-md border border-stone-200/80 bg-card px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground dark:border-stone-700/50"
                  >
                    {name}
                  </span>
                )) : (
                  <span className="text-[11px] leading-4 text-muted-foreground">当前模型列表暂未同步</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 官方 vs 非官方对比（卡片式两栏） */}
      <div className="border-t border-stone-200/60 px-5 py-4 dark:border-stone-700/40">
        <p className="text-xs font-semibold text-foreground">Proma 官方 vs 非官方 / 不透明中转</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/50 p-3.5 dark:border-emerald-800/40 dark:bg-emerald-950/20">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Proma 官方</p>
            <ul className="mt-2.5 space-y-2">
              {OFFICIAL_COMPARISON.map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  <Check size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">{item.label}：</span>
                    {item.official}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className={cn('rounded-xl border border-stone-200/60 bg-stone-100/50 p-3.5 dark:border-stone-700/50 dark:bg-stone-800/30')}>
            <p className="text-xs font-semibold text-stone-500 dark:text-stone-400">非官方 / 不透明中转</p>
            <ul className="mt-2.5 space-y-2">
              {OFFICIAL_COMPARISON.map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  {item.alternativePositive ? (
                    <Check size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-stone-400" />
                  ) : (
                    <X size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-rose-400" />
                  )}
                  <span className="text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">{item.label}：</span>
                    {item.alternative}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 计费说明：固定展示在购买额度内容的最底部。 */
export function BillingNotes(): React.ReactElement {
  return (
    <div className="border-t border-stone-200/60 pt-4 dark:border-stone-700/40">
      <h4 className="text-xs font-semibold text-foreground">计费说明</h4>
      <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
        {BILLING_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
