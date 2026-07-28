import { BrowserWindow } from 'electron'
import { PLANNING_IPC_CHANNELS, type ActivePlanningReminder, type PlanningAgentOperation, type PlanningChange, type PlanningChangeResource } from '@proma/shared'

const ALL_PLANNING_CHANGE_RESOURCES: PlanningChangeResource[] = ['todos', 'calendar_events', 'todo_groups', 'calendar_groups', 'tags', 'reminders']

/** 广播资源级失效通知，使各窗口只刷新受影响的规划数据。 */
export function broadcastPlanningChanged(resources: PlanningChangeResource[] = ALL_PLANNING_CHANGE_RESOURCES): void {
  const change: PlanningChange = { resources: [...new Set(resources)] }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PLANNING_IPC_CHANNELS.CHANGED, change)
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
