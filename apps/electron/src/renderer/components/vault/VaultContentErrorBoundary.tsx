import * as React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface VaultContentErrorBoundaryProps {
  /** 笔记切换或显式重载后自动清除前一篇笔记的错误状态。 */
  resetKey: string
  children: React.ReactNode
}

interface VaultContentErrorBoundaryState {
  hasError: boolean
}

/**
 * 将不受信任 Markdown 的编辑器/预览异常限制在笔记内容区。
 *
 * VaultView 同时用于中心 Obsidian 页面和 Agent 右侧工作区，二者复用
 * 此边界，避免某一篇笔记的渲染异常使整块工作区呈现为空白。
 */
export class VaultContentErrorBoundary extends React.Component<
  VaultContentErrorBoundaryProps,
  VaultContentErrorBoundaryState
> {
  constructor(props: VaultContentErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): VaultContentErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[VaultContentErrorBoundary] 笔记编辑器渲染异常:', error, info.componentStack)
  }

  override componentDidUpdate(previousProps: VaultContentErrorBoundaryProps): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false })
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <AlertTriangle className="size-7 text-destructive/70" />
          <p className="text-[13px]">此笔记的编辑器渲染失败，已保留 Vault 其他内容。</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RotateCw className="size-3.5" />
            重试渲染
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
