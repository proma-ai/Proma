import { powerMonitor } from 'electron'

/**
 * Bridge Registry — 统一管理 IM Bridge 生命周期
 *
 * 解决的问题：每新增一个 Bridge（飞书、钉钉、微信…），都需要在 index.ts 的
 * `app.whenReady()` 和 `before-quit` 两个位置分别添加启动/清理代码。
 * 遗漏任一处会导致 Bridge 不启动或进程无法正常退出。
 *
 * 使用方式：
 * 1. 在各 Bridge 模块中调用 `registerBridge()` 注册
 * 2. 在 `app.whenReady()` 中调用 `startAllBridges()`
 * 3. 在 `before-quit` 中调用 `stopAllBridges()`
 *
 * 新增 Bridge 只需一个 `registerBridge()` 调用，无需修改两个位置。
 */

/** Bridge 注册信息 */
export interface BridgeRegistration {
  /** 显示名称，用于日志 */
  name: string
  /** 判断是否应在启动时自动连接（检查配置是否完整/启用） */
  shouldAutoStart: () => boolean
  /** 判断当前 Bridge 是否需要自愈恢复；通常只在 error 状态返回 true */
  needsRecovery?: () => boolean
  /** 启动连接 */
  start: () => Promise<void>
  /** 停止连接并释放资源 */
  stop: () => void
  /** 自愈恢复；未提供时默认 stop 后 start */
  recover?: () => Promise<void>
}

export interface BridgeSelfHealingOptions {
  /** 定时健康检查间隔；传 0 可关闭定时检查 */
  healthCheckIntervalMs?: number
}

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000
const POWER_RECOVERY_DELAYS_MS = [1_500, 10_000] as const

const bridges: BridgeRegistration[] = []
let recoveryInFlight = false
let selfHealingStarted = false
let healthCheckTimer: ReturnType<typeof setInterval> | null = null
const scheduledRecoveryTimers = new Set<ReturnType<typeof setTimeout>>()

/** 注册一个 Bridge（通常在模块顶层调用） */
export function registerBridge(bridge: BridgeRegistration): void {
  bridges.push(bridge)
}

/**
 * 启动所有满足条件的 Bridge
 *
 * 每个 Bridge 独立启动，单个失败不影响其他 Bridge。
 * 启动是 fire-and-forget，不阻塞主流程。
 */
export async function startAllBridges(): Promise<void> {
  for (const bridge of bridges) {
    if (bridge.shouldAutoStart()) {
      bridge.start().catch((err) => {
        console.error(`[Bridge Registry] ${bridge.name} 自动启动失败:`, err)
      })
    }
  }
}

/** 启动 Bridge 自愈守护：系统恢复/解锁后重建长连接，定时恢复 error 状态。 */
export function startBridgeSelfHealing(options: BridgeSelfHealingOptions = {}): void {
  if (selfHealingStarted) return
  selfHealingStarted = true

  powerMonitor.on('resume', handlePowerResume)
  powerMonitor.on('unlock-screen', handlePowerUnlock)

  const intervalMs = options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
  if (intervalMs > 0) {
    healthCheckTimer = setInterval(() => {
      void recoverAllBridges('定时健康检查', { force: false })
    }, intervalMs)
    healthCheckTimer.unref?.()
  }

  console.log('[Bridge Registry] 自愈守护已启动')
}

/** 停止 Bridge 自愈守护（应用退出时调用）。 */
export function stopBridgeSelfHealing(): void {
  if (!selfHealingStarted) return
  selfHealingStarted = false

  powerMonitor.off('resume', handlePowerResume)
  powerMonitor.off('unlock-screen', handlePowerUnlock)

  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }

  for (const timer of scheduledRecoveryTimers) {
    clearTimeout(timer)
  }
  scheduledRecoveryTimers.clear()

  console.log('[Bridge Registry] 自愈守护已停止')
}

/** 立即恢复需要自愈的 Bridge。force=true 时会重启所有自动启用的 Bridge。 */
export async function recoverAllBridges(
  reason: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (recoveryInFlight) return

  recoveryInFlight = true
  try {
    for (const bridge of bridges) {
      if (!bridge.shouldAutoStart()) continue
      if (!options.force && bridge.needsRecovery?.() !== true) continue

      console.log(`[Bridge Registry] 自愈恢复 ${bridge.name}，原因：${reason}`)
      try {
        if (bridge.recover) {
          await bridge.recover()
        } else {
          try {
            bridge.stop()
          } catch (err) {
            console.error(`[Bridge Registry] ${bridge.name} 自愈停止失败:`, err)
          }
          await bridge.start()
        }
        console.log(`[Bridge Registry] ${bridge.name} 自愈恢复完成`)
      } catch (err) {
        console.error(`[Bridge Registry] ${bridge.name} 自愈恢复失败:`, err)
      }
    }
  } finally {
    recoveryInFlight = false
  }
}

function handlePowerResume(): void {
  schedulePowerRecovery('系统恢复')
}

function handlePowerUnlock(): void {
  schedulePowerRecovery('系统解锁')
}

function schedulePowerRecovery(reason: string): void {
  for (const delayMs of POWER_RECOVERY_DELAYS_MS) {
    const timer = setTimeout(() => {
      scheduledRecoveryTimers.delete(timer)
      void recoverAllBridges(reason, { force: true })
    }, delayMs)
    timer.unref?.()
    scheduledRecoveryTimers.add(timer)
  }
}

/** 停止所有已注册的 Bridge（进程退出时调用） */
export function stopAllBridges(): void {
  for (const bridge of bridges) {
    try {
      bridge.stop()
    } catch (err) {
      console.error(`[Bridge Registry] ${bridge.name} 停止失败:`, err)
    }
  }
}
