/**
 * Dock / Taskbar 角标服务
 *
 * 将渲染进程推导出的待处理数量同步到系统级应用角标。
 * - macOS: app.setBadgeCount（Dock 红圈数字）
 * - Linux: app.setBadgeCount（Unity Launcher）
 * - Windows: BrowserWindow.setOverlayIcon（任务栏叠加图标）
 */

import { app, nativeImage } from 'electron'
import { getMainWindow } from '../index'

function createBadgeOverlay(count: number) {
  const label = count > 99 ? '99+' : String(count)
  const fontSize = label.length > 2 ? 8 : label.length > 1 ? 10 : 12

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
  <circle cx="8" cy="8" r="8" fill="#E5534B"/>
  <text x="8" y="12" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${label}</text>
</svg>`

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  )
}

/**
 * 设置应用角标数量。传入 0 会清除角标。
 */
export function setDockBadgeCount(count: number): boolean {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0

  if (process.platform === 'darwin' || process.platform === 'linux') {
    return app.setBadgeCount(normalizedCount)
  }

  if (process.platform === 'win32') {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return false

    if (normalizedCount === 0) {
      win.setOverlayIcon(null, '')
    } else {
      try {
        const overlay = createBadgeOverlay(normalizedCount)
        win.setOverlayIcon(overlay, `${normalizedCount} 条待处理`)
      } catch {
        win.setOverlayIcon(null, '')
        return false
      }
    }
    return true
  }

  return false
}
