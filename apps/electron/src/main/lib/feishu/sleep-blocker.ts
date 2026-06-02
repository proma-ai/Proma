import type { AppSettings } from '../../../types'

export type SleepBlockerType = 'prevent-app-suspension'

export interface SleepBlockerAdapter {
  start(type: SleepBlockerType): number
  stop(id: number): void
  isStarted(id: number): boolean
}

export function shouldPreventSleepForFeishuSync(
  settings: Pick<AppSettings, 'feishuSessionMirror'>,
): boolean {
  return settings.feishuSessionMirror?.mode === 'stream'
}

export class FeishuSyncSleepBlocker {
  private activeBlockerId: number | null = null

  constructor(private readonly adapter: SleepBlockerAdapter) {}

  sync(settings: Pick<AppSettings, 'feishuSessionMirror'>): void {
    if (shouldPreventSleepForFeishuSync(settings)) {
      this.start()
      return
    }

    this.stop()
  }

  stop(): void {
    if (this.activeBlockerId === null) return

    const blockerId = this.activeBlockerId
    this.activeBlockerId = null

    if (this.adapter.isStarted(blockerId)) {
      this.adapter.stop(blockerId)
      console.log('[飞书防休眠] 已关闭')
    }
  }

  private start(): void {
    if (this.activeBlockerId !== null) {
      if (this.adapter.isStarted(this.activeBlockerId)) return
      this.activeBlockerId = null
    }

    this.activeBlockerId = this.adapter.start('prevent-app-suspension')
    console.log('[飞书防休眠] 已启用，飞书实时同步期间阻止系统休眠（允许息屏锁屏）')
  }
}
