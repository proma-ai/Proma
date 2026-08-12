import { describe, expect, test } from 'bun:test'
import {
  TaskSleepGuard,
  shouldEnableTaskSleepGuard,
  type SleepBlockerAdapter,
  type SleepBlockerType,
} from './task-sleep-guard'

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
}

describe('任务防休眠默认开启判断', () => {
  test('未配置时默认开启（用户要求默认开启）', () => {
    expect(shouldEnableTaskSleepGuard({})).toBe(true)
  })

  test('enabled true 开启，enabled false 关闭', () => {
    expect(shouldEnableTaskSleepGuard({ taskSleepGuard: { enabled: true } })).toBe(true)
    expect(shouldEnableTaskSleepGuard({ taskSleepGuard: { enabled: false } })).toBe(false)
  })
})

describe('任务防休眠', () => {
  test('Given 默认设置 When 第一个任务开始 Then 启动防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    guard.begin({})

    expect(adapter.startedTypes).toEqual(['prevent-app-suspension'])
    expect(guard.isActive).toBe(true)
    expect(guard.runningTaskCount).toBe(1)
  })

  test('Given 多个任务并发 When 全部开始 Then 只启动一个 blocker', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    guard.begin({ id: 1 })
    guard.begin({ id: 2 })
    guard.begin({ id: 3 })

    expect(adapter.startedTypes).toHaveLength(1)
    expect(guard.runningTaskCount).toBe(3)
    expect(guard.isActive).toBe(true)
  })

  test('Given 多个任务并发 When 部分结束 Then 防休眠保持，全部结束才释放', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    const token1 = { id: 1 }
    const token2 = { id: 2 }
    guard.begin(token1)
    guard.begin(token2)
    guard.end(token1)

    expect(guard.isActive).toBe(true)

    guard.end(token2)

    expect(guard.isActive).toBe(false)
    expect(adapter.stoppedIds).toHaveLength(1)
    expect(guard.runningTaskCount).toBe(0)
  })

  test('Given 重复结束同一 token When end 多次 Then 不影响其他任务与计数', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    const token = { id: 1 }
    guard.begin(token)
    guard.end(token)
    guard.end(token)

    expect(guard.runningTaskCount).toBe(0)
    expect(guard.isActive).toBe(false)
  })

  test('Given 设置被关闭 When 仍有任务运行 Then 立即释放防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({ taskSleepGuard: { enabled: true } })

    guard.begin({ id: 1 })
    expect(guard.isActive).toBe(true)

    guard.syncSettings({ taskSleepGuard: { enabled: false } })

    expect(guard.isActive).toBe(false)
    expect(adapter.stoppedIds).toHaveLength(1)
  })

  test('Given 设置关闭后 When 新任务开始 Then 不启动防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({ taskSleepGuard: { enabled: false } })

    guard.begin({ id: 1 })

    expect(adapter.startedTypes).toHaveLength(0)
    expect(guard.isActive).toBe(false)
  })

  test('Given 设置从关闭切回开启 When 已有任务在跑 Then 重新启用防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({ taskSleepGuard: { enabled: false } })
    guard.begin({ id: 1 })

    guard.syncSettings({ taskSleepGuard: { enabled: true } })

    expect(adapter.startedTypes).toHaveLength(1)
    expect(guard.isActive).toBe(true)
  })

  test('Given 应用退出 When stop Then 清空所有任务并释放', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    guard.begin({ id: 1 })
    guard.begin({ id: 2 })

    guard.stop()

    expect(guard.runningTaskCount).toBe(0)
    expect(guard.isActive).toBe(false)
  })

  test('Given 从未有任务 When stop Then 无副作用', () => {
    const adapter = new FakeSleepBlocker()
    const guard = new TaskSleepGuard(adapter)
    guard.syncSettings({})

    guard.stop()

    expect(adapter.startedTypes).toHaveLength(0)
    expect(adapter.stoppedIds).toHaveLength(0)
  })
})
