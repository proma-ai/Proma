import { powerSaveBlocker } from 'electron'
import type { AppSettings } from '../../types'
import { IdleModeManager, type SleepBlockerAdapter, type SleepBlockerType } from './idle-mode'

/**
 * 挂机模式（息屏 + 防休眠）— electron 接线层
 *
 * 核心逻辑见 idle-mode.ts；此处负责把 powerSaveBlocker 注入为
 * SleepBlockerAdapter，并导出供主进程使用的 sync/stop 入口。
 */

const electronSleepBlocker: SleepBlockerAdapter = {
  start: (type: SleepBlockerType): number => powerSaveBlocker.start(type),
  stop: (id: number): void => {
    powerSaveBlocker.stop(id)
  },
  isStarted: (id: number): boolean => powerSaveBlocker.isStarted(id),
}

const manager = new IdleModeManager(electronSleepBlocker)

export function syncIdleMode(settings: Pick<AppSettings, 'idleMode'>): void {
  try {
    manager.sync(settings)
  } catch (error) {
    console.error('[挂机模式] 同步状态失败:', error)
  }
}

export function stopIdleMode(): void {
  try {
    manager.stop()
  } catch (error) {
    console.error('[挂机模式] 关闭失败:', error)
  }
}
