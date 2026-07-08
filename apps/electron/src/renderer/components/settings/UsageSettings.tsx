/**
 * UsageSettings - 用量日志设置页
 *
 * Cloud 模式专属功能，展示 4 类调用日志：
 * - 模型调用日志
 * - 工具调用日志
 * - 语音用量日志
 * - Agent API 调用日志
 *
 * 支持日期筛选、分页、统计卡片。
 */

import * as React from 'react'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSection } from './primitives'
import type {
  DateFilter,
  UsageQueryParams,
  UsageLogResponse,
  ToolUsageLogResponse,
  SpeechUsageLogResponse,
  AgentUsageLogResponse,
  BillingIpcResponse,
} from '@proma/shared'

// ===== 类型 =====

type UsageTab = 'model' | 'tool' | 'speech' | 'agent'

// ===== 工具函数 =====

/** 格式化日期时间 */
function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 格式化费用（积分） */
function formatCost(cost: number | string): string {
  const num = typeof cost === 'string' ? parseFloat(cost) : cost
  return `${num.toFixed(2)} 积分`
}

/** 格式化 token 数（去掉不必要的尾零，如 100.0K → 100K） */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${parseFloat((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${parseFloat((tokens / 1_000).toFixed(1))}K`
  return String(tokens)
}

/** 格式化时长（秒） */
function formatDuration(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${seconds.toFixed(1)}s`
}

/** 格式化耗时（毫秒） */
function formatMs(ms: number | null): string {
  if (ms === null) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

// ===== 日期筛选按钮组 =====

const DATE_FILTER_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨日' },
  { value: 'all', label: '全部' },
]

function DateFilterGroup({
  value,
  onChange,
}: {
  value: DateFilter
  onChange: (v: DateFilter) => void
}): React.ReactElement {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {DATE_FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            value === opt.value
              ? 'bg-background text-foreground shadow font-medium'
              : 'hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ===== 分页组件 =====

function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number
  total: number
  pageSize: number
  onChange: (page: number) => void
}): React.ReactElement | null {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-sm text-muted-foreground">
        共 {total} 条，第 {page}/{totalPages} 页
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}

// ===== 统计卡片 =====

function StatCard({ label, value, description }: { label: string; value: string; description?: string }): React.ReactElement {
  return (
    <div className="rounded-lg bg-muted/50 p-3 flex-1 min-w-0">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold truncate">{value}</p>
      {description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>}
    </div>
  )
}

// ===== 数据加载 Hook =====

function useUsageData<T>(
  fetcher: (params: UsageQueryParams) => Promise<BillingIpcResponse<T>>,
  dateFilter: DateFilter,
  page: number,
) {
  const [data, setData] = React.useState<T | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetcher({ dateFilter, page, pageSize: 20 }).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setData(res.data)
      } else {
        setError(res.error ?? '加载失败')
      }
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError('网络错误')
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [fetcher, dateFilter, page])

  return { data, loading, error }
}

// ===== 加载/错误/空状态 =====

function LoadingState(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 size={18} className="animate-spin mr-2" />
      <span className="text-sm">加载中...</span>
    </div>
  )
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="text-center py-12">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div className="text-center py-12">
      <p className="text-sm text-muted-foreground">暂无数据</p>
    </div>
  )
}

