import { powerSaveBlocker } from 'electron'
import type { AppSettings } from '../../types'
import { TaskSleepGuard, type SleepBlockerAdapter, type SleepBlockerType } from './task-sleep-guard'

/**
 * 任务防休眠 — electron 接线层
 *
 * 核心逻辑见 task-sleep-guard.ts；此处注入 powerSaveBlocker，
 * 并导出主进程使用的单例与 sync/stop 入口。
 */

const electronSleepBlocker: SleepBlockerAdapter = {
  start: (type: SleepBlockerType): number => powerSaveBlocker.start(type),
  stop: (id: number): void => {
    powerSaveBlocker.stop(id)
  },
  isStarted: (id: number): boolean => powerSaveBlocker.isStarted(id),
}

export const taskSleepGuard = new TaskSleepGuard(electronSleepBlocker)

export function syncTaskSleepGuard(settings: Pick<AppSettings, 'taskSleepGuard'>): void {
  try {
    taskSleepGuard.syncSettings(settings)
  } catch (error) {
    console.error('[任务防休眠] 同步设置失败:', error)
  }
}

export function stopTaskSleepGuard(): void {
  try {
    taskSleepGuard.stop()
  } catch (error) {
    console.error('[任务防休眠] 停止失败:', error)
  }
}
