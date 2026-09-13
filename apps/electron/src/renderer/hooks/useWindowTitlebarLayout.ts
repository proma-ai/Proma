import * as React from 'react'
import { detectIsMac, detectIsWindows } from '@/lib/platform'
import { getSidebarTitlebarLayout } from '@/lib/window-titlebar-layout'

/** 在绘制前同步标题栏坐标；标题留白与侧栏使用同一目标宽度和 CSS 过渡。 */
export function useWindowTitlebarLayout(
  shellRef: React.RefObject<HTMLDivElement>,
  sidebarOccupiedWidth: number,
): void {
  React.useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const updateLayout = (): void => {
      const layout = getSidebarTitlebarLayout({
        isMac: detectIsMac(),
        isWindows: detectIsWindows(),
        zoomFactor: window.electronAPI.getWindowZoomFactor?.() ?? 1,
        sidebarOccupiedWidth,
      })
      shell.style.setProperty('--sidebar-toggle-left', `${layout.toggleLeft}px`)
      shell.style.setProperty('--sidebar-search-left', `${layout.searchLeft}px`)
      shell.style.setProperty('--sidebar-toggle-top', `${layout.toggleTop}px`)
      shell.style.setProperty('--sidebar-toggle-size', `${28 * layout.toggleScale}px`)
      shell.style.setProperty('--sidebar-toggle-icon-size', `${16 * layout.toggleScale}px`)
      shell.style.setProperty('--titlebar-controls-end', `${layout.controlsEnd}px`)
      shell.style.setProperty('--app-titlebar-height', `${layout.titlebarHeight}px`)
      shell.style.setProperty('--sidebar-top-inset', `${layout.sidebarTopInset}px`)
      shell.style.setProperty('--main-titlebar-leading-inset', `${layout.mainLeadingInset}px`)
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => {
      window.removeEventListener('resize', updateLayout)
    }
  }, [shellRef, sidebarOccupiedWidth])
}
