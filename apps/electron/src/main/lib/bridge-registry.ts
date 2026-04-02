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
  /** 启动连接 */
  start: () => Promise<void>
  /** 停止连接并释放资源 */
  stop: () => void
}

const bridges: BridgeRegistration[] = []

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
