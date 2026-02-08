/**
 * OrderHistory - 订单历史表格
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { orderHistoryAtom } from '@/atoms/cloud-billing'

interface StatusConfig {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

const statusMap: Record<string, StatusConfig> = {
  PENDING: { label: '待支付', variant: 'outline' },
  PAID: { label: '处理中', variant: 'secondary' },
  COMPLETED: { label: '已完成', variant: 'default' },
  FAILED: { label: '失败', variant: 'destructive' },
  EXPIRED: { label: '已过期', variant: 'outline' },
  REFUNDED: { label: '已退款', variant: 'secondary' },
}

const PAGE_SIZE = 10

export function OrderHistory(): React.ReactElement {
  const [orders, setOrders] = useAtom(orderHistoryAtom)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(1)

  const fetchOrders = React.useCallback(async () => {
    const result = await window.electronAPI.cloudBilling.getOrders()
    if (result.success && result.data) {
      setOrders(result.data)
    }
  }, [setOrders])

  React.useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleManualRefresh = async (): Promise<void> => {
    setIsRefreshing(true)
    await fetchOrders()
    setCurrentPage(1)
    setIsRefreshing(false)
  }

  const totalPages = Math.ceil(orders.length / PAGE_SIZE)
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const paginatedOrders = orders.slice(startIndex, startIndex + PAGE_SIZE)

  if (orders.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">充值记录</h3>
          <Button variant="ghost" size="sm" onClick={handleManualRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="text-center py-8 text-sm text-muted-foreground">暂无充值记录</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">充值记录</h3>
        <Button variant="ghost" size="sm" onClick={handleManualRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">时间</TableHead>
            <TableHead className="text-xs">档位</TableHead>
            <TableHead className="text-xs">金额</TableHead>
            <TableHead className="text-xs">渠道</TableHead>
            <TableHead className="text-xs">状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedOrders.map((order) => {
            const status = statusMap[order.status] || { label: order.status, variant: 'outline' as const }
            return (
              <TableRow key={order.order_no}>
                <TableCell className="text-xs">
                  {new Date(order.created_at).toLocaleString('zh-CN')}
                </TableCell>
                <TableCell className="text-xs">${order.credits}</TableCell>
                <TableCell className="text-xs">¥{(order.amount / 100).toFixed(0)}</TableCell>
                <TableCell className="text-xs">
                  {order.payment_channel === 'WECHAT' ? '微信' : 'Stripe'}
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">共 {orders.length} 条记录</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs">{currentPage} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
