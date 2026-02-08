/**
 * 忘记密码页面
 */

import * as React from 'react'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cloudAuthViewAtom, cloudAuthEmailAtom } from '@/atoms/cloud-auth'

export function ForgotPasswordPage(): React.ReactElement {
  const setView = useSetAtom(cloudAuthViewAtom)
  const setAuthEmail = useSetAtom(cloudAuthEmailAtom)

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (!email.trim()) {
      setLocalError('请输入邮箱')
      return
    }

    setLoading(true)

    try {
      const result = await window.electronAPI.cloudAuth.forgotPassword({ email })
      if (result.success) {
        setAuthEmail(email)
        setView('reset-password')
      } else {
        setLocalError(result.error ?? '发送失败')
      }
    } catch {
      setLocalError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Proma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          找回您的密码
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            autoFocus
          />
        </div>

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '发送中...' : '发送重置码'}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => setView('login')}
        >
          返回登录
        </button>
      </div>
    </div>
  )
}
