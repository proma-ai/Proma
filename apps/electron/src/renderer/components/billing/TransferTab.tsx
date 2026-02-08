/**
 * TransferTab - 额度迁移标签页
 *
 * 从 DeepClaude 迁移额度到当前 Proma 账户
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowRightLeft, Search, Eye, EyeOff } from 'lucide-react'

interface TransferTabProps {
  onTransferComplete: () => Promise<void>
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '$0.00'
  return `$${value.toFixed(2)}`
}

export function TransferTab({ onTransferComplete }: TransferTabProps): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [querying, setQuerying] = React.useState(false)
  const [transferring, setTransferring] = React.useState(false)
  const [deepClaudeBalance, setDeepClaudeBalance] = React.useState<number | null>(null)
  const [transferAmount, setTransferAmount] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)

  /** 查询 DeepClaude 余额 */
  const handleQueryBalance = async (): Promise<void> => {
    if (!apiKey.trim()) return

    setQuerying(true)
    setDeepClaudeBalance(null)
    setTransferAmount('')
    setError(null)
    setSuccess(null)

    const result = await window.electronAPI.cloudBilling.queryExternalBalance(apiKey.trim())
    setQuerying(false)

    if (result.success && result.data) {
      const flooredCredits = Math.floor(result.data.credits * 100) / 100
      setDeepClaudeBalance(flooredCredits)
    } else {
      setError(result.error || '查询失败')
    }
  }

  /** 迁移额度 */
  const handleTransfer = async (): Promise<void> => {
    const amount = parseFloat(transferAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('请输入有效的转移金额')
      return
    }

    if (deepClaudeBalance !== null && amount > deepClaudeBalance) {
      setError('转移金额不能超过可用余额')
      return
    }

    setTransferring(true)
    setError(null)
    setSuccess(null)

    const result = await window.electronAPI.cloudBilling.transferCredits(apiKey.trim(), amount)
    setTransferring(false)

    if (result.success && result.data) {
      if (result.data.success) {
        setDeepClaudeBalance(result.data.credits ?? null)
        setTransferAmount('')
        setSuccess(result.data.message)
        await onTransferComplete()
      } else {
        setError(result.data.message || '转移失败')
      }
    } else {
      setError(result.error || '转移失败')
    }
  }

  /** 全部转移 */
  const handleTransferAll = (): void => {
    if (deepClaudeBalance !== null && deepClaudeBalance > 0) {
      setTransferAmount(deepClaudeBalance.toString())
    }
  }

  const remainingAfterTransfer =
    deepClaudeBalance !== null && transferAmount
      ? Math.floor(Math.max(0, deepClaudeBalance - (parseFloat(transferAmount) || 0)) * 100) / 100
      : null

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        输入您的 DeepClaude API Key，将额度转移到当前账户
      </p>

      {/* API Key 输入 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Input
            type={showApiKey ? 'text' : 'password'}
            placeholder="输入 DeepClaude API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button onClick={handleQueryBalance} disabled={querying || !apiKey.trim()}>
          {querying ? (
            <Loader2 className="size-4 animate-spin mr-2" />
          ) : (
            <Search className="size-4 mr-2" />
          )}
          查询余额
        </Button>
      </div>

      {/* 查询成功后显示转移选项 */}
      {deepClaudeBalance !== null && (
        <div className="space-y-4 pt-2">
          <div className="grid gap-3 grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground mb-1">DeepClaude 当前余额</p>
              <p className="text-lg font-semibold">{formatCurrency(deepClaudeBalance)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground mb-1">转移金额</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  min="0"
                  max={deepClaudeBalance}
                  step="0.01"
                  className="text-lg font-semibold h-auto py-1"
                />
                <Button variant="outline" size="sm" onClick={handleTransferAll} className="shrink-0">
                  全部
                </Button>
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-xs text-muted-foreground mb-1">转移后 DeepClaude 剩余</p>
              <p className="text-lg font-semibold">
                {remainingAfterTransfer !== null ? formatCurrency(remainingAfterTransfer) : '-'}
              </p>
            </div>
          </div>

          <Button
            onClick={handleTransfer}
            disabled={transferring || !transferAmount || parseFloat(transferAmount) <= 0}
            className="w-full"
          >
            {transferring ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <ArrowRightLeft className="size-4 mr-2" />
            )}
            确认转移
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
    </div>
  )
}
