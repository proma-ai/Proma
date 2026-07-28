import { BrowserWindow } from 'electron'
import { PLANNING_IPC_CHANNELS, type ActivePlanningReminder, type PlanningAgentOperation } from '@proma/shared'

/** 广播 Todo 或日程变化，使 UI 与 Pi Agent 工具写入保持同步。 */
export function broadcastPlanningChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PLANNING_IPC_CHANNELS.CHANGED)
  }
}

/**
 * Pi Agent 成功创建、更新或删除 Todo/日程后，通知对应 Agent Session 显示确认 Toast。
 * 与通用 planning:changed 分离，避免用户手动修改日程时收到重复反馈。
 */
export function broadcastPlanningAgentOperation(operation: PlanningAgentOperation): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PLANNING_IPC_CHANNELS.AGENT_OPERATION, operation)
  }
}

/** 到期提醒独立事件。渲染进程据此播放一次声音并刷新固定提醒条。 */
export function broadcastPlanningRemindersDue(reminders: ActivePlanningReminder[]): void {
  if (reminders.length === 0) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PLANNING_IPC_CHANNELS.REMINDER_DUE, reminders)
  }
}
