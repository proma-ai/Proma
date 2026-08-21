/**
 * 用量统计面板
 *
 * 展示 Agent 会话产生的 LLM Token 消耗与费用（USD）：
 * - 汇总卡片：总 Token / 总费用 / 运行次数 / 会话数
 * - 时间段切换：今日 / 近7天 / 近30天 / 全部
 * - 每日 token 堆叠柱状图 + 每日费用柱状图（SVG 自绘）
 * - 按渠道、按模型拆分的消耗占比
 * - 重新扫描按钮与最近扫描时间
 *
 * 数据来自主进程 usage-stats-service（agent-sessions JSONL 聚合），
 * 打开面板时拉取快照，之后每 30s 轮询刷新（增量补扫在 IPC handler 内完成）。
 */

import * as React from 'react'
import { BarChart3, RefreshCw, Sparkles } from 'lucide-react'
import type { UsageBreakdownDailyRow, UsageStatsSnapshot, UsageTokens } from '@proma/shared'
import { cn } from '@/lib/utils'
import {
  DailyCostChart,
  DailyTokensChart,
  StatCard,
  TOKEN_SERIES,
  UsageChartCard,
  UsageDonutChart,
  formatTokenCount,
  formatUsd,
} from './usage-charts'

const REFRESH_INTERVAL_MS = 30_000

type RangeKey = 'today' | '7d' | '30d' | 'all'

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: 'all', label: '全部' },
]

function sumTokens(tokens: UsageTokens): number {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens
}

function formatDateTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function addTokensInPlace(a: UsageTokens, b: UsageTokens): void {
  a.inputTokens += b.inputTokens
  a.outputTokens += b.outputTokens
  a.cacheReadTokens += b.cacheReadTokens
  a.cacheCreationTokens += b.cacheCreationTokens
}

interface BreakdownRowView {
  name: string
  sub: string | undefined
  tokens: UsageTokens
  costUsd: number
  runs: number
}

function emptyViewTokens(): UsageTokens {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
}

/** 把按天明细聚合到指定维度（provider 或 model）；model 维度按 provider+model 分组，避免同名模型跨渠道被合并 */
function aggregateBreakdown(rows: UsageBreakdownDailyRow[], dimension: 'provider' | 'model'): BreakdownRowView[] {
  const map = new Map<string, BreakdownRowView>()
  for (const row of rows) {
    const key = dimension === 'provider' ? row.provider : `${row.provider}/${row.model}`
    const entry = map.get(key) ?? {
      name: dimension === 'provider' ? row.provider : row.model,
      sub: dimension === 'provider' ? undefined : row.provider,
      tokens: emptyViewTokens(),
      costUsd: 0,
      runs: 0,
    }
    addTokensInPlace(entry.tokens, row.tokens)
    entry.costUsd += row.costUsd
    entry.runs += row.runs
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => sumTokens(b.tokens) - sumTokens(a.tokens))
}

