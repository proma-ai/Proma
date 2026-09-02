import * as React from 'react'
import { useSetAtom } from 'jotai'
import { ChevronRight, Loader2, ScrollText } from 'lucide-react'
import type { AgentTokenActivityItem, AgentTokenActivityResponse } from '@proma/shared'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { settingsTabAtom } from '@/atoms/settings-tab'

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const ACTIVITY_COLORS = [
  'bg-[#F4F4F4]',
  'bg-[#D2DDF3]',
  'bg-[#A8BFE7]',
  'bg-[#7398D9]',
  'bg-[#2C67C5]',
]

interface ActivityDay {
  date: string
  item: AgentTokenActivityItem | null
}

function dateFromIso(dateString: string): Date {
  const [year = 1970, month = 1, day = 1] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 100_000_000) return `${(tokens / 100_000_000).toFixed(1)} 亿 Token`
  if (tokens >= 10_000) return `${(tokens / 10_000).toFixed(1)} 万 Token`
  return `${tokens.toLocaleString('zh-CN')} Token`
}

function getActivityLevel(tokens: number): number {
  if (tokens <= 0) return 0
  if (tokens < 1_000_000) return 1
  if (tokens < 10_000_000) return 2
  if (tokens < 100_000_000) return 3
  return 4
}

function buildActivityDays(data: AgentTokenActivityResponse): Array<ActivityDay | null> {
  const activityByDate = new Map(data.items.map((item) => [item.date, item]))
  const start = dateFromIso(data.startDate)
  const end = dateFromIso(data.endDate)
  const mondayOffset = (start.getDay() + 6) % 7
  const days: Array<ActivityDay | null> = Array.from({ length: mondayOffset }, () => null)

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = toIsoDate(cursor)
    days.push({ date, item: activityByDate.get(date) ?? null })
  }

  return days
}

function describeActivity(day: ActivityDay): string {
  const totalTokens = day.item?.totalTokens ?? 0
  return `${day.date}：当天消耗 ${formatCompactTokens(totalTokens)}`
}

/** 仅展示 Proma Agent / API Key 调用的全年每日 Token 消耗。 */
export function AgentTokenActivity(): React.ReactElement {
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [data, setData] = React.useState<AgentTokenActivityResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    window.electronAPI.cloudUsage.getAgentTokenActivity()
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) {
          setData(result.data)
        } else {
          setError(result.error ?? 'Token 活跃度加载失败')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Token 活跃度加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card px-5 py-8 shadow-sm">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          正在加载 Token 活跃度…
        </div>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="rounded-2xl border bg-card px-5 py-6 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Token 活跃地图</h3>
        <p className="mt-2 text-xs text-muted-foreground">{error ?? 'Token 活跃度加载失败'}</p>
      </section>
    )
  }

  const days = buildActivityDays(data)
  const totalTokens = data.items.reduce((sum, item) => sum + item.totalTokens, 0)
  const todayTokens = data.items.find((item) => item.date === data.endDate)?.totalTokens ?? 0
  const hasActivity = totalTokens > 0

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div>
          <h3 className="text-balance text-sm font-semibold text-foreground">Token 活跃地图</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {error ?? '仅统计 Proma Agent 调用；历史数据每日更新，当天用量会在进入页面时更新。'}
          </p>
        </div>
        <div className="flex items-center gap-5 text-right">
            <div>
              <p className="text-[11px] text-muted-foreground">今日消耗</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatCompactTokens(todayTokens)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">最近 365 天累计</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatCompactTokens(totalTokens)}
              </p>
            </div>
        </div>
      </div>

      {hasActivity ? (
        <div className="border-t px-5 py-4">
          <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
            <div className="grid grid-rows-7 gap-1 text-[10px] text-muted-foreground">
              {DAY_NAMES.map((name) => (
                <span key={name} className="flex items-center leading-none">{name}</span>
              ))}
            </div>
            <div
              className="grid w-full grid-flow-col grid-cols-[repeat(53,minmax(0,1fr))] grid-rows-7 gap-1"
              role="grid"
              aria-label="最近 365 天 Proma Agent Token 活跃度"
            >
              {days.map((day, index) => {
                if (!day) return <span key={`padding-${index}`} className="aspect-square w-full" aria-hidden="true" />
                const total = day.item?.totalTokens ?? 0
                const level = getActivityLevel(total)
                return (
                  <Tooltip key={day.date} delayDuration={180}>
                    <TooltipTrigger asChild>
                      <span
                        role="gridcell"
                        aria-label={describeActivity(day)}
                        className={cn(
                          'aspect-square w-full rounded-[1px] outline-none transition-colors duration-150',
                          ACTIVITY_COLORS[level],
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="space-y-1 px-3 py-2 text-xs">
                      <p className="font-medium">{day.date}</p>
                      <p className="tabular-nums">当天消耗：{formatCompactTokens(total)}</p>
                      {/* Tooltip 保持单一指标：当天总消耗。 */}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{data.startDate} 至 {data.endDate}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground" aria-label="活跃度颜色图例">
              <span>较少</span>
              {ACTIVITY_COLORS.map((color, index) => (
                <span key={color} className={cn('h-3 w-3 rounded-[1px]', color)} aria-label={`活跃度 ${index + 1}`} />
              ))}
              <span>较多</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t px-5 py-9">
          <div className="flex flex-col items-center text-center">
            <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
              {ACTIVITY_COLORS.slice(0, 4).map((color) => (
                <span key={color} className={cn('h-3 w-3 rounded-[1px]', color)} />
              ))}
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">还没有 Token 活跃记录</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              使用 Proma Agent 后，这里会展示每天的 Token 消耗；今日用量会持续显示在右上角。
            </p>
          </div>
        </div>
      )}

      <div className="border-t px-5 py-2">
        <button
          type="button"
          onClick={() => setSettingsTab('usage')}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm font-medium text-muted-foreground transition-[color,background-color,transform] hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
        >
          <span className="flex items-center gap-2">
            <ScrollText size={15} aria-hidden="true" />
            查看详细用量日志
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
