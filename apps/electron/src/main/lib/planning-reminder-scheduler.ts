/**
 * 本地任务/日程提醒调度器。
 *
 * 只在 Electron 主进程存活时运行。每条提醒在首次到期及每次推迟重新到期时各通知一次；
 * 未确认的提醒会由渲染进程从 SQLite 恢复为固定通知条。
 */

import { BrowserWindow, Notification } from 'electron'
import { claimDuePlanningReminders } from './planning-manager'
import { getSettings } from './settings-service'
import { broadcastPlanningChanged, broadcastPlanningRemindersDue } from './planning-events'
import type { ActivePlanningReminder } from '@proma/shared'

const POLL_INTERVAL_MS = 30_000
let timer: ReturnType<typeof setInterval> | null = null
let checking = false

/** 原生通知由主进程发送，窗口被隐藏或未聚焦时也不依赖渲染进程的 Web Notification。 */
function showPlanningSystemNotification(reminder: ActivePlanningReminder): void {
  if (!getSettings().notificationsEnabled || !Notification.isSupported()) return

  const notification = new Notification({
    title: reminder.targetType === 'todo' ? 'Todo 提醒' : '日程提醒',
    body: reminder.targetTitle,
    silent: true,
  })
  notification.on('click', () => {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
    if (!window) return
    window.show()
    window.focus()
  })
  notification.show()
}

function checkDueReminders(): void {
  if (checking) return
  checking = true
  try {
    const reminders = claimDuePlanningReminders()
    if (reminders.length > 0) {
      for (const reminder of reminders) showPlanningSystemNotification(reminder)
      broadcastPlanningRemindersDue(reminders)
      broadcastPlanningChanged(['reminders'])
    }
  } catch (error) {
    console.error('[任务/日程] 检查提醒失败:', error)
  } finally {
    checking = false
  }
}

export function startPlanningReminderScheduler(): void {
  if (timer) return
  checkDueReminders()
  timer = setInterval(checkDueReminders, POLL_INTERVAL_MS)
}

export function stopPlanningReminderScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