function TruncatedTooltipText({ value }: { value: string }): React.ReactElement {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className="block truncate">{value}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[360px] break-all text-xs">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

// ===== 模型调用日志表 =====

function ModelUsageTable({
  dateFilter,
}: {
  dateFilter: DateFilter
}): React.ReactElement {
  const [page, setPage] = React.useState(1)
  const fetcher = React.useCallback(
    (params: UsageQueryParams) => window.electronAPI.cloudUsage.getUsageLogs(params),
    [],
  )
  const { data, loading, error } = useUsageData<UsageLogResponse>(fetcher, dateFilter, page)

  // 日期筛选变化时重置分页
  React.useEffect(() => { setPage(1) }, [dateFilter])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data || data.items.length === 0) return <EmptyState />

  return (
    <>
      <div className="flex gap-3 mb-4">
        <StatCard label="总请求" value={String(data.stats.totalRequests)} />
        <StatCard label="输入 Token" value={formatTokens(data.stats.totalInputTokens)} />
        <StatCard label="输出 Token" value={formatTokens(data.stats.totalOutputTokens)} />
        <StatCard label="总费用" value={formatCost(data.stats.totalCost)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">时间</TableHead>
            <TableHead>模型</TableHead>
            <TableHead className="text-right">输入</TableHead>
            <TableHead className="text-right">输出</TableHead>
            <TableHead className="text-right">费用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</TableCell>
              <TableCell className="font-medium text-xs max-w-[180px]">
                <TruncatedTooltipText value={item.modelName} />
              </TableCell>
              <TableCell className="text-right text-xs">{formatTokens(item.inputTokens)}</TableCell>
              <TableCell className="text-right text-xs">{formatTokens(item.outputTokens)}</TableCell>
              <TableCell className="text-right text-xs">{formatCost(item.totalCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
    </>
  )
}

// ===== 工具调用日志表 =====

function ToolUsageTable({
  dateFilter,
}: {
  dateFilter: DateFilter
}): React.ReactElement {
  const [page, setPage] = React.useState(1)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const fetcher = React.useCallback(
    (params: UsageQueryParams) => window.electronAPI.cloudUsage.getToolUsageLogs(params),
    [],
  )
  const { data, loading, error } = useUsageData<ToolUsageLogResponse>(fetcher, dateFilter, page)

  React.useEffect(() => { setPage(1) }, [dateFilter])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data || data.items.length === 0) return <EmptyState />

  return (
    <>
      <div className="flex gap-3 mb-4">
        <StatCard label="总请求" value={String(data.stats.totalRequests)} />
        <StatCard label="总费用" value={formatCost(data.stats.totalCost)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">时间</TableHead>
            <TableHead>工具名</TableHead>
            <TableHead>输入参数</TableHead>
            <TableHead className="text-right">费用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</TableCell>
              <TableCell className="font-medium text-xs">{item.toolName}</TableCell>
              <TableCell className="text-xs max-w-[200px]">
                {item.toolInput ? (
                  <button
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="text-left text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expandedId === item.id ? (
                      <pre className="whitespace-pre-wrap text-xs max-h-40 overflow-auto">{item.toolInput}</pre>
                    ) : (
                      <span className="truncate block max-w-[200px]">{item.toolInput.slice(0, 50)}...</span>
                    )}
                  </button>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">{formatCost(item.cost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
    </>
  )
}

// ===== 语音用量日志表 =====

function SpeechUsageTable({
  dateFilter,
}: {
  dateFilter: DateFilter
}): React.ReactElement {
  const [page, setPage] = React.useState(1)
  const fetcher = React.useCallback(
    (params: UsageQueryParams) => window.electronAPI.cloudUsage.getSpeechUsageLogs(params),
    [],
  )
  const { data, loading, error } = useUsageData<SpeechUsageLogResponse>(fetcher, dateFilter, page)

  React.useEffect(() => { setPage(1) }, [dateFilter])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data || data.items.length === 0) return <EmptyState />

  return (
    <>
      <div className="flex gap-3 mb-4">
        <StatCard label="总请求" value={String(data.stats.totalRequests)} />
        <StatCard label="成功" value={String(data.stats.successfulRequests)} />
        <StatCard label="总时长" value={formatDuration(data.stats.totalDurationSeconds)} />
        <StatCard label="总费用" value={formatCost(data.stats.totalCost)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">时间</TableHead>
            <TableHead>模型</TableHead>
            <TableHead className="text-right">时长</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead className="text-center">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</TableCell>
              <TableCell className="font-medium text-xs max-w-[180px]">
                <TruncatedTooltipText value={item.modelName} />
              </TableCell>
              <TableCell className="text-right text-xs">{formatDuration(item.durationSeconds)}</TableCell>
              <TableCell className="text-right text-xs">{formatCost(item.cost)}</TableCell>
              <TableCell className="text-center">
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                  item.status === 'SUCCESS'
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-red-500/10 text-red-600'
                }`}>
                  {item.status === 'SUCCESS' ? '成功' : '失败'}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
    </>
  )
}

// ===== Agent API 调用日志表 =====

function AgentUsageTable({
  dateFilter,
}: {
  dateFilter: DateFilter
}): React.ReactElement {
  const [page, setPage] = React.useState(1)
  const fetcher = React.useCallback(
    (params: UsageQueryParams) => window.electronAPI.cloudUsage.getAgentUsageLogs(params),
    [],
  )
  const { data, loading, error } = useUsageData<AgentUsageLogResponse>(fetcher, dateFilter, page)

  React.useEffect(() => { setPage(1) }, [dateFilter])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data || data.items.length === 0) return <EmptyState />

  return (
    <>
      <div className="flex gap-3 mb-4 flex-wrap">
        <StatCard
          label="总请求"
          value={String(data.stats.totalRequests)}
          description={`↑${data.stats.successCount} · ↓${data.stats.errorCount}`}
        />
        <StatCard label="输入" value={formatTokens(data.stats.totalInputTokens)} />
        <StatCard label="输出" value={formatTokens(data.stats.totalOutputTokens)} />
        <StatCard label="写缓存" value={formatTokens(data.stats.totalCacheCreationTokens)} />
        <StatCard label="读缓存" value={formatTokens(data.stats.totalCacheReadTokens)} />
        <StatCard label="总费用" value={formatCost(data.stats.totalCost)} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px] whitespace-nowrap">时间</TableHead>
            <TableHead className="whitespace-nowrap">API Key</TableHead>
            <TableHead className="whitespace-nowrap">模型</TableHead>
            <TableHead className="whitespace-nowrap">端点</TableHead>
            <TableHead className="text-right whitespace-nowrap">输入</TableHead>
            <TableHead className="text-right whitespace-nowrap">输出</TableHead>
            <TableHead className="text-right whitespace-nowrap">写缓存</TableHead>
            <TableHead className="text-right whitespace-nowrap">读缓存</TableHead>
            <TableHead className="text-right whitespace-nowrap">工具</TableHead>
            <TableHead className="text-center whitespace-nowrap">状态</TableHead>
            <TableHead className="text-right whitespace-nowrap">耗时</TableHead>
            <TableHead className="text-right whitespace-nowrap">费用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</TableCell>
              <TableCell className="font-medium text-xs truncate max-w-[100px]">{item.apiKeyName}</TableCell>
              <TableCell className="text-xs max-w-[120px]">
                <TruncatedTooltipText value={item.modelId ?? '-'} />
              </TableCell>
              <TableCell className="text-xs truncate max-w-[120px]">{item.endpoint}</TableCell>
              <TableCell className="text-right text-xs">{formatTokens(item.inputTokens)}</TableCell>
              <TableCell className="text-right text-xs">{formatTokens(item.outputTokens)}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {item.cacheCreationInputTokens > 0 ? formatTokens(item.cacheCreationInputTokens) : '-'}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {item.cacheReadInputTokens > 0 ? formatTokens(item.cacheReadInputTokens) : '-'}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {item.webSearchRequests + item.webFetchRequests > 0
                  ? item.webSearchRequests + item.webFetchRequests
                  : '-'}
              </TableCell>
              <TableCell className="text-center">
                {item.responseStatus !== null ? (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                    item.responseStatus >= 200 && item.responseStatus < 300
                      ? 'bg-green-500/10 text-green-600'
                      : 'bg-red-500/10 text-red-600'
                  }`}>
                    {item.responseStatus}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">-</span>
                )}
              </TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap">{formatMs(item.durationMs)}</TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap">{formatCost(item.totalCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={data.page} total={data.total} pageSize={data.pageSize} onChange={setPage} />
    </>
  )
}

// ===== 主组件 =====

export function UsageSettings(): React.ReactElement {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>('today')
  const [activeTab, setActiveTab] = React.useState<UsageTab>('model')

  return (
    <SettingsSection title="调用日志" description="查看各类 API 调用记录和用量统计">
      {/* 日期筛选 */}
      <div className="mb-4">
        <DateFilterGroup value={dateFilter} onChange={setDateFilter} />
      </div>

      {/* 子标签 + 表格 */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as UsageTab)}>
        <TabsList>
          <TabsTrigger value="model">模型调用</TabsTrigger>
          <TabsTrigger value="tool">工具调用</TabsTrigger>
          <TabsTrigger value="speech">语音用量</TabsTrigger>
          <TabsTrigger value="agent">Agent API</TabsTrigger>
        </TabsList>

        <TabsContent value="model">
          <ModelUsageTable dateFilter={dateFilter} />
        </TabsContent>
        <TabsContent value="tool">
          <ToolUsageTable dateFilter={dateFilter} />
        </TabsContent>
        <TabsContent value="speech">
          <SpeechUsageTable dateFilter={dateFilter} />
        </TabsContent>
        <TabsContent value="agent">
          <AgentUsageTable dateFilter={dateFilter} />
        </TabsContent>
      </Tabs>
    </SettingsSection>
  )
}
