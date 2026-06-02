import { describe, expect, test } from 'bun:test'
import {
  FeishuSyncSleepBlocker,
  shouldPreventSleepForFeishuSync,
  type SleepBlockerAdapter,
  type SleepBlockerType,
} from './sleep-blocker'

class FakeSleepBlocker implements SleepBlockerAdapter {
  readonly startedTypes: SleepBlockerType[] = []
  readonly stoppedIds: number[] = []
  private nextId = 1
  private activeIds = new Set<number>()

  start(type: SleepBlockerType): number {
    const id = this.nextId
    this.nextId += 1
    this.startedTypes.push(type)
    this.activeIds.add(id)
    return id
  }

  stop(id: number): void {
    this.stoppedIds.push(id)
    this.activeIds.delete(id)
  }

  isStarted(id: number): boolean {
    return this.activeIds.has(id)
  }

  markStopped(id: number): void {
    this.activeIds.delete(id)
  }
}

describe('飞书同步防休眠', () => {
  test('Given 飞书实时同步已开启 When 同步防休眠状态 Then 启用系统级防休眠（允许息屏锁屏）', () => {
    const adapter = new FakeSleepBlocker()
    const blocker = new FeishuSyncSleepBlocker(adapter)

    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })

    expect(adapter.startedTypes).toEqual(['prevent-app-suspension'])
    expect(adapter.isStarted(1)).toBe(true)
  })

  test('Given 防休眠已启用 When 重复同步开启状态 Then 不重复创建 blocker', () => {
    const adapter = new FakeSleepBlocker()
    const blocker = new FeishuSyncSleepBlocker(adapter)

    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })
    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })

    expect(adapter.startedTypes).toHaveLength(1)
    expect(adapter.isStarted(1)).toBe(true)
  })

  test('Given 飞书实时同步从开启切到关闭 When 同步防休眠状态 Then 释放系统防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const blocker = new FeishuSyncSleepBlocker(adapter)

    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })
    blocker.sync({ feishuSessionMirror: { mode: 'off' } })

    expect(adapter.stoppedIds).toEqual([1])
    expect(adapter.isStarted(1)).toBe(false)
  })

  test('Given 系统中的 blocker 已失效 When 飞书同步仍开启 Then 重新启用防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const blocker = new FeishuSyncSleepBlocker(adapter)

    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })
    adapter.markStopped(1)
    blocker.sync({ feishuSessionMirror: { mode: 'stream', botId: 'bot-1' } })

    expect(adapter.startedTypes).toEqual(['prevent-app-suspension', 'prevent-app-suspension'])
    expect(adapter.isStarted(2)).toBe(true)
  })

  test('Given 未开启飞书实时同步 When 判断防休眠需求 Then 不阻止休眠', () => {
    expect(shouldPreventSleepForFeishuSync({ feishuSessionMirror: { mode: 'off' } })).toBe(false)
    expect(shouldPreventSleepForFeishuSync({ feishuSessionMirror: undefined })).toBe(false)
  })
})
