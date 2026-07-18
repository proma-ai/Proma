import * as React from 'react'
import type { Channel, ChannelPlanQuotaResult, ChannelPlanQuotaWindow } from '@proma/shared'
import { cn } from '@/lib/utils'
import { supportsChannelPlanQuota, fetchChannelPlanQuota } from '@/lib/channel-plan-quota'

function formatWindow(window: ChannelPlanQuotaWindow): string {
  const label = window.type === '5h'
    ? '5H'
    : window.type === 'weekly'
      ? '周'
      : window.label.replace(/\s+/g, '')
  return `${label} ${window.remainingLabel ?? `${window.remainingPercent}%`}`
}

function buildSummary(result: ChannelPlanQuotaResult): string {
  const fiveHour = result.windows.find((window) => window.type === '5h')
  const weekly = result.windows.find((window) => window.type === 'weekly')
  const custom = result.windows.find((window) => window.type === 'custom')
  const primary = [fiveHour, weekly].filter(Boolean) as ChannelPlanQuotaWindow[]
  const windows = primary.length > 0 ? primary : result.windows.slice(0, 2)
  if (windows.length === 0 && custom) return formatWindow(custom)
  return windows.map(formatWindow).join(' · ')
}

function buildTitle(result: ChannelPlanQuotaResult): string {
  if (!result.supported) return result.message ?? '订阅额度不可用'
  const detail = result.windows.map((window) => {
    const reset = window.resetAt
      ? `，重置 ${new Intl.DateTimeFormat(undefined, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(window.resetAt))}`
      : ''
    return `${window.label}: 剩余 ${window.remainingLabel ?? `${window.remainingPercent}%`}${reset}`
  }).join('\n')
  return `${result.planName ?? '订阅额度'}\n${detail}`
}

export function ChannelPlanQuotaBadge({ channel }: { channel: Channel }): React.ReactElement | null {
  const [quota, setQuota] = React.useState<ChannelPlanQuotaResult | null>(null)

  React.useEffect(() => {
    if (!supportsChannelPlanQuota(channel)) return

    let cancelled = false
    fetchChannelPlanQuota(channel.id, channel.updatedAt)
      .then((result) => {
        if (!cancelled) setQuota(result)
      })

    return () => {
      cancelled = true
    }
  }, [channel.id, channel.provider, channel.baseUrl])

  if (!supportsChannelPlanQuota(channel)) return null

  const isUsable = quota?.supported && quota.windows.length > 0
  if (!isUsable) return null

  const summary = buildSummary(quota)
  const title = quota ? buildTitle(quota) : '正在读取订阅额度'

  return (
    <span
      title={title}
      className={cn(
        'ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none',
        isUsable
          ? 'border-foreground/10 bg-background/70 text-foreground/70'
          : 'border-transparent bg-transparent text-muted-foreground/50',
      )}
    >
      {summary}
    </span>
  )
}
