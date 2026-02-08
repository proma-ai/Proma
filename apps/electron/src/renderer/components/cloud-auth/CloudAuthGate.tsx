/**
 * Cloud 认证门控组件
 *
 * 根据认证状态决定显示内容：
 * - local 模式 → 直接渲染子组件
 * - cloud + 加载中 → 加载动画
 * - cloud + 未认证 → 登录/注册/验证/重置等页面
 * - cloud + 已认证 → 渲染子组件
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { isCloudMode } from '@/lib/mode'
import {
  cloudUserAtom,
  cloudAuthLoadingAtom,
  cloudAuthViewAtom,
} from '@/atoms/cloud-auth'
import type { CloudAuthView } from '@/atoms/cloud-auth'
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'
import { VerifyEmailPage } from './VerifyEmailPage'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { PendingPage } from './PendingPage'

interface CloudAuthGateProps {
  children: React.ReactNode
}

export function CloudAuthGate({ children }: CloudAuthGateProps): React.ReactElement {
  // local 模式直接放行
  if (!isCloudMode()) {
    return <>{children}</>
  }

  return <CloudAuthGuard>{children}</CloudAuthGuard>
}

/** 视图映射 */
const AUTH_VIEWS: Record<CloudAuthView, React.ComponentType> = {
  'login': LoginPage,
  'register': RegisterPage,
  'verify-email': VerifyEmailPage,
  'forgot-password': ForgotPasswordPage,
  'reset-password': ResetPasswordPage,
  'pending': PendingPage,
}

/** 内部组件：仅在 cloud 模式下渲染，避免 local 模式订阅不必要的 atoms */
function CloudAuthGuard({ children }: CloudAuthGateProps): React.ReactElement {
  const user = useAtomValue(cloudUserAtom)
  const loading = useAtomValue(cloudAuthLoadingAtom)
  const view = useAtomValue(cloudAuthViewAtom)

  // 加载中
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">正在验证登录状态...</p>
        </div>
      </div>
    )
  }

  // 未认证 → 显示对应认证页面
  if (!user) {
    const AuthPage = AUTH_VIEWS[view] || LoginPage
    return (
      <div className="flex min-h-full flex-col bg-background">
        {/* Electron 窗口拖动区域 */}
        <div className="h-8 app-drag-region shrink-0" />
        <div className="flex flex-1 items-center justify-center px-4">
          <AuthPage />
        </div>
      </div>
    )
  }

  // 已认证 → 渲染子组件
  return <>{children}</>
}
