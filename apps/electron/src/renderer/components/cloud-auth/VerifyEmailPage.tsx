/**
 * 邮箱验证页面
 */

import * as React from 'react'
import { useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cloudAuthViewAtom, cloudAuthEmailAtom } from '@/atoms/cloud-auth'

export function VerifyEmailPage(): React.ReactElement {
  const email = useAtomValue(cloudAuthEmailAtom)
  const setView = useSetAtom(cloudAuthViewAtom)

  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLocalError(null)
    setLoading(true)

    try {
      const result = await window.electronAPI.cloudAuth.verifyEmail({ email, code })
      if (result.success) {
        setSuccessMsg('邮箱验证成功')
        setTimeout(() => setView('login'), 1500)
      } else {
        setLocalError(result.error ?? '验证失败')
      }
    } catch {
      setLocalError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async (): Promise<void> => {
    setResending(true)
    setLocalError(null)

    try {
      const result = await window.electronAPI.cloudAuth.resendCode({ email })
      if (result.success) {
        setSuccessMsg('验证码已重新发送')
        setTimeout(() => setSuccessMsg(null), 3000)
      } else {
        setLocalError(result.error ?? '发送失败')
      }
    } catch {
      setLocalError('网络错误')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Proma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          验证您的邮箱
        </p>
      </div>

      <p className="mb-4 text-center text-sm text-muted-foreground">
        我们已向 <strong>{email}</strong> 发送了 6 位验证码
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">验证码</Label>
          <Input
            id="code"
            type="text"
            placeholder="输入 6 位验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            disabled={loading}
            className="text-center text-lg tracking-widest"
            autoFocus
          />
        </div>

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}
        {successMsg && (
          <p className="text-sm text-green-600">{successMsg}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '验证中...' : '验证'}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Button
          variant="link"
          onClick={handleResend}
          disabled={resending}
          className="text-sm"
        >
          {resending ? '发送中...' : '重新发送验证码'}
        </Button>
      </div>

      <div className="mt-2 text-center">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-primary"
          onClick={() => setView('login')}
        >
          返回登录
        </button>
      </div>
    </div>
  )
}
