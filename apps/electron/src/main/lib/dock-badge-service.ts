/**
 * Dock 角标服务
 *
 * 将渲染进程推导出的待处理数量同步到系统级应用角标。
 */

import { app } from 'electron'

/**
 * 设置应用 Dock/Launcher 角标数量。
 *
 * macOS 会显示在 Dock 图标上；Linux 仅 Unity Launcher 支持。
 * 传入 0 会清除角标。
 */
export function setDockBadgeCount(count: number): boolean {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return false
  }

  return app.setBadgeCount(normalizedCount)
}
