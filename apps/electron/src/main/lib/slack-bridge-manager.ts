import { WebClient } from '@slack/web-api'
import type { SlackBotConfig, SlackBridgeState, SlackMultiBridgeState, SlackTestResult } from '@proma/shared'
import { SlackBridge } from './slack-bridge'
import { getSlackBotById, getSlackConfig } from './slack-config'
import { redactSensitiveLogText, redactSensitiveLogValue } from './bridge-log-redaction'

class SlackBridgeManager {
  private readonly bridges = new Map<string, SlackBridge>()

  async startAll(): Promise<void> {
    const bots = getSlackConfig().bots.filter((bot) => bot.enabled && bot.botToken && bot.appToken)
    for (const bot of bots) {
      try {
        await this.startBot(bot.id)
      } catch (error) {
        console.error(`[Slack BridgeManager] Bot "${bot.name}" 启动失败:`, redactSensitiveLogValue(error))
      }
    }
  }

  async stopAll(): Promise<void> {
    const bridges = [...this.bridges.values()]
    this.bridges.clear()
    await Promise.all(bridges.map((bridge) => bridge.stop()))
  }

  async startBot(botId: string): Promise<void> {
    const config = getSlackBotById(botId)
    if (!config) throw new Error(`Slack Bot ${botId} 不存在`)
    if (!config.enabled) throw new Error(`Slack Bot "${config.name}" 未启用`)
    if (!config.botToken || !config.appToken) throw new Error('请先保存 Slack Bot Token 和 App Token')

    const existing = this.bridges.get(botId)
    if (existing) {
      await existing.stop()
      existing.updateConfig(config)
      await existing.start()
      return
    }
    const bridge = new SlackBridge(config)
    this.bridges.set(botId, bridge)
    await bridge.start()
  }

  async stopBot(botId: string): Promise<void> {
    const bridge = this.bridges.get(botId)
    if (!bridge) return
    this.bridges.delete(botId)
    await bridge.stop()
  }

  async restartBot(botId: string): Promise<void> {
    await this.stopBot(botId)
    await this.startBot(botId)
  }

  getBridge(botId: string): SlackBridge | undefined {
    return this.bridges.get(botId)
  }

  getStates(): SlackMultiBridgeState {
    const bots: Record<string, SlackBridgeState & { botId: string; botName: string }> = {}
    for (const bot of getSlackConfig().bots) {
      const state = this.bridges.get(bot.id)?.getStatus() ?? { status: 'disconnected' as const, activeBindings: 0, queuedRuns: 0 }
      bots[bot.id] = { ...state, botId: bot.id, botName: bot.name }
    }
    return { bots }
  }

  hasRecoverableError(): boolean {
    return Object.values(this.getStates().bots).some((state) => state.status === 'error')
  }

  /** Uses only a supplied bot token; it does not modify live Socket Mode connections. */
  async testConnection(botToken: string): Promise<SlackTestResult> {
    if (!botToken.trim()) return { success: false, message: '请先输入 Bot Token (xoxb-...)' }
    try {
      const client = new WebClient(botToken.trim())
      const auth = await client.auth.test()
      return {
        success: true,
        message: `已验证 Slack workspace：${auth.team ?? auth.team_id ?? '未知 workspace'}`,
        teamName: typeof auth.team === 'string' ? auth.team : undefined,
        botUserId: typeof auth.user_id === 'string' ? auth.user_id : undefined,
      }
    } catch (error) {
      return {
        success: false,
        message: `连接失败：${redactSensitiveLogText(error instanceof Error ? error.message : String(error))}`,
      }
    }
  }

  updateConfig(bot: SlackBotConfig): void {
    this.bridges.get(bot.id)?.updateConfig(bot)
  }
}

export const slackBridgeManager = new SlackBridgeManager()
