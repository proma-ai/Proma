/**
 * 登录页面
 *
 * Cloud 模式下未认证时显示的登录表单
 */

import * as React from 'react'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cloudAuthViewAtom, cloudAuthErrorAtom } from '@/atoms/cloud-auth'

export function LoginPage(): React.ReactElement {
  const setView = useSetAtom(cloudAuthViewAtom)
  const setError = useSetAtom(cloudAuthErrorAtom)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLocalError(null)
    setError(null)

    if (!email.trim() || !password.trim()) {
      setLocalError('请填写邮箱和密码')
      return
    }

    setLoading(true)

    try {
      const result = await window.electronAPI.cloudAuth.login({ email, password })

      if (!result.success) {
        setLocalError(result.error ?? '登录失败')
      }
      // 成功时 auth state change 会通过 broadcast 自动更新 atom
    } catch {
      setLocalError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">登录 Proma</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            登录以使用 Cloud 模式
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

          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {localError && (
            <p className="text-sm text-destructive">{localError}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          没有账号？{' '}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => setView('register')}
          >
            注册
          </button>
        </div>
      </div>
    </div>
  )
}
