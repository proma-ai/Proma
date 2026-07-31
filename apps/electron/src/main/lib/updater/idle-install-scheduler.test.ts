import { describe, expect, test } from 'bun:test'
import { createIdleInstallScheduler } from './idle-install-scheduler'

describe('空闲更新安装调度器', () => {
  test('Given 有运行中的 Agent When 请求空闲安装 Then 等待 Agent 结束后才安装一次', () => {
    let hasRunningAgent = true
    let installCount = 0
    let tick: (() => void) | undefined
    let clearCount = 0

    const scheduler = createIdleInstallScheduler({
      canInstall: () => !hasRunningAgent,
      install: () => { installCount += 1 },
      setIntervalFn: (callback) => {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => { clearCount += 1 },
    })

    scheduler.request()
    expect(installCount).toBe(0)
    expect(tick).toBeDefined()

    hasRunningAgent = false
    tick?.()
    tick?.()

    expect(installCount).toBe(1)
    expect(clearCount).toBe(1)
  })

  test('Given 空闲安装尚未触发 When 用户取消 Then Agent 结束后不安装', () => {
    let hasRunningAgent = true
    let installCount = 0
    let tick: (() => void) | undefined

    const scheduler = createIdleInstallScheduler({
      canInstall: () => !hasRunningAgent,
      install: () => { installCount += 1 },
      setIntervalFn: (callback) => {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => {},
    })

    scheduler.request()
    scheduler.cancel()
    hasRunningAgent = false
    tick?.()

    expect(installCount).toBe(0)
  })

  test('Given 没有运行中的 Agent When 请求空闲安装 Then 立即安装且不创建轮询', () => {
    let installCount = 0
    let scheduled = false

    const scheduler = createIdleInstallScheduler({
      canInstall: () => true,
      install: () => { installCount += 1 },
      setIntervalFn: () => {
        scheduled = true
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearIntervalFn: () => {},
    })

    scheduler.request()

    expect(installCount).toBe(1)
    expect(scheduled).toBe(false)
  })
})
