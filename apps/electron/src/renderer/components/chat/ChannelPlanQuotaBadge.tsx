import * as React from 'react'
import type { Channel } from '@proma/shared'
import { cn } from '@/lib/utils'
import { supportsChannelPlanQuota, fetchChannelPlanQuota } from '@/lib/channel-plan-quota'
import { currentPlanQuota, getPlanQuotaDisplay, planQuotaChannelKey } from '@/lib/channel-plan-quota-display'
import type { LoadedPlanQuota } from '@/lib/channel-plan-quota-display'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ChannelPlanQuotaBadge({ channel }: { channel: Channel }): React.ReactElement | null {
  const [loaded, setLoaded] = React.useState<LoadedPlanQuota | null>(null)
  const channelKey = planQuotaChannelKey(channel)

  React.useEffect(() => {
    if (!supportsChannelPlanQuota(channel)) return

    let cancelled = false
    fetchChannelPlanQuota(channel.id, channel.updatedAt)
      .then((result) => {
        if (!cancelled) setLoaded({ channelKey, result })
      })

    return () => { cancelled = true }
  }, [channel.id, channel.provider, channel.baseUrl, channel.updatedAt, channelKey])

  if (!supportsChannelPlanQuota(channel)) return null
  const quota = currentPlanQuota(loaded, channelKey)
  const display = getPlanQuotaDisplay(quota, channel.provider)
  if (!display) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={display.title}
          className={cn(
            'ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring',
            display.muted
              ? 'border-transparent bg-transparent text-muted-foreground/70'
              : 'border-foreground/10 bg-background/70 text-foreground/70',
          )}
        >
          {display.summary}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-line">{display.title}</TooltipContent>
    </Tooltip>
  )
}
