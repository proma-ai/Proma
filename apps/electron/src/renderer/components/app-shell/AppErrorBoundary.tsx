import * as React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '../ui/button'
import { WindowControls } from '../WindowControls'

interface AppErrorBoundaryProps {
  children: React.ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

interface AppErrorFallbackProps {
  onRetry: () => void
  onReload: () => void
}

/** 不依赖用户档案、渠道或认证状态，避免恢复页再次触发同一处渲染错误。 */
function AppErrorFallback({ onRetry, onReload }: AppErrorFallbackProps): React.ReactElement {
  return (
    <main className="relative flex min-h-screen w-full items-center justify-center bg-background px-6 py-16 text-foreground">
      <WindowControls />
      <section role="alert" aria-labelledby="app-render-error-title" className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-7" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 id="app-render-error-title" className="text-balance text-lg font-semibold">界面暂时无法显示</h1>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            Proma 遇到了界面错误。可以先重试显示；如果仍然失败，请重新加载窗口。
          </p>
          <p className="text-pretty text-xs leading-5 text-muted-foreground">
            恢复操作不会删除已保存的会话或清除登录凭据；未保存的输入可能丢失。
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" autoFocus className="min-h-10 active:scale-[0.96]" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden="true" />
            重试显示
          </Button>
          <Button type="button" variant="outline" className="min-h-10 active:scale-[0.96]" onClick={onReload}>重新加载窗口</Button>
        </div>
      </section>
    </main>
  )
}

/** 保护整个 App（含引导、认证与侧栏）；全局 IPC 监听器留在边界外持续工作。 */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] 界面渲染异常:', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return <AppErrorFallback onRetry={this.handleRetry} onReload={this.handleReload} />
    }
    return this.props.children
  }
}
