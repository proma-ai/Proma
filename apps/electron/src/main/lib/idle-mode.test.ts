import { describe, expect, test } from 'bun:test'
import {
  IdleModeManager,
  buildDisplayOffCommand,
  shouldEnableIdleMode,
  type DisplayOffRunner,
  type SleepBlockerAdapter,
  type SleepBlockerType,
} from './idle-mode'

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

class FakeDisplayOffRunner implements DisplayOffRunner {
  readonly calls: NodeJS.Platform[] = []
  failNext = false
  /** 置为 true 后，run 返回的 promise 由测试手动控制（模拟慢命令在途场景） */
  deferMode = false
  private deferredResolve: (() => void) | null = null
  private deferredReject: ((error: Error) => void) | null = null

  async run(platform: NodeJS.Platform): Promise<void> {
    this.calls.push(platform)
    if (this.failNext) {
      this.failNext = false
      throw new Error('mock display off failure')
    }
    if (this.deferMode) {
      await new Promise<void>((resolve, reject) => {
        this.deferredResolve = resolve
        this.deferredReject = reject
      })
    }
  }

  /** 手动完成在途命令 */
  completeDeferred(): void {
    const resolve = this.deferredResolve
    this.deferredResolve = null
    this.deferredReject = null
    resolve?.()
  }

  /** 手动让在途命令失败 */
  failDeferred(): void {
    const reject = this.deferredReject
    this.deferredResolve = null
    this.deferredReject = null
    reject?.(new Error('mock deferred failure'))
  }
}

describe('平台息屏命令', () => {
  test('macOS 使用 pmset displaysleepnow', () => {
    expect(buildDisplayOffCommand('darwin')).toBe('pmset displaysleepnow')
  })

  test('Windows 使用 EncodedCommand Base64 传递 PS 脚本（避免引号嵌套被剥离）', () => {
    const command = buildDisplayOffCommand('win32')
    if (command === null) {
      throw new Error('win32 平台应返回关屏命令')
    }
    expect(command.startsWith('powershell -NoProfile -EncodedCommand ')).toBe(true)
    expect(command).not.toContain('\"user32.dll\"')
    // 解码 Base64，确认脚本内容完整（不依赖外部引号解析）
    const encoded = command.slice('powershell -NoProfile -EncodedCommand '.length)
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(script).toContain('SendMessage')
    expect(script).toContain('0xF170')
    expect(script).toContain('MonitorOff')
    expect(script).toContain('"user32.dll"')
    // 确保输出中没有裸引号嵌套问题：整条命令不含双引号
    expect(command).not.toContain('"')
  })

  test('Linux 使用 xset dpms force off', () => {
    expect(buildDisplayOffCommand('linux')).toBe('xset dpms force off')
  })

  test('不支持的平台返回 null（仅防休眠）', () => {
    expect(buildDisplayOffCommand('freebsd')).toBeNull()
  })
})

describe('挂机模式', () => {
  test('Given 挂机模式已开启 When 同步挂机模式 Then 启用系统级防休眠并执行息屏命令', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    // 等待息屏命令异步完成
    await Promise.resolve()

    expect(adapter.startedTypes).toEqual(['prevent-app-suspension'])
    expect(adapter.isStarted(1)).toBe(true)
    expect(displayOff.calls).toHaveLength(1)
  })

  test('Given 防休眠已启用 When 重复同步开启状态 Then 不重复创建 blocker 也不重复息屏', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    await Promise.resolve()
    manager.sync({ idleMode: { enabled: true } })
    await Promise.resolve()

    expect(adapter.startedTypes).toHaveLength(1)
    expect(displayOff.calls).toHaveLength(1)
  })

  test('Given 挂机模式从开启切到关闭 When 同步挂机模式 Then 释放系统防休眠', () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    manager.sync({ idleMode: { enabled: false } })

    expect(adapter.stoppedIds).toEqual([1])
    expect(adapter.isStarted(1)).toBe(false)
  })

  test('Given 系统中的 blocker 已失效 When 挂机模式仍开启 Then 重新启用防休眠并再次息屏', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    await Promise.resolve()
    adapter.markStopped(1)
    manager.sync({ idleMode: { enabled: true } })
    await Promise.resolve()

    expect(adapter.startedTypes).toHaveLength(2)
    expect(displayOff.calls).toHaveLength(2)
  })

  test('Given 未开启挂机模式 When 判断是否需要 Then 不启用', () => {
    expect(shouldEnableIdleMode({})).toBe(false)
    expect(shouldEnableIdleMode({ idleMode: { enabled: false } })).toBe(false)
    expect(shouldEnableIdleMode({ idleMode: { enabled: true } })).toBe(true)
  })

  test('Given 开启后立即关闭 When 在途息屏命令完成 Then 不产生误导反馈且状态一致', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    displayOff.deferMode = true
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    // 命令在途时关闭
    manager.sync({ idleMode: { enabled: false } })
    expect(adapter.isStarted(1)).toBe(false)

    // 在途命令此时才完成：不应抛错、不应复活 blocker
    displayOff.completeDeferred()
    await Promise.resolve()
    await Promise.resolve()

    expect(adapter.isStarted(1)).toBe(false)
    expect(adapter.stoppedIds).toEqual([1])
  })

  test('Given 开启后立即关闭且命令失败 When 在途命令失败 Then 不产生未处理 rejection', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    displayOff.deferMode = true
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    manager.sync({ idleMode: { enabled: false } })

    displayOff.failDeferred()
    await Promise.resolve()
    await Promise.resolve()

    expect(adapter.isStarted(1)).toBe(false)
  })

  test('Given 开启期间命令在途 When 再次开启 Then 新 blocker 独立生效', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    displayOff.deferMode = true
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    manager.sync({ idleMode: { enabled: false } })
    manager.sync({ idleMode: { enabled: true } })
    expect(adapter.startedTypes).toHaveLength(2)

    // 第一批在途命令完成：不产生任何异常（generation 已过期）
    displayOff.completeDeferred()
    await Promise.resolve()
    await Promise.resolve()

    expect(adapter.isStarted(2)).toBe(true)
  })

  test('Given 息屏命令失败 When 挂机模式开启 Then 防休眠仍然生效', async () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    displayOff.failNext = true
    const manager = new IdleModeManager(adapter, displayOff)

    manager.sync({ idleMode: { enabled: true } })
    await Promise.resolve()

    expect(adapter.isStarted(1)).toBe(true)
    expect(displayOff.calls).toHaveLength(1)
  })

  test('Given 从未开启 When stop Then 无操作', () => {
    const adapter = new FakeSleepBlocker()
    const displayOff = new FakeDisplayOffRunner()
    const manager = new IdleModeManager(adapter, displayOff)

    manager.stop()

    expect(adapter.stoppedIds).toHaveLength(0)
    expect(displayOff.calls).toHaveLength(0)
  })
})
