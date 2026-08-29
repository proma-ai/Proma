import * as React from 'react'
import { detectIsWindows } from '@/lib/platform'
import {
  getWindowTitlebarDragInsetStyle,
  WINDOW_TITLEBAR_CONTROL_WIDTH_PX,
  WINDOW_TITLEBAR_CONTROLS_WIDTH_PX,
  WINDOW_TITLEBAR_HEIGHT_PX,
} from '@/lib/window-titlebar-layout'

export function WindowControls(): React.ReactElement | null {
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const [isMaximized, setIsMaximized] = React.useState(false)

  React.useEffect(() => {
    if (!isWindows) return
    window.electronAPI.windowIsMaximized().then(setIsMaximized)
    const unsub = window.electronAPI.onWindowResize(() => {
      window.electronAPI.windowIsMaximized().then((next) => {
        setIsMaximized((prev) => (prev === next ? prev : next))
      })
    })
    return unsub
  }, [isWindows])

  if (!isWindows) return null

  return (
    <div
      className="window-titlebar fixed inset-x-0 top-0 z-[100] flex select-none"
      style={{
        height: WINDOW_TITLEBAR_HEIGHT_PX,
        '--window-titlebar-controls-width': `${WINDOW_TITLEBAR_CONTROLS_WIDTH_PX}px`,
      } as React.CSSProperties}
    >
      <div
        aria-hidden="true"
        className="titlebar-drag-region pointer-events-none absolute inset-y-0 left-0"
        style={getWindowTitlebarDragInsetStyle(isWindows)}
      />
      <div
        className="window-controls relative ml-auto flex"
        style={{ width: WINDOW_TITLEBAR_CONTROLS_WIDTH_PX }}
      >
        <button
          type="button"
          className="window-control-btn"
          style={{ width: WINDOW_TITLEBAR_CONTROL_WIDTH_PX }}
          aria-label="最小化"
          onClick={() => window.electronAPI.windowMinimize()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className="window-control-btn"
          style={{ width: WINDOW_TITLEBAR_CONTROL_WIDTH_PX }}
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

        <button
          type="button"
          className="window-control-btn window-control-close"
          style={{ width: WINDOW_TITLEBAR_CONTROL_WIDTH_PX }}
          aria-label="关闭"
          onClick={() => window.electronAPI.windowClose()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
