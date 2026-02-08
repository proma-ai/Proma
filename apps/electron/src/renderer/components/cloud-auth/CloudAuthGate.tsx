/**
 * Cloud 认证门控组件
 *
 * 根据认证状态决定显示内容：
 * - local 模式 → 直接渲染子组件
 * - cloud + 加载中 → 加载动画
 * - cloud + 未认证 → 登录/注册页
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
import { LoginPage } from './LoginPage'
import { RegisterPage } from './RegisterPage'

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

  // 未认证 → 显示登录/注册页
  if (!user) {
    return view === 'register' ? <RegisterPage /> : <LoginPage />
  }

  // 已认证 → 渲染子组件
  return <>{children}</>
}
