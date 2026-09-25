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
  cloudAuthRecoveryPendingAtom,
  cloudAuthViewAtom,
} from '@/atoms/cloud-auth'
import { agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import type { CloudAuthView } from '@/atoms/cloud-auth'
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'
import { VerifyEmailPage } from './VerifyEmailPage'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { PendingPage } from './PendingPage'
import { CloudRecoveryPage } from './CloudRecoveryPage'
import { AuthSplitLayout } from './AuthSplitLayout'
import { WindowControls } from '@/components/WindowControls'
import { detectIsWindows } from '@/lib/platform'
import { getWindowTitlebarDragInsetStyle } from '@/lib/window-titlebar-layout'

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

/** 在认证门控与 Onboarding 终页中复用同一组认证业务视图。 */
export function CloudAuthScreen(): React.ReactElement {
  const view = useAtomValue(cloudAuthViewAtom)
  const AuthPage = AUTH_VIEWS[view] || LoginPage
  return <AuthPage />
}

/** 内部组件：仅在 cloud 模式下渲染，避免 local 模式订阅不必要的 atoms */
function CloudAuthGuard({ children }: CloudAuthGateProps): React.ReactElement {
  const user = useAtomValue(cloudUserAtom)
  const loading = useAtomValue(cloudAuthLoadingAtom)
  const recoveryPending = useAtomValue(cloudAuthRecoveryPendingAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  // 加载中
  if (loading || (user && !agentSettingsReady)) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{loading ? '正在验证登录状态...' : '正在准备工作空间...'}</p>
        </div>
      </div>
    )
  }

  // 旧认证文件没有 userSnapshot 时，临时网络错误不应直接误导为登录失效。
  if (!user && recoveryPending) {
    return (
      <div className="relative min-h-full">
        <div className="app-drag-region absolute left-0 top-0 z-10 h-8" style={getWindowTitlebarDragInsetStyle(isWindows)} />
        <WindowControls />
        <AuthSplitLayout><CloudRecoveryPage /></AuthSplitLayout>
      </div>
    )
  }

  // 未认证 → 显示对应认证页面
  if (!user) {
    return (
      <div className="relative min-h-full">
        {/* Windows 上避开原生窗口控制区，防止点击被 OS 判作标题栏拖拽。 */}
        <div className="app-drag-region absolute left-0 top-0 z-10 h-8" style={getWindowTitlebarDragInsetStyle(isWindows)} />
        <WindowControls />
        <AuthSplitLayout>
          <CloudAuthScreen />
        </AuthSplitLayout>
      </div>
    )
  }

  // 已认证 → 渲染子组件
  return <>{children}</>
}
