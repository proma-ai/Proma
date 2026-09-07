/**
 * 重置密码页面
 */

import * as React from 'react'
import { useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from './PasswordInput'
import { cloudAuthViewAtom, cloudAuthEmailAtom } from '@/atoms/cloud-auth'

/** 密码验证：8-20位，必须包含大小写字母和数字 */
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,20}$/

export function ResetPasswordPage(): React.ReactElement {
  const email = useAtomValue(cloudAuthEmailAtom)
  const setView = useSetAtom(cloudAuthViewAtom)

  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (password !== confirmPassword) {
      setLocalError('两次输入的密码不一致')
      return
    }

    if (!PASSWORD_PATTERN.test(password)) {
      setLocalError('密码必须为 8-20 位，包含大小写字母和数字')
      return
    }

    setLoading(true)

    try {
      const result = await window.electronAPI.cloudAuth.resetPassword({
        email,
        code,
        password,
      })
      if (result.success) {
        setView('login')
      } else {
        setLocalError(result.error ?? '重置失败')
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
          重置您的密码
        </p>
      </div>

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

        <div className="space-y-2">
          <Label htmlFor="password">新密码</Label>
          <PasswordInput
            id="password"
            placeholder="8-20位，含大小写字母和数字"
            maxLength={20}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">确认新密码</Label>
          <PasswordInput
            id="confirmPassword"
            placeholder="再次输入密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '重置中...' : '重置密码'}
        </Button>
      </form>
    </div>
  )
}
