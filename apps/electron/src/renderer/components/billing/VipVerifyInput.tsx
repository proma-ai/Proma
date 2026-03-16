/**
 * VipVerifyInput - VIP 折扣码验证
 *
 * 验证成功后回调 onVerified 刷新套餐价格
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Loader2, Tag } from 'lucide-react'
import { isVipAtom } from '@/atoms/cloud-billing'

interface VerifyMessage {
  type: 'success' | 'error'
  text: string
}

interface VipVerifyInputProps {
  onVerified?: () => Promise<void>
}

export function VipVerifyInput({ onVerified }: VipVerifyInputProps): React.ReactElement {
  const isVip = useAtomValue(isVipAtom)
  const [apiKey, setApiKey] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<VerifyMessage | null>(null)

  if (isVip) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <Check className="h-4 w-4" />
        <span>已享受 VIP 折扣</span>
      </div>
    )
  }

  const handleVerify = async (): Promise<void> => {
    if (!apiKey.trim()) return

    setLoading(true)
    setMessage(null)

    const result = await window.electronAPI.cloudBilling.verifyVip(apiKey.trim())

    setLoading(false)

    if (result.success && result.data) {
      setMessage({ type: result.data.success ? 'success' : 'error', text: result.data.message })
      if (result.data.success) {
        setApiKey('')
        // 刷新套餐列表以反映折扣价格
        await onVerified?.()
      }
    } else {
      setMessage({ type: 'error', text: result.error || '验证失败' })
    }
  }

  return (
    <div className="rounded-2xl bg-stone-100/50 dark:bg-stone-900/30 backdrop-blur-sm border border-stone-200/40 dark:border-stone-700/30 px-4 py-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-amber-600/70 dark:text-amber-400/70" />
        <span className="text-sm text-stone-600 dark:text-stone-300">优惠码（DeepClaude 用户专享）</span>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="DeepClaude API 消费满 120 美金的用户均可享受 10% Proma 永久折扣"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={loading}
          className="h-9 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleVerify}
          disabled={loading || !apiKey.trim()}
          className="h-9 shrink-0"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '验证'}
        </Button>
      </div>
      {message && (
        <p className={`text-xs ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
