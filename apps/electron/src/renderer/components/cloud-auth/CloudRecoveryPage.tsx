/** Cloud 暂时不可达时的可恢复认证状态。 */
import * as React from 'react'
import { LoaderCircle, LogIn, RefreshCw } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { cloudAuthViewAtom } from '@/atoms/cloud-auth'

export function CloudRecoveryPage(): React.ReactElement {
  const setView = useSetAtom(cloudAuthViewAtom)
  const [retrying, setRetrying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const retryRecovery = async (): Promise<void> => {
    setRetrying(true)
    setError(null)
    try {
      const result = await window.electronAPI.cloudAuth.getMe()
      if (!result.success) setError(result.error ?? '暂时无法恢复登录状态，请稍后重试。')
    } catch {
      setError('暂时无法恢复登录状态，请检查网络后重试。')
    } finally {
      setRetrying(false)
    }
  }

  const restartLogin = async (): Promise<void> => {
    setError(null)
    try {
      await window.electronAPI.cloudAuth.logout()
      setView('login')
    } catch {
      setError('无法清除当前登录状态，请重启 Proma 后重试。')
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-lg">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">正在恢复登录状态</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Proma Cloud 暂时不可达，已保留本机登录凭据。网络恢复后可继续使用原账号，无需重新输入密码。
      </p>
      {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button className="flex-1" onClick={() => void retryRecovery()} disabled={retrying}>
          <RefreshCw className={`mr-2 size-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
          {retrying ? '正在重试…' : '重试恢复'}
        </Button>
        <Button className="flex-1" variant="outline" onClick={() => void restartLogin()} disabled={retrying}>
          <LogIn className="mr-2 size-4" aria-hidden="true" />
          重新登录
        </Button>
      </div>
    </div>
  )
}
