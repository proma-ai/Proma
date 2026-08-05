import { app, Menu } from 'electron'
import { getPlanningTaskArguments } from './planning-quick-entry-model'

interface PlanningQuickEntryActions {
  showMainWindow: () => void
  showPlanningWindow: () => void
}

/**
 * 配置操作系统原生入口。两个平台均复用主进程的单例规划窗口，避免产生第二份数据或运行时。
 */
export function configurePlanningQuickEntries(actions: PlanningQuickEntryActions): void {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: '打开任务/日程', click: actions.showPlanningWindow },
      { type: 'separator' },
      { label: '打开 Proma', click: actions.showMainWindow },
    ]))
  }

  if (process.platform === 'win32') {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: getPlanningTaskArguments(process.defaultApp === true, app.getAppPath()),
        iconPath: process.execPath,
        iconIndex: 0,
        title: '任务/日程',
        description: '打开 Proma 的任务、日程与定时任务中心',
      },
    ])
  }
}
