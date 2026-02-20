/**
 * 桌面通知状态管理
 *
 * 管理通知开关状态，提供发送桌面通知的工具函数。
 * 使用 Web Notification API（Electron renderer 原生支持）。
 */

import { atom } from 'jotai'

/** 通知是否启用 */
export const notificationsEnabledAtom = atom<boolean>(true)

/**
 * 从主进程加载通知设置
 */
export async function initializeNotifications(
  setEnabled: (enabled: boolean) => void
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    setEnabled(settings.notificationsEnabled ?? true)
  } catch (error) {
    console.error('[通知] 初始化失败:', error)
  }
}

/**
 * 更新通知开关并持久化
 */
export async function updateNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ notificationsEnabled: enabled })
  } catch (error) {
    console.error('[通知] 更新设置失败:', error)
  }
}

/**
 * 发送桌面通知
 *
 * 仅在窗口未聚焦且通知已启用时发送。
 * 点击通知会聚焦应用窗口。
 */
export function sendDesktopNotification(
  title: string,
  body: string,
  enabled: boolean
): void {
  if (!enabled || document.hasFocus()) return

  const notification = new Notification(title, { body })
  notification.onclick = () => {
    window.focus()
  }
}
