/**
 * 注册页面
 *
 * Cloud 模式下切换到注册时显示的注册表单，支持 Google OAuth
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from './PasswordInput'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LegalAgreement } from './LegalAgreement'
import {
  canSubmitWithLegalAcceptance,
  GOOGLE_OAUTH_LEGAL_ACCEPTANCE_HINT,
} from './legal-agreement'
import {
  cloudAuthViewAtom,
  cloudAuthEmailAtom,
} from '@/atoms/cloud-auth'

/** Google 图标 SVG */
function GoogleIcon(): React.ReactElement {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

/** 密码验证：8-20位，必须包含大小写字母和数字 */
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,20}$/

export function RegisterPage(): React.ReactElement {
  const setView = useSetAtom(cloudAuthViewAtom)
  const setAuthEmail = useSetAtom(cloudAuthEmailAtom)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [googleConfigured, setGoogleConfigured] = useState(false)
  const requiresLegalAcceptance = !canSubmitWithLegalAcceptance(legalAccepted)
  const googleLoginDisabled = loading || requiresLegalAcceptance

  useEffect(() => {
    window.electronAPI.cloudAuth.getGoogleOAuthStatus()
      .then((status) => setGoogleConfigured(status.configured))
      .catch(() => setGoogleConfigured(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setLocalError(null)

    if (!name.trim() || !email.trim() || !password.trim()) {
      setLocalError('请填写所有字段')
      return
    }

    if (password !== confirmPassword) {
      setLocalError('两次输入的密码不一致')
      return
    }

    if (!PASSWORD_PATTERN.test(password)) {
      setLocalError('密码必须为 8-20 位，包含大小写字母和数字')
      return
    }

    if (!canSubmitWithLegalAcceptance(legalAccepted)) {
      setLocalError('请先阅读并同意《用户协议》和《隐私政策》')
      return
    }

    setLoading(true)

    try {
      const result = await window.electronAPI.cloudAuth.register({
        email,
        password,
        name,
      })

      if (!result.success) {
        setLocalError(result.error ?? '注册失败')
      } else {
        // 注册成功后跳转到邮箱验证
        setAuthEmail(email)
        setView('verify-email')
      }
    } catch {
      setLocalError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async (): Promise<void> => {
    if (!canSubmitWithLegalAcceptance(legalAccepted)) {
      setLocalError('请先阅读并同意《用户协议》和《隐私政策》')
      return
    }

    await window.electronAPI.cloudAuth.openGoogleLogin()
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Proma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          创建您的账号
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">名称</Label>
          <Input
            id="name"
            type="text"
            placeholder="您的名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
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
          <Label htmlFor="confirmPassword">确认密码</Label>
          <PasswordInput
            id="confirmPassword"
            placeholder="再次输入密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <LegalAgreement
          accepted={legalAccepted}
          onAcceptedChange={setLegalAccepted}
          disabled={loading}
        />

        {localError && (
          <p className="text-sm text-destructive">{localError}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '注册中...' : '注册'}
        </Button>
      </form>

      {googleConfigured && (
        <>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">或</span>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={googleLoginDisabled ? 'block w-full cursor-not-allowed' : 'block w-full'}
                tabIndex={requiresLegalAcceptance && !loading ? 0 : undefined}
                aria-label={requiresLegalAcceptance && !loading ? GOOGLE_OAUTH_LEGAL_ACCEPTANCE_HINT : undefined}
              >
                <Button
                  type="button"
                  variant="outline"
                  className={googleLoginDisabled ? 'pointer-events-none w-full' : 'w-full'}
                  onClick={() => { void handleGoogleLogin() }}
                  disabled={googleLoginDisabled}
                >
                  <GoogleIcon />
                  使用 Google 注册
                </Button>
              </span>
            </TooltipTrigger>
            {requiresLegalAcceptance && !loading && (
              <TooltipContent side="bottom" className="max-w-xs text-center leading-relaxed">
                {GOOGLE_OAUTH_LEGAL_ACCEPTANCE_HINT}
              </TooltipContent>
            )}
          </Tooltip>
        </>
      )}

      <div className="mt-6 text-center text-sm text-muted-foreground">
        已有账号？{' '}
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => setView('login')}
        >
          立即登录
        </button>
      </div>
    </div>
  )
}
