/**
 * ManagedBrowserWindowApp — 受管浏览器独立窗口。
 *
 * 通过 URL query 中的 sessionId 绑定某个 Agent 会话的受管浏览器；
 * 复用 BrowserPanel（含 BrowserSlot 全窗口布局上报），工具栏自带「收起回主窗口」。
 * 窗口本身只是展示容器，页面与 CDP 全部留在主进程。
 */

import * as React from 'react'
import { AlertCircle, Globe2 } from 'lucide-react'
import type { BrowserViewState, BrowserStateChange } from '@proma/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowControls } from '@/components/WindowControls'
import { WINDOW_CONTROLS_INSET_RIGHT, WINDOW_CONTROLS_PADDING_RIGHT, detectIsMac, detectIsWindows } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { BrowserPanel } from './BrowserPanel'

function getSessionId(): string {
  return new URLSearchParams(window.location.search).get('sessionId') ?? ''
}

export function ManagedBrowserWindowApp(): React.ReactElement {
  const sessionId = React.useMemo(getSessionId, [])
  const [state, setState] = React.useState<BrowserViewState | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!sessionId) {
      setFailed(true)
      return
    }
    let cancelled = false
    const failAndClose = () => {
      if (cancelled) return
      setFailed(true)
      // 会话已不存在：短暂展示提示后自动关闭，避免孤儿窗口。
      window.setTimeout(() => { if (!cancelled) window.close() }, 1500)
    }
    void window.electronAPI
      .getAgentBrowserState(sessionId)
      .then((current) => {
        if (!cancelled) {
          if (!current) failAndClose()
          else setState(current)
        }
      })
      .catch(failAndClose)
    const unsubscribe = window.electronAPI.onAgentBrowserStateChanged((change: BrowserStateChange) => {
      if ('closed' in change) {
        if (change.sessionId === sessionId && change.closed) {
          cancelled = true
          window.close()
        }
        return
      }
      if (change.sessionId !== sessionId) return
      setState(change)
      document.title = `受管浏览器 – ${change.title || '新建标签页'}`
    })
    return () => { cancelled = true; unsubscribe() }
  }, [sessionId])

  if (!sessionId || failed) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-8 text-center">
        <div className="max-w-sm space-y-2 text-muted-foreground">
          <AlertCircle className="mx-auto size-8 text-destructive/80" />
          <p className="text-sm font-medium text-foreground">受管浏览器会话不可用</p>
          <p className="text-xs leading-5">该 Agent 会话已关闭或浏览器已被销毁，独立窗口即将自动关闭。</p>
        </div>
      </div>
    )
  }

  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const isMac = React.useMemo(() => detectIsMac(), [])
  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-content-area antialiased">
        {/* 与主程序一致的自定义标题栏：系统按钮融入窗口内容区。 */}
        <WindowControls />
        <header className={cn(
          'relative flex h-11 shrink-0 items-center border-b border-border/70',
          isMac ? 'pl-[88px] pr-5' : isWindows ? `pl-4 ${WINDOW_CONTROLS_PADDING_RIGHT}` : 'px-4',
        )}>
          {/* 拖拽层：Windows 上让出右上角按钮区域，避免 drag hitmask 与 WindowControls 重叠。 */}
          <div aria-hidden="true" className={cn('titlebar-drag-region pointer-events-none absolute inset-y-0 left-0', isWindows ? WINDOW_CONTROLS_INSET_RIGHT : 'right-0')} />
          <Globe2 className="mr-2 size-4 shrink-0 text-primary" />
          <h1 className="truncate text-xs font-medium text-foreground">
            受管浏览器{state?.title ? ` – ${state.title}` : ''}
          </h1>
        </header>
        <div className="min-h-0 flex-1">
          <BrowserPanel
            sessionId={sessionId}
            state={state}
            onMinimize={() => {}}
            onClose={() => window.close()}
            inDetachedWindow
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
