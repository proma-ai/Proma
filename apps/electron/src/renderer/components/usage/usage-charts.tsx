/**
 * 用量统计面板的轻量 SVG 图表
 *
 * 项目未引入图表库（recharts/echarts 均无），这里用纯 SVG 自绘：
 * - DailyTokensChart：按日 token 堆叠柱状图（input / output / cache_read / cache_creation）
 * - DailyCostChart：按日费用柱状图（USD）
 * - UsageDonutChart：渠道/模型占比圆环饼图（按所选时间范围聚合后的数据）
 *
 * 全部数值在组件内格式化，不依赖外部工具库。
 */

import * as React from 'react'
import type { UsageDayRow } from '@proma/shared'
import { cn } from '@/lib/utils'

const TOKEN_COLORS = {
  input: 'hsl(222 85% 62%)',
  output: 'hsl(262 82% 68%)',
  cacheRead: 'hsl(158 70% 54%)',
  cacheCreation: 'hsl(35 85% 58%)',
}

export const TOKEN_SERIES = [
  { key: 'inputTokens', label: '输入', color: TOKEN_COLORS.input },
  { key: 'outputTokens', label: '输出', color: TOKEN_COLORS.output },
  { key: 'cacheReadTokens', label: '缓存读', color: TOKEN_COLORS.cacheRead },
  { key: 'cacheCreationTokens', label: '缓存写', color: TOKEN_COLORS.cacheCreation },
] as const

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`
  return String(n)
}

function formatUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function sumDayTokens(day: UsageDayRow): number {
  return day.tokens.inputTokens + day.tokens.outputTokens + day.tokens.cacheReadTokens + day.tokens.cacheCreationTokens
}

/** 短日期标签：MM-DD */
function shortDay(day: string): string {
  const [, m, d] = day.split('-')
  return `${m}-${d}`
}

interface BarChartProps {
  width?: number
  height?: number
  children?: React.ReactNode
}

/** 统一图表外壳：带背景与圆角，防止暗色主题下图表突兀 */
export function UsageChartCard({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground/70">{title}</h3>
      {children}
    </div>
  )
}

/**
 * 按日 token 堆叠柱状图
 *
 * @param days 按日升序的行
 * @param maxBars 最多展示多少根柱子（保留最近 N 天）
 */
export function DailyTokensChart({ days, maxBars = 60, height = 220 }: { days: UsageDayRow[]; maxBars?: number; height?: number }): React.ReactElement {
  const chartDays = days.slice(-maxBars)
  const totals = chartDays.map(sumDayTokens)
  const max = Math.max(1, ...totals)

  const W = Math.max(320, chartDays.length * 36 + 24)
  const H = height
  const padTop = 16
  const padBottom = 26
  const padLeft = 8
  const padRight = 8
  const innerH = H - padTop - padBottom
  const barW = Math.max(6, Math.min(22, (W - padLeft - padRight) / chartDays.length - 6))

  const yScale = (v: number): number => padTop + innerH - (v / max) * innerH

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="按日 token 消耗柱状图">
        {/* 网格线 0 / 50% / 100% */}
        {[0, 0.5, 1].map((ratio) => {
          const y = padTop + innerH - ratio * innerH
          return (
            <g key={ratio}>
              <line x1={padLeft} x2={W - padRight} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={W - padRight} y={y - 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.4}>
                {ratio === 0 ? '' : ratio === 1 ? formatTokenCount(max) : formatTokenCount(max / 2)}
              </text>
            </g>
          )
        })}

        {chartDays.map((day, i) => {
          const x = padLeft + i * ((W - padLeft - padRight) / chartDays.length) + (barW > 6 ? 3 : 0)
          // 堆叠：从底部（padTop + innerH）向上逐段累加
          let cursor = padTop + innerH
          const rects: React.ReactElement[] = []
          for (const series of TOKEN_SERIES) {
            const v = day.tokens[series.key]
            if (v <= 0) continue
            const h = Math.max(1, (v / max) * innerH)
            cursor -= h
            rects.push(
              <rect
                key={series.key}
                x={x}
                y={cursor}
                width={barW}
                height={h}
                fill={series.color}
                rx={1}
                opacity={0.9}
              >
                <title>{`${day.day} ${series.label}: ${v.toLocaleString()} tokens`}</title>
              </rect>,
            )
          }
          // 全零日期画一条底部基线
          const showAxis = i % Math.ceil(chartDays.length / 12) === 0 || chartDays.length <= 15
          return (
            <g key={day.day}>
              {rects}
              {showAxis && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
                  {shortDay(day.day)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 按日费用柱状图（USD） */
export function DailyCostChart({ days, maxBars = 60, height = 160 }: { days: UsageDayRow[]; maxBars?: number; height?: number }): React.ReactElement {
  const chartDays = days.slice(-maxBars)
  const max = Math.max(0.0001, ...chartDays.map((d) => d.costUsd))
  const W = Math.max(320, chartDays.length * 36 + 24)
  const H = height
  const padTop = 16
  const padBottom = 26
  const padLeft = 8
  const padRight = 8
  const innerH = H - padTop - padBottom
  const barW = Math.max(6, Math.min(22, (W - padLeft - padRight) / chartDays.length - 6))

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="按日费用柱状图">
        {chartDays.map((day, i) => {
          const v = day.costUsd
          const h = (v / max) * innerH
          const x = padLeft + i * ((W - padLeft - padRight) / chartDays.length) + (barW > 6 ? 3 : 0)
          const y = padTop + innerH - h
          const showAxis = i % Math.ceil(chartDays.length / 12) === 0 || chartDays.length <= 15
          return (
            <g key={day.day}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                fill="hsl(142 71% 45%)"
                rx={1}
                opacity={v > 0 ? 0.85 : 0.15}
              >
                <title>{`${day.day}: ${formatUsd(v)}`}</title>
              </rect>
              {showAxis && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
                  {shortDay(day.day)}
                </text>
              )}
            </g>
          )
        })}
        {max > 0.0001 && (
          <text x={W - padRight} y={padTop - 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.4}>
            {formatUsd(max)}
          </text>
        )}
      </svg>
    </div>
  )
}

/** 占比圆饼图配色盘（按切片顺序循环取色） */
const PIE_COLORS = [
  'hsl(222 85% 62%)',
  'hsl(262 82% 68%)',
  'hsl(158 70% 54%)',
  'hsl(35 85% 58%)',
  'hsl(0 78% 62%)',
  'hsl(190 80% 55%)',
  'hsl(300 70% 62%)',
  'hsl(84 65% 55%)',
]

/** 渠道/模型占比圆环饼图：超出 topN 的项合并为「其他」，中心展示合计，右侧图例带百分比与数值 */
export function UsageDonutChart({
  items,
  formatValue,
  topN = 8,
}: {
  items: Array<{ name: string; sub?: string; value: number }>
  formatValue: (v: number) => string
  topN?: number
}): React.ReactElement {
  const sorted = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const slices = rest.length > 0
    ? [...top, { name: '其他', sub: undefined as string | undefined, value: rest.reduce((sum, item) => sum + item.value, 0) }]
    : top
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  if (total <= 0 || slices.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-foreground/35">暂无数据</div>
  }

  // 用 stroke-dasharray 在同一半径上依次画扇区，间隙 1.5px 保证切片边界可辨
  const size = 136
  const radius = 52
  const strokeWidth = 22
  const circumference = 2 * Math.PI * radius
  let drawn = 0

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="shrink-0 text-foreground">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="占比圆饼图">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {slices.map((slice, index) => {
              const length = (slice.value / total) * circumference
              const gap = slices.length > 1 ? Math.min(1.5, length * 0.15) : 0
              const dash = Math.max(length - gap, 0.5)
              const dashOffset = -drawn - gap / 2
              drawn += length
              return (
                <circle
                  key={`${slice.name}-${index}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={PIE_COLORS[index % PIE_COLORS.length]!}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={dashOffset}
                />
              )
            })}
          </g>
          <text x="50%" y="48%" textAnchor="middle" className="text-[13px] font-semibold tabular-nums" fill="currentColor">
            {formatValue(total)}
          </text>
          <text x="50%" y="61%" textAnchor="middle" className="text-[10px]" fill="currentColor" opacity="0.4">
            合计
          </text>
        </svg>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice, index) => (
          <div key={`${slice.name}-${index}`} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
            />
            <span
              className="min-w-0 flex-1 truncate text-foreground/70"
              title={slice.sub ? `${slice.name}（${slice.sub}）` : slice.name}
            >
              {slice.name}
              {slice.sub ? <span className="ml-1 text-[10px] text-foreground/40">{slice.sub}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-foreground/45">{Math.round((slice.value / total) * 100)}%</span>
            <span className="w-14 shrink-0 text-right tabular-nums text-foreground/60">{formatValue(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 汇总数字卡片 */
export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }): React.ReactElement {
  return (
    <div className={cn('rounded-xl border p-4', accent ? 'border-primary/25 bg-primary/5' : 'border-border/60 bg-card/40')}>
      <div className="text-xs text-foreground/50">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accent ? 'text-primary' : 'text-foreground')}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-foreground/40">{sub}</div> : null}
    </div>
  )
}

export { formatTokenCount, formatUsd, sumDayTokens }