import type { AppSettings } from '../../types'

/**
 * 任务防休眠（Task Sleep Guard）核心逻辑
 *
 * 需求：只要 Proma 有任务在跑（Agent run / 自动化任务 / 飞书桥接任务），
 * 无论用户锁屏、息屏还是合上笔记本盖，系统都不应休眠中断任务；
 * 任务全部结束后恢复系统默认电源策略。设置默认开启。
 *
 * 实现：token 集合跟踪活跃任务 —— 每个正在运行的任务持有一个 token，
 * 第一个任务开始时启动 powerSaveBlocker('prevent-app-suspension')，
 * 最后一个任务结束时释放。与手动「挂机模式」（idle-mode）相互独立。
 *
 * 本文件保持纯逻辑、不依赖 electron，便于单元测试；
 * electron 接线见 task-sleep-guard-electron.ts。
 */

export type SleepBlockerType = 'prevent-app-suspension'

export interface SleepBlockerAdapter {
  start(type: SleepBlockerType): number
  stop(id: number): void
  isStarted(id: number): boolean
}

/** 默认开启：未配置或 enabled 非 false 都视为开启（用户要求默认开启） */
export function shouldEnableTaskSleepGuard(settings: Pick<AppSettings, 'taskSleepGuard'>): boolean {
  return settings.taskSleepGuard?.enabled !== false
}

export class TaskSleepGuard {
  private activeBlockerId: number | null = null
  private enabled = true
  private activeTokens = new Set<object>()

  constructor(private readonly adapter: SleepBlockerAdapter) {}

  /** 设置变更时同步：关闭时立即释放 blocker；重新开启时若有任务在跑则恢复防休眠 */
  syncSettings(settings: Pick<AppSettings, 'taskSleepGuard'>): void {
    this.enabled = shouldEnableTaskSleepGuard(settings)
    if (this.enabled) {
      this.startBlockerIfNeeded()
    } else {
      this.releaseIfNeeded()
    }
  }

  /** 任务开始：始终记录 token（任务确实在跑）；启用状态且第一个任务时启动防休眠 */
  begin(token: object): void {
    this.activeTokens.add(token)
    if (!this.enabled) return
    this.startBlockerIfNeeded()
  }

  /** 任务结束：释放 token，最后一个任务结束时释放防休眠 */
  end(token: object): void {
    this.activeTokens.delete(token)
    this.releaseIfNeeded()
  }

  /** 应用退出等场景：清空所有 token 并释放 */
  stop(): void {
    this.activeTokens.clear()
    this.releaseIfNeeded()
  }

  /** 当前是否有活跃任务 */
  get runningTaskCount(): number {
    return this.activeTokens.size
  }

  /** 当前防休眠是否生效 */
  get isActive(): boolean {
    return this.activeBlockerId !== null && this.adapter.isStarted(this.activeBlockerId)
  }

  private startBlockerIfNeeded(): void {
    if (this.activeBlockerId !== null) {
      if (this.adapter.isStarted(this.activeBlockerId)) return
      // blocker 已被系统回收：置空以便重建
      this.activeBlockerId = null
    }
    if (this.activeTokens.size === 0) return
    this.activeBlockerId = this.adapter.start('prevent-app-suspension')
    console.log('[任务防休眠] 任务运行中：阻止系统休眠（锁屏/息屏/合盖不中断任务）')
  }

  private releaseIfNeeded(): void {
    if (this.activeBlockerId === null) return
    if (this.enabled && this.activeTokens.size > 0) return
    if (this.adapter.isStarted(this.activeBlockerId)) {
      this.adapter.stop(this.activeBlockerId)
    }
    this.activeBlockerId = null
    console.log('[任务防休眠] 已释放，恢复系统休眠策略')
  }
}
