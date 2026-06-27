/**
 * WindowControls - Windows 自定义窗口控制按钮（最小化/最大化/关闭）
 * 仅 Windows 平台渲染，替换 Electron 原生 titleBarOverlay 按钮。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { detectIsWindows } from '@/lib/platform'
import { interfaceVariantAtom } from '@/atoms/theme'
import { cn } from '@/lib/utils'

export function WindowControls(): React.ReactElement | null {
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'
  const [isMaximized, setIsMaximized] = React.useState(false)

  // 初始化最大化状态并监听窗口 resize 事件
  React.useEffect(() => {
    if (!isWindows) return
    window.electronAPI.windowIsMaximized().then(setIsMaximized)
    const unsub = window.electronAPI.onWindowResize(() => {
      window.electronAPI.windowIsMaximized().then((next) => {
        // 只在状态实际变化时 setState，避免每次 resize 都触发重渲染——
        // Windows 上每次重渲染都会让 Chromium 重算可拖拽区域，期间存在数十 ms 的 stale 窗口，
        // 用户在此窗口内点击按钮会被 OS 误判为标题栏点击。
        setIsMaximized((prev) => (prev === next ? prev : next))
      })
    })
    return unsub
  }, [isWindows])

  if (!isWindows) return null

  return (
    <div className={cn(
      "window-controls fixed z-[100] flex select-none",
      isClassic ? "right-[16px] top-[12px]" : "right-[8px] top-[5px]"
    )}>
      {/* 最小化 */}
      <button
        type="button"
        className="window-control-btn"
        aria-label="最小化"
        onClick={() => window.electronAPI.windowMinimize()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* 最大化/还原 */}
      <button
        type="button"
        className="window-control-btn"
        aria-label={isMaximized ? '还原' : '最大化'}
        onClick={() => window.electronAPI.windowMaximize()}
      >
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="3" y="0.5" width="8" height="8" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="1" y="3.5" width="8" height="8" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>

      {/* 关闭 */}
      <button
        type="button"
        className="window-control-btn window-control-close"
        aria-label="关闭"
        onClick={() => window.electronAPI.windowClose()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
