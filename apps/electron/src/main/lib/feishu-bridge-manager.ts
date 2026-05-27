/**
 * 飞书 Bridge 管理器（多 Bot 版本）
 *
 * 管理多个 FeishuBridge 实例的生命周期、状态汇总和聚合查询。
 * 替代原来的单例 `feishuBridge`。
 */

import type {
  FeishuBridgeState,
  FeishuChatBinding,
  FeishuMultiBridgeState,
  FeishuBotBridgeState,
  FeishuTestResult,
  FeishuBotConfig,
  AgentSessionMeta,
} from '@proma/shared'
import { FeishuBridge } from './feishu-bridge'
import { getFeishuMultiBotConfig, getFeishuBotById } from './feishu-config'
import { getSettings } from './settings-service'
import { resolveSessionMirrorBot } from './feishu/session-mirror'

class FeishuBridgeManager {
  /** botId → Bridge 实例 */
  private bridges = new Map<string, FeishuBridge>()

  // ===== 生命周期 =====

  /** 启动所有已启用的 Bot */
  async startAll(): Promise<void> {
    const config = getFeishuMultiBotConfig()
    const enabledBots = config.bots.filter((b) => b.enabled && b.appId && b.appSecret)

    for (const bot of enabledBots) {
      try {
        await this.startBot(bot.id)
      } catch (error) {
        console.error(`[飞书 BridgeManager] Bot "${bot.name}" 启动失败:`, error)
      }
    }

    if (enabledBots.length > 0) {
      console.log(`[飞书 BridgeManager] 已启动 ${this.bridges.size}/${enabledBots.length} 个 Bot`)
    }
  }

  /** 停止所有 Bot */
  stopAll(): void {
    for (const [botId, bridge] of this.bridges) {
      try {
        bridge.stop()
      } catch (error) {
        console.error(`[飞书 BridgeManager] Bot ${botId} 停止失败:`, error)
      }
    }
    this.bridges.clear()
    console.log('[飞书 BridgeManager] 所有 Bot 已停止')
  }

  /** 启动单个 Bot */
  async startBot(botId: string): Promise<void> {
    // 如果已有实例，先停止
    const existing = this.bridges.get(botId)
    if (existing) {
      existing.stop()
      this.bridges.delete(botId)
    }

    const botConfig = getFeishuBotById(botId)
    if (!botConfig) {
      throw new Error(`Bot ${botId} 不存在`)
    }
    if (!botConfig.enabled) {
      throw new Error(`Bot "${botConfig.name}" 未启用`)
    }

    const bridge = new FeishuBridge(botConfig)
    this.bridges.set(botId, bridge)
    await bridge.start()
  }

  /** 停止单个 Bot */
  stopBot(botId: string): void {
    const bridge = this.bridges.get(botId)
    if (bridge) {
      bridge.stop()
      this.bridges.delete(botId)
    }
  }

  /** 重启单个 Bot（配置变更后调用） */
  async restartBot(botId: string): Promise<void> {
    this.stopBot(botId)
    await this.startBot(botId)
  }

  // ===== 状态查询 =====

  /** 获取所有 Bot 的 Bridge 状态 */
  getStates(): FeishuMultiBridgeState {
    const bots: Record<string, FeishuBotBridgeState> = {}
    const config = getFeishuMultiBotConfig()

    for (const bot of config.bots) {
      const bridge = this.bridges.get(bot.id)
      const status: FeishuBridgeState = bridge
        ? bridge.getStatus()
        : { status: 'disconnected', activeBindings: 0 }

      bots[bot.id] = {
        ...status,
        botId: bot.id,
        botName: bot.name,
      }
    }

    return { bots }
  }

  /** 获取单个 Bot 的 Bridge 实例 */
  getBridge(botId: string): FeishuBridge | undefined {
    return this.bridges.get(botId)
  }

  /** 获取所有活跃 Bridge 实例 */
  getAllBridges(): Map<string, FeishuBridge> {
    return this.bridges
  }

  /** 为桌面端 Proma Session 创建或恢复飞书镜像群。 */
  async ensureSessionMirror(session: AgentSessionMeta): Promise<void> {
    const config = getFeishuMultiBotConfig()
    const bot = resolveSessionMirrorBot(getSettings().feishuSessionMirror, config.bots)
    if (!bot) return

    const bridge = this.bridges.get(bot.id)
    if (!bridge || bridge.getStatus().status !== 'connected') {
      console.warn(`[飞书 Session 镜像] Bot "${bot.name}" 未连接，跳过 session=${session.id.slice(0, 8)}`)
      return
    }

    await bridge.ensureSessionMirror(session)
  }

  /** 在 Agent 运行前创建 Session 镜像群里的流式卡片。 */
  async startSessionMirrorRun(session: AgentSessionMeta): Promise<void> {
    const mirrorSettings = getSettings().feishuSessionMirror
    if (mirrorSettings?.mode !== 'stream') return

    const config = getFeishuMultiBotConfig()
    const bot = resolveSessionMirrorBot(mirrorSettings, config.bots)
    if (!bot) return

    const bridge = this.bridges.get(bot.id)
    if (!bridge || bridge.getStatus().status !== 'connected') return

    await bridge.startSessionMirrorRun(session)
  }

  stopSessionMirrorRun(sessionId: string): void {
    for (const bridge of this.bridges.values()) {
      bridge.stopSessionMirrorRun(sessionId)
    }
  }

  // ===== 聚合查询 =====

  /** 跨所有 Bot 的绑定列表 */
  listAllBindings(): FeishuChatBinding[] {
    const all: FeishuChatBinding[] = []
    for (const bridge of this.bridges.values()) {
      all.push(...bridge.listBindings())
    }
    return all
  }

  /** 根据 chatId 找到对应的 Bridge（用于 IPC 路由） */
  findBridgeByChatId(chatId: string): FeishuBridge | undefined {
    for (const bridge of this.bridges.values()) {
      const bindings = bridge.listBindings()
      if (bindings.some((b) => b.chatId === chatId)) {
        return bridge
      }
    }
    return undefined
  }

  // ===== 连接测试（静态，不影响运行中的 Bridge） =====

  async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
    // 复用 Bridge 的测试逻辑，创建临时 config
    const tempConfig: FeishuBotConfig = {
      id: 'test',
      name: 'test',
      enabled: true,
      appId,
      appSecret: '', // 不需要加密的，testConnection 直接用明文
    }
    const tempBridge = new FeishuBridge(tempConfig)
    return tempBridge.testConnection(appId, appSecret)
  }
}

export const feishuBridgeManager = new FeishuBridgeManager()
