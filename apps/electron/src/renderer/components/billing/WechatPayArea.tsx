/**
 * WechatPayArea - 微信支付区域
 *
 * 展示微信二维码 + 倒计时 + 轮询订单状态
 * Electron 桌面端使用 QR 图片 URL（来自 code_url）
 */

import * as React from 'react'
import QRCode from 'qrcode'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, Clock, Loader2, Copy, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { copyTextToClipboard } from '@/lib/clipboard'
import { PurchaseConfetti } from './PurchaseConfetti'
import { PROMA_CONTACT_WECHAT_ID } from './TeamPromoBanner'
import wechatErlichQr from '@/assets/billing/wechat-erlich.jpg'

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
  const [timeLeft, setTimeLeft] = React.useState<number>(() =>
    Math.max(0, Math.floor((new Date(expireAt).getTime() - Date.now()) / 1000))
  )
  const [qrCodeData, setQrCodeData] = React.useState<string | null>(null)
  const [qrCodeError, setQrCodeError] = React.useState(false)
  const pollIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // 在客户端本地生成二维码，避免依赖外部图片服务。
  React.useEffect(() => {
    let cancelled = false
    setQrCodeData(null)
    setQrCodeError(false)

    void QRCode.toDataURL(codeUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl: string) => {
        if (!cancelled) setQrCodeData(dataUrl)
      })
      .catch((error: unknown) => {
        console.error('[微信支付] 本地生成二维码失败:', error)
        if (!cancelled) setQrCodeError(true)
      })

    return () => { cancelled = true }
  }, [codeUrl])

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

  const copyServiceWechat = async (): Promise<void> => {
    try {
      await copyTextToClipboard(PROMA_CONTACT_WECHAT_ID)
      toast.success('微信号已复制', { description: '在微信中搜索并添加，即可联系 Proma 团队' })
    } catch {
      toast.message(`请手动复制微信号：${PROMA_CONTACT_WECHAT_ID}`)
    }
  }

  if (status === 'success') {
    return (
      <>
        <PurchaseConfetti />
        <Card className="border-emerald-200/70 bg-gradient-to-b from-emerald-50/80 to-background shadow-sm dark:border-emerald-900/50 dark:from-emerald-950/30">
          <CardContent className="px-5 py-8 sm:px-8">
            <div className="text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100/80 dark:bg-emerald-900/50">
                <CheckCircle2 className="size-9 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-foreground [text-wrap:balance]">支付成功，欢迎加入 Proma</h3>
              <p className="mt-2 text-sm text-muted-foreground">订阅已生效，额度已到账。现在可以继续使用了。</p>
            </div>

            <div className="mx-auto mt-7 max-w-md rounded-2xl bg-background/90 p-5 shadow-sm ring-1 ring-foreground/5 dark:bg-background/60">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100/70 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                  <MessageCircle size={19} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">有问题？我们在微信上继续聊</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
                    添加 Proma 团队微信，可获取使用支持，也可申请加入付费用户群，与其他用户交流。
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-col items-center gap-2">
                <img
                  src={wechatErlichQr}
                  alt="ErlichLiu 的微信二维码，打开微信扫一扫即可添加"
                  width={684}
                  height={878}
                  className="block h-auto w-44 rounded-lg bg-white p-1 shadow-sm ring-1 ring-black/10 dark:ring-white/10 sm:w-48"
                />
                <p className="text-xs text-muted-foreground">打开微信扫一扫，添加 ErlichLiu</p>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">微信号 <span className="ml-1 font-mono font-medium text-foreground select-all">{PROMA_CONTACT_WECHAT_ID}</span></span>
                <Button variant="outline" size="sm" className="min-h-10 gap-1.5 active:scale-[0.96] transition-transform" onClick={copyServiceWechat}>
                  <Copy size={14} aria-hidden="true" />复制微信号
                </Button>
              </div>
            </div>

            <div className="mt-6 text-center">
              <Button variant="outline" className="min-h-10 active:scale-[0.96] transition-transform" onClick={onReset}>查看订阅与额度</Button>
            </div>
          </CardContent>
        </Card>
      </>
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
          <div className="flex h-[234px] w-[234px] items-center justify-center rounded-lg border bg-white p-4">
            {qrCodeData ? (
              <img
                src={qrCodeData}
                alt="微信支付二维码"
                width={200}
                height={200}
                className="block"
              />
            ) : qrCodeError ? (
              <p className="text-center text-sm text-destructive">二维码生成失败，请重新发起支付</p>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="正在生成二维码" />
            )}
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
