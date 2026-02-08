/**
 * 账号待审核页面
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { cloudAuthViewAtom } from '@/atoms/cloud-auth'

export function PendingPage(): React.ReactElement {
  const setView = useSetAtom(cloudAuthViewAtom)

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-lg">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <svg className="h-8 w-8 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Proma</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          账号待审核
        </p>
      </div>

      <p className="mb-6 text-center text-muted-foreground">
        您的账号正在等待管理员审核，请耐心等待。
        <br />
        审核通过后，您将可以正常使用所有功能。
      </p>

      <Button className="w-full" onClick={() => setView('login')}>
        返回登录
      </Button>
    </div>
  )
}
