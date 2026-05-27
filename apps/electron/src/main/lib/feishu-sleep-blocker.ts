import { powerSaveBlocker } from 'electron'
import type { AppSettings } from '../../types'
import { FeishuSyncSleepBlocker } from './feishu/sleep-blocker'
import type { SleepBlockerAdapter, SleepBlockerType } from './feishu/sleep-blocker'

const electronSleepBlocker: SleepBlockerAdapter = {
  start: (type: SleepBlockerType): number => powerSaveBlocker.start(type),
  stop: (id: number): void => {
    powerSaveBlocker.stop(id)
  },
  isStarted: (id: number): boolean => powerSaveBlocker.isStarted(id),
}

const blocker = new FeishuSyncSleepBlocker(electronSleepBlocker)

export function syncFeishuSyncSleepBlocker(settings: Pick<AppSettings, 'feishuSessionMirror'>): void {
  try {
    blocker.sync(settings)
  } catch (error) {
    console.error('[飞书防休眠] 同步状态失败:', error)
  }
}

export function stopFeishuSyncSleepBlocker(): void {
  try {
    blocker.stop()
  } catch (error) {
    console.error('[飞书防休眠] 关闭失败:', error)
  }
}
