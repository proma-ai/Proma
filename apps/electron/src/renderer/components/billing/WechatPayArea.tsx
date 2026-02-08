/**
 * WechatPayArea - 微信支付区域
 *
 * 展示微信二维码 + 倒计时 + 轮询订单状态
 * Electron 桌面端使用 QR 图片 URL（来自 code_url）
 */

import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'

/** 支付状态 */
export type WechatPayStatus = 'paying' | 'success' | 'failed' | 'expired'

interface WechatPayAreaProps {
  codeUrl: string
  orderNo: string
  amount: number
  expireAt: string
  status: WechatPayStatus
  onPoll: () => Promise<void>
  onReset: () => void
}

export function WechatPayArea({
  codeUrl,
  orderNo,
  amount,
  expireAt,
  status,
  onPoll,
  onReset,
}: WechatPayAreaProps): React.ReactElement {
  const [timeLeft, setTimeLeft] = React.useState<number>(0)
  const pollIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // 倒计时
  React.useEffect(() => {
    const expireTime = new Date(expireAt).getTime()
    const updateTimeLeft = (): number => {
      const now = Date.now()
      const left = Math.max(0, Math.floor((expireTime - now) / 1000))
      setTimeLeft(left)
      return left
    }

    updateTimeLeft()
    const timer = setInterval(() => {
      const left = updateTimeLeft()
      if (left <= 0) clearInterval(timer)
    }, 1000)

    return () => clearInterval(timer)
  }, [expireAt])

  // 轮询订单状态
  React.useEffect(() => {
    if (status === 'paying') {
      pollIntervalRef.current = setInterval(onPoll, 2000)
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [status, onPoll])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (status === 'success') {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30">
        <CardContent className="pt-6 text-center">
          <CheckCircle2 className="h-16 w-16 mx-auto text-green-500" />
          <p className="mt-4 text-lg font-medium text-green-700 dark:text-green-400">支付成功</p>
          <p className="text-sm text-green-600 dark:text-green-500">额度已充值到账</p>
          <Button className="mt-4" onClick={onReset}>继续充值</Button>
        </CardContent>
      </Card>
    )
  }

  if (status === 'failed') {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30">
        <CardContent className="pt-6 text-center">
          <XCircle className="h-16 w-16 mx-auto text-red-500" />
          <p className="mt-4 text-lg font-medium text-red-700 dark:text-red-400">支付失败</p>
          <p className="text-sm text-red-600 dark:text-red-500">请重新尝试</p>
          <Button className="mt-4" onClick={onReset}>重新充值</Button>
        </CardContent>
      </Card>
    )
  }

  if (status === 'expired' || timeLeft <= 0) {
    return (
      <Card className="border-muted">
        <CardContent className="pt-6 text-center">
          <Clock className="h-16 w-16 mx-auto text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-muted-foreground">订单已过期</p>
          <p className="text-sm text-muted-foreground">请重新发起支付</p>
          <Button className="mt-4" onClick={onReset}>重新充值</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center">
          <div className="p-4 bg-white rounded-lg border">
            {/* 使用 QR 图片 API 渲染微信支付码 */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(codeUrl)}`}
              alt="微信支付二维码"
              width={200}
              height={200}
              className="block"
            />
          </div>
          <div className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>等待扫码支付...</span>
          </div>
          <p className="text-2xl font-bold text-primary mt-2">
            ¥{(amount / 100).toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            剩余时间: {formatTime(timeLeft)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            订单号: {orderNo}
          </p>
          <Button variant="outline" className="mt-4" onClick={onReset}>
            取消支付
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
