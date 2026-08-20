/**
 * 飞书 Bridge 管理器（多 Bot 版本）
 *
 * 管理多个 FeishuBridge 实例的生命周期、状态汇总和聚合查询。
 * 替代原来的单例 `feishuBridge`。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
import { redactSensitiveLogValue } from './bridge-log-redaction'
import { getFeishuMultiBotConfig, getFeishuBotById } from './feishu-config'
import { getFeishuBotBindingsPath, getFeishuBotMetadataPath } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'
import { isBindingForDeletedWorkspace } from './bridge-binding-store'
import { getSettings } from './settings-service'
import { resolveSessionMirrorBot, normalizeSessionMirrorUserOpenId } from './feishu/session-mirror'

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
        console.error(`[飞书 BridgeManager] Bot "${bot.name}" 启动失败:`, redactSensitiveLogValue(error))
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
        console.error(`[飞书 BridgeManager] Bot ${botId} 停止失败:`, redactSensitiveLogValue(error))
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

  /** 为新建或重配的 Bot 记录扫码操作人的当前组织身份，供 Session 镜像立即建群。 */
  setSessionMirrorOperator(botId: string, operatorOpenId: string | undefined): void {
    const userOpenId = normalizeSessionMirrorUserOpenId(operatorOpenId)
    if (!userOpenId) return

    const bridge = this.bridges.get(botId)
    if (bridge) {
      bridge.setSessionMirrorUserOpenId(userOpenId)
      return
    }

    try {
      writeJsonFileAtomic(getFeishuBotMetadataPath(botId), { lastInteractedUserOpenId: userOpenId })
    } catch (error) {
      console.error(`[飞书 BridgeManager] 保存 Bot ${botId} 的镜像用户身份失败:`, redactSensitiveLogValue(error))
    }
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

  /**
   * 删除已移除工作区及其会话的聊天绑定，包含当前未启动 Bot 的持久化绑定文件。
   */
  removeBindingsForDeletedWorkspace(workspaceId: string, sessionIds: readonly string[]): number {
    const removedSessionIds = new Set(sessionIds)
    const shouldRemove = (binding: Pick<FeishuChatBinding, 'workspaceId' | 'sessionId'>) =>
      isBindingForDeletedWorkspace(binding, workspaceId, removedSessionIds)
    let removed = 0

    for (const bridge of this.bridges.values()) {
      for (const binding of bridge.listBindings()) {
        if (shouldRemove(binding) && bridge.removeBinding(binding.chatId)) removed += 1
      }
    }

    const activeBotIds = new Set(this.bridges.keys())
    for (const bot of getFeishuMultiBotConfig().bots) {
      if (activeBotIds.has(bot.id)) continue

      const bindingsPath = getFeishuBotBindingsPath(bot.id)
      if (!existsSync(bindingsPath)) continue
      try {
        const bindings = JSON.parse(readFileSync(bindingsPath, 'utf-8')) as unknown
        if (!Array.isArray(bindings)) continue
        const retained = bindings.filter((binding) => {
          if (!binding || typeof binding !== 'object') return true
          const candidate = binding as Partial<FeishuChatBinding>
          return !(
            typeof candidate.workspaceId === 'string'
            && typeof candidate.sessionId === 'string'
            && shouldRemove(candidate as Pick<FeishuChatBinding, 'workspaceId' | 'sessionId'>)
          )
        })
        if (retained.length !== bindings.length) {
          writeFileSync(bindingsPath, JSON.stringify(retained, null, 2), 'utf-8')
          removed += bindings.length - retained.length
        }
      } catch (error) {
        console.error(`[飞书 BridgeManager] 清理 Bot ${bot.id} 的失效聊天绑定失败:`, redactSensitiveLogValue(error))
      }
    }

    return removed
  }

  /**
   * 会话迁移后同步飞书 binding，确保附件保存和 headless run 使用同一项目。
   * 未启动的 Bot 直接更新其持久化 binding 文件。
   */
  syncWorkspaceForSession(sessionId: string, workspaceId: string): number {
    let updated = 0
    const activeBotIds = new Set(this.bridges.keys())

    for (const bridge of this.bridges.values()) {
      for (const binding of bridge.listBindings()) {
        if (binding.sessionId === sessionId && binding.workspaceId !== workspaceId) {
          bridge.updateBinding({ chatId: binding.chatId, workspaceId })
          updated++
        }
      }
    }

    for (const bot of getFeishuMultiBotConfig().bots) {
      if (activeBotIds.has(bot.id)) continue
      const bindingsPath = getFeishuBotBindingsPath(bot.id)
      if (!existsSync(bindingsPath)) continue
      try {
        const bindings = JSON.parse(readFileSync(bindingsPath, 'utf-8')) as unknown
        if (!Array.isArray(bindings)) continue
        let changed = false
        const next = bindings.map((binding) => {
          if (!binding || typeof binding !== 'object') return binding
          const candidate = binding as Partial<FeishuChatBinding>
          if (candidate.sessionId !== sessionId || candidate.workspaceId === workspaceId) return binding
          changed = true
          updated++
          return { ...candidate, workspaceId }
        })
        if (changed) writeJsonFileAtomic(bindingsPath, next)
      } catch (error) {
        console.error(`[飞书 BridgeManager] 同步 Bot ${bot.id} 的会话项目失败:`, redactSensitiveLogValue(error))
      }
    }

    return updated
  }

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

  /** 直接向指定飞书聊天发送卡片（用于定时任务完成通知等主动推送场景） */
  async sendCardToChat(botId: string, chatId: string, card: Record<string, unknown>): Promise<void> {
    const bridge = this.bridges.get(botId) ?? this.findBridgeByChatId(chatId)
    if (!bridge) {
      throw new Error(`飞书 Bot 未连接或未找到聊天绑定: bot=${botId}, chat=${chatId}`)
    }
    if (bridge.getStatus().status !== 'connected') {
      throw new Error(`飞书 Bot 未连接: bot=${botId}`)
    }
    await bridge.sendCardToChat(chatId, card)
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