export function UsageView(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<UsageStatsSnapshot | null>(null)
  const [range, setRange] = React.useState<RangeKey>('7d')
  const [loading, setLoading] = React.useState(true)
  const [rescanned, setRescanned] = React.useState(false)

  const load = React.useCallback(async (force = false) => {
    try {
      const api = (window as unknown as { electronAPI: { getUsageStats: () => Promise<unknown>; rescanUsageStats: () => Promise<unknown> } }).electronAPI
      if (!api?.getUsageStats) return
      const raw = force ? await api.rescanUsageStats() : await api.getUsageStats()
      setSnapshot(raw as UsageStatsSnapshot)
      if (force) setRescanned(true)
    } catch (err) {
      console.error('[用量统计] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // 面板常驻时轮询刷新，让新消耗自动出现在图表里
  React.useEffect(() => {
    const timer = setInterval(() => void load(false), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  const rangeCutoffMs = React.useMemo(() => {
    const now = Date.now()
    if (range === 'today') return new Date(now).setHours(0, 0, 0, 0)
    if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
    if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
    return 0
  }, [range])

  const filteredDaily = React.useMemo(() => {
    if (!snapshot) return []
    return snapshot.daily.filter((d) => (range === 'all' ? true : new Date(`${d.day}T00:00:00`).getTime() >= rangeCutoffMs))
  }, [snapshot, range, rangeCutoffMs])

  const totalsInRange = React.useMemo(() => {
    const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    let costUsd = 0
    let runs = 0
    for (const d of filteredDaily) {
      addTokensInPlace(tokens, d.tokens)
      costUsd += d.costUsd
      runs += d.runs
    }
    return { tokens, costUsd, runs }
  }, [filteredDaily])

  // 渠道/模型占比：按所选时间范围内所有会话的按天明细重新聚合（与汇总卡同口径）
  const filteredBreakdown = React.useMemo(() => {
    if (!snapshot?.breakdownDaily) return []
    return snapshot.breakdownDaily.filter(
      (r) => range === 'all' || new Date(`${r.day}T00:00:00`).getTime() >= rangeCutoffMs,
    )
  }, [snapshot, range, rangeCutoffMs])

  const byProvider = React.useMemo(() => aggregateBreakdown(filteredBreakdown, 'provider'), [filteredBreakdown])

  const byModel = React.useMemo(() => aggregateBreakdown(filteredBreakdown, 'model'), [filteredBreakdown])

  const totalTokens = snapshot ? sumTokens(snapshot.totals.tokens) : 0
  const rangeTokens = sumTokens(totalsInRange.tokens)

  return (
    <div className="h-full overflow-y-auto">
      {/* pt-14：避开 AppShell 顶部 50px 的全局窗口拖拽层，否则时间切换/重新扫描按钮的点击会被拖拽吞掉 */}
      <div className="titlebar-no-drag mx-auto max-w-5xl px-6 pb-6 pt-14">
        {/* 标题行 */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <BarChart3 size={18} />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">用量统计</h1>
              <p className="text-xs text-foreground/45">Agent 会话 Token 消耗与费用（SDK 实测口径）</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    range === r.key ? 'bg-primary text-primary-foreground' : 'text-foreground/55 hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/5 disabled:opacity-50"
              title="忽略增量缓存，全量重新扫描历史会话"
            >
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              重新扫描
            </button>
          </div>
        </div>

        {rescanned && (
          <div className="mb-4 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
            已全量重新扫描历史会话，数据已更新。
          </div>
        )}

        {/* 汇总卡片 */}
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label={`Token 消耗${range === 'all' ? '' : '（本区间）'}`}
            value={formatTokenCount(rangeTokens)}
            sub={range === 'all' ? `累计 ${formatTokenCount(totalTokens)}` : `总计 ${formatTokenCount(totalTokens)}`}
            accent
          />
          <StatCard
            label="费用（USDT）"
            value={formatUsd(totalsInRange.costUsd)}
            sub={range === 'all' ? '' : `总计 ${formatUsd(snapshot?.totals.costUsd ?? 0)}`}
          />
          <StatCard
            label="运行次数"
            value={String(range === 'all' ? snapshot?.totals.runs ?? 0 : totalsInRange.runs)}
            sub={range === 'all' ? '' : `总计 ${snapshot?.totals.runs ?? 0}`}
          />
          <StatCard
            label="会话数"
            value={String(snapshot?.totals.sessions ?? 0)}
            sub="已纳入统计的 Agent 会话"
          />
        </div>

        {/* 图表区 */}
        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <UsageChartCard title="每日 Token 消耗（按日堆叠）">
            <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-foreground/55">
              {TOKEN_SERIES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
            {filteredDaily.length > 0 ? (
              <DailyTokensChart days={filteredDaily} maxBars={range === 'all' ? 120 : 30} />
            ) : (
              <EmptyHint />
            )}
          </UsageChartCard>
          <UsageChartCard title="每日费用（USD）">
            {filteredDaily.length > 0 ? (
              <DailyCostChart days={filteredDaily} maxBars={range === 'all' ? 120 : 30} />
            ) : (
              <EmptyHint />
            )}
          </UsageChartCard>
        </div>

        {/* 占比圆饼图 */}
        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <UsageChartCard title="渠道占比（Token）">
            <UsageDonutChart
              items={byProvider.map((r) => ({ name: r.name, value: sumTokens(r.tokens) }))}
              formatValue={formatTokenCount}
            />
          </UsageChartCard>
          <UsageChartCard title="模型占比（Token）">
            <UsageDonutChart
              items={byModel.map((r) => ({ name: r.name, sub: r.sub, value: sumTokens(r.tokens) }))}
              formatValue={formatTokenCount}
            />
          </UsageChartCard>
        </div>

        {/* 明细表格 */}
        <UsageChartCard title="模型明细">
          {byModel.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-foreground/40">
                    <th className="py-2 pr-3 font-normal">模型</th>
                    <th className="py-2 pr-3 font-normal">渠道</th>
                    <th className="py-2 pr-3 text-right font-normal">输入</th>
                    <th className="py-2 pr-3 text-right font-normal">输出</th>
                    <th className="py-2 pr-3 text-right font-normal">缓存</th>
                    <th className="py-2 pr-3 text-right font-normal">Token 合计</th>
                    <th className="py-2 pr-3 text-right font-normal">费用</th>
                    <th className="py-2 text-right font-normal">运行</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row) => (
                    <tr key={`${row.sub ?? ''}-${row.name}`} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground/80">{row.name}</td>
                      <td className="py-2 pr-3 text-foreground/50">{row.sub ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground/60">{formatTokenCount(row.tokens.inputTokens)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground/60">{formatTokenCount(row.tokens.outputTokens)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground/60">
                        {formatTokenCount(row.tokens.cacheReadTokens + row.tokens.cacheCreationTokens)}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{formatTokenCount(sumTokens(row.tokens))}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatUsd(row.costUsd)}</td>
                      <td className="py-2 text-right tabular-nums text-foreground/60">{row.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyHint />
          )}
        </UsageChartCard>

        {/* Proma Cloud 余额占位 + 页脚 */}
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-border/70 bg-card/30 p-4 text-xs text-foreground/55">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-primary/70" />
            <div>
              <div className="mb-1 font-medium text-foreground/75">Proma Cloud 积分</div>
              <div>
                本地渠道消耗（含 proma-cloud 渠道）已纳入上方统计；账户余额需前往 Proma Cloud 控制台查看。
                接入余额查询接口后，此处将展示实时积分余额与预估可用额度。
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-foreground/35">
            <span>统计口径：Token 按 assistant 消息逐条累加；费用取 SDK 返回的 total_cost_usd 实测值；缺失渠道不估算。</span>
            <span>最近扫描：{formatDateTime(snapshot?.lastScannedAt ?? 0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyHint(): React.ReactElement {
  return <div className="flex h-32 items-center justify-center text-sm text-foreground/35">暂无数据</div>
}