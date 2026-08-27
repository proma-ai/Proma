export interface StreamRouteTarget {
  isDestroyed(): boolean
}

export interface AgentStreamRoute<T extends StreamRouteTarget> {
  target: T
  ownerId: number
}

/**
 * 管理 session → renderer 的流事件投递路由。
 *
 * 新 run 会取得新 owner；renderer 重载只替换既有 owner 的 target。这样旧 run
 * 无法清理队列接力后的新 run route，而运行中的 renderer 重绑也不会脱离原 run 的
 * finally 清理责任。
 */
export class AgentStreamRouteRegistry<T extends StreamRouteTarget> {
  private readonly routes = new Map<string, AgentStreamRoute<T>>()
  private nextOwnerId = 0

  bind(sessionId: string, target: T): AgentStreamRoute<T> {
    const route = { target, ownerId: ++this.nextOwnerId }
    this.routes.set(sessionId, route)
    return route
  }

  /** Renderer 重载：保留当前运行 owner，只替换可投递目标。 */
  rebind(sessionId: string, target: T): AgentStreamRoute<T> {
    const current = this.routes.get(sessionId)
    const route = { target, ownerId: current?.ownerId ?? ++this.nextOwnerId }
    this.routes.set(sessionId, route)
    return route
  }

  /** 已销毁 target 不可投递，但 route 会保留到活跃 run 的 finally 或后续 rebind 收束。 */
  get(sessionId: string): AgentStreamRoute<T> | undefined {
    const route = this.routes.get(sessionId)
    return route?.target.isDestroyed() ? undefined : route
  }

  /** 当前 route 仍属于指定 owner 时返回其目标。 */
  getTargetIfOwner(sessionId: string, ownerId: number): T | undefined {
    const route = this.routes.get(sessionId)
    if (!route || route.ownerId !== ownerId || route.target.isDestroyed()) return undefined
    return route.target
  }

  /** 当前路由的 owner 与目标一致时才移除；renderer 重绑不会改变 owner。 */
  removeIfOwner(sessionId: string, ownerId: number): boolean {
    const route = this.routes.get(sessionId)
    if (!route || route.ownerId !== ownerId) return false
    this.routes.delete(sessionId)
    return true
  }

  markTargetDestroyed(target: T): string[] {
    const affected: string[] = []
    for (const [sessionId, route] of this.routes) {
      if (route.target === target) affected.push(sessionId)
    }
    return affected
  }
}
