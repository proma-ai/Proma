import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SubscriptionOrderHistoryResponse, SubscriptionOrderStatus } from '@proma/shared'

const PAGE_SIZE = 10

const STATUS_META: Record<SubscriptionOrderStatus, { label: string; className: string }> = {
  ACTIVE: { label: '生效中', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  PENDING: { label: '待支付', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  EXPIRED: { label: '已过期', className: 'border-muted-foreground/25 bg-muted text-muted-foreground' },
  CANCELLED: { label: '已取消', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatAmount(amount: number): string {
  return amount === 0 ? '赠送' : `¥${(amount / 100).toFixed(2)}`
}

export function SubscriptionOrderHistory(): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [history, setHistory] = React.useState<SubscriptionOrderHistoryResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadPage = React.useCallback(async (page: number) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.cloudSubscription.getHistory({ page, page_size: PAGE_SIZE })
      if (result.success && result.data) {
        setHistory(result.data)
      } else {
        setError(result.error ?? '订阅订单记录加载失败，请重试。')
      }
    } catch {
      setError('订阅订单记录加载失败，请重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleToggle = (): void => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && !history && !loading) {
      void loadPage(1)
    }
  }

  const copyOrderNo = async (orderNo: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(orderNo)
      toast.success('订单号已复制')
    } catch {
      toast.error('复制订单号失败')
    }
  }

  const totalPages = history ? Math.ceil(history.total / history.page_size) : 0

  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          onClick={handleToggle}
          aria-expanded={open}
        >
          <div>
            <h3 className="text-sm font-semibold">订阅订单记录</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {history ? `共 ${history.total} 条` : '查看购买与赠送的订阅记录'}
            </p>
          </div>
          {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="border-t px-4 py-3">
            {loading && !history ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                正在加载订单记录…
              </div>
            ) : error ? (
              <div className="py-3 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadPage(history?.page ?? 1)}>
                  重试
                </Button>
              </div>
            ) : history && history.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无订阅订单</p>
            ) : history ? (
              <>
                <div className="space-y-2">
                  {history.items.map((order) => {
                    const status = STATUS_META[order.status]
                    return (
                      <div key={order.id} className="rounded-lg border border-border/70 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">{order.tier_name}</span>
                            <Badge variant="outline" className={`shrink-0 text-[10px] ${status.className}`}>
                              {status.label}
                            </Badge>
                          </div>
                          <span className="shrink-0 text-sm font-medium tabular-nums">{formatAmount(order.amount)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="truncate">{formatDate(order.created_at)}</span>
                          <span className="shrink-0">至 {formatDate(order.expires_at)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>剩余 {Math.max(0, Number(order.remaining_quota)).toFixed(2)} / {Number(order.quota).toFixed(2)} 积分</span>
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                            onClick={() => void copyOrderNo(order.order_no)}
                            aria-label={`复制订单号 ${order.order_no}`}
                          >
                            <Copy className="size-3" />
                            订单号
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">第 {history.page} / {totalPages} 页</p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        disabled={loading || history.page <= 1}
                        onClick={() => void loadPage(history.page - 1)}
                        aria-label="上一页"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        disabled={loading || history.page >= totalPages}
                        onClick={() => void loadPage(history.page + 1)}
                        aria-label="下一页"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
