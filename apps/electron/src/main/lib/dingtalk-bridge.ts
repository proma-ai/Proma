/**
 * 钉钉 Bridge 服务（多 Bot 版本）
 *
 * 核心职责：
 * - 通过 WebSocket 长连接（Stream 模式）接收钉钉消息
 * - 管理连接生命周期（启动/停止/重启/状态推送）
 * - 消息路由到 Proma Agent，通过 sessionWebhook 回复
 *
 * 每个 DingTalkBridge 实例对应一个 Bot，由 DingTalkBridgeManager 管理。
 */

import { BrowserWindow } from 'electron'
import type {
  DingTalkBridgeState,
  DingTalkBotBridgeState,
  DingTalkBotConfig,
  DingTalkTestResult,
} from '@proma/shared'
import { DINGTALK_IPC_CHANNELS } from '@proma/shared'
import { getDecryptedBotClientSecret } from './dingtalk-config'
import { BridgeCommandHandler } from './bridge-command-handler'

// ===== 类型声明 =====

interface DWClientModule {
  DWClient: new (opts: {
    clientId: string
    clientSecret: string
    ua?: string
    keepAlive?: boolean
  }) => DWClientInstance
  TOPIC_ROBOT: string
  EventAck: { SUCCESS: string; LATER: string }
}

interface DWClientInstance {
  connected: boolean
  registerCallbackListener(eventId: string, callback: (msg: DWClientDownStream) => void): DWClientInstance
  registerAllEventListener(callback: (msg: DWClientDownStream) => { status: string; message?: string }): DWClientInstance
  connect(): Promise<void>
  disconnect(): void
  send(messageId: string, value: { status: string; message?: string }): void
}

interface DWClientDownStream {
  specVersion: string
  type: string
  headers: {
    appId: string
    connectionId: string
    contentType: string
    messageId: string
    time: string
    topic: string
    eventType?: string
  }
  data: string
}

/** 钉钉机器人消息体 */
interface DingTalkRobotMessage {
  msgtype: string
  text?: { content: string }
  senderNick: string
  senderId: string
  conversationId: string
  conversationType: '1' | '2'  // 1=单聊, 2=群聊
  sessionWebhook: string
  sessionWebhookExpiredTime: number
}

// ===== Bridge 实例 =====

class DingTalkBridge {
  private client: DWClientInstance | null = null
  private state: DingTalkBridgeState = { status: 'disconnected' }

  /** 每个实例独立的 webhook 缓存 */
  private webhookCache = new Map<string, string>()
  private readonly MAX_WEBHOOK_CACHE = 200

  /** Bot 配置（构造时传入） */
  readonly botConfig: DingTalkBotConfig

  /** 通用命令处理器 */
  private commandHandler: BridgeCommandHandler

  constructor(botConfig: DingTalkBotConfig) {
    this.botConfig = botConfig
    this.commandHandler = new BridgeCommandHandler({
      platformName: `钉钉-${botConfig.name}`,
      adapter: {
        sendText: async (chatId: string, text: string, meta?: unknown) => {
          const ctx = meta as { sessionWebhook?: string } | undefined
          const webhook = ctx?.sessionWebhook ?? this.webhookCache.get(chatId)
          if (!webhook) {
            console.warn(`[钉钉 Bridge/${this.botConfig.name}] 无法回复：没有可用的 sessionWebhook`)
            return
          }
          try {
            const resp = await fetch(webhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                msgtype: 'text',
                text: { content: text },
              }),
            })
            if (!resp.ok) {
              console.warn(`[钉钉 Bridge/${this.botConfig.name}] 发送消息失败: HTTP ${resp.status}`)
            }
          } catch (error) {
            console.error(`[钉钉 Bridge/${this.botConfig.name}] 发送消息异常:`, error)
          }
        },
      },
      getDefaultWorkspaceId: () => this.botConfig.defaultWorkspaceId,
    })
  }

  /** 获取当前状态 */
  getStatus(): DingTalkBridgeState {
    return { ...this.state }
  }

  /** 启动 Stream 连接 */
  async start(): Promise<void> {
    if (!this.botConfig.clientId || !this.botConfig.clientSecret) {
      throw new Error('请先配置 Client ID 和 Client Secret')
    }

    // 如果已连接，先停止
    if (this.client) {
      this.stop()
    }

    this.updateStatus({ status: 'connecting' })

    try {
      const clientSecret = getDecryptedBotClientSecret(this.botConfig.id)
      const sdk = await import('dingtalk-stream-sdk-nodejs') as DWClientModule

      this.client = new sdk.DWClient({
        clientId: this.botConfig.clientId,
        clientSecret,
        keepAlive: true,
      })

      // 注册 CALLBACK：订阅机器人消息
      this.client.registerCallbackListener(sdk.TOPIC_ROBOT, (msg: DWClientDownStream) => {
        this.client?.send(msg.headers.messageId, { status: sdk.EventAck.SUCCESS })
        this.handleRobotMessage(msg)
      })

      // 注册 EVENT：其他事件类型（自动 ACK）
      this.client.registerAllEventListener((msg: DWClientDownStream) => {
        console.log(`[钉钉 Bridge/${this.botConfig.name}] 收到事件:`, msg.headers.topic, msg.headers.eventType ?? '')
        return { status: sdk.EventAck.SUCCESS }
      })

      await this.client.connect()
      this.commandHandler.subscribe()

      this.updateStatus({ status: 'connected', connectedAt: Date.now() })
      console.log(`[钉钉 Bridge/${this.botConfig.name}] Stream 连接已建立`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage })
      console.error(`[钉钉 Bridge/${this.botConfig.name}] 连接失败:`, errorMessage)
      this.client = null
      throw error
    }
  }

  /** 停止连接 */
  stop(): void {
    if (this.client) {
      try {
        this.client.disconnect()
      } catch {
        // 忽略断开连接时的错误
      }
      this.client = null
    }
    this.commandHandler.unsubscribe()
    this.updateStatus({ status: 'disconnected' })
    console.log(`[钉钉 Bridge/${this.botConfig.name}] 已停止`)
  }

  /** 测试连接（使用提供的凭证，不影响当前连接） */
  async testConnection(clientId: string, clientSecret: string): Promise<DingTalkTestResult> {
    let testClient: DWClientInstance | null = null
    try {
      const sdk = await import('dingtalk-stream-sdk-nodejs') as DWClientModule

      testClient = new sdk.DWClient({
        clientId,
        clientSecret,
      })

      testClient.registerAllEventListener(() => ({ status: sdk.EventAck.SUCCESS }))
      await testClient.connect()

      testClient.disconnect()
      testClient = null

      return {
        success: true,
        message: '连接成功！Stream 通道已验证。',
      }
    } catch (error) {
      if (testClient) {
        try { testClient.disconnect() } catch {}
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        message: `连接失败: ${errorMessage}`,
      }
    }
  }

  /** 处理机器人消息 */
  private handleRobotMessage(msg: DWClientDownStream): void {
    try {
      const data = JSON.parse(msg.data) as DingTalkRobotMessage
      const text = data.text?.content?.trim() ?? ''

      console.log(`[钉钉 Bridge/${this.botConfig.name}] 收到消息:`, {
        msgId: msg.headers.messageId,
        senderNick: data.senderNick,
        text: text.length > 100 ? text.slice(0, 100) + '...' : text,
        conversationType: data.conversationType,
      })

      if (!text) return

      // 缓存 webhook
      const chatId = data.conversationId
      this.cacheWebhook(chatId, data.sessionWebhook)

      // 委托给通用命令处理器
      this.commandHandler.handleIncomingMessage(chatId, text, {
        sessionWebhook: data.sessionWebhook,
      }).catch((error) => {
        console.error(`[钉钉 Bridge/${this.botConfig.name}] 处理消息失败:`, error)
      })
    } catch (error) {
      console.error(`[钉钉 Bridge/${this.botConfig.name}] 解析消息失败:`, error, msg.data)
    }
  }

  /** 缓存 webhook */
  private cacheWebhook(chatId: string, webhook: string): void {
    if (this.webhookCache.size >= this.MAX_WEBHOOK_CACHE) {
      const firstKey = this.webhookCache.keys().next().value
      if (firstKey) this.webhookCache.delete(firstKey)
    }
    this.webhookCache.set(chatId, webhook)
  }

  /** 更新状态并推送到渲染进程 */
  private updateStatus(partial: Partial<DingTalkBridgeState>): void {
    this.state = { ...this.state, ...partial }
    const botState: DingTalkBotBridgeState = {
      ...this.state,
      botId: this.botConfig.id,
      botName: this.botConfig.name,
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, botState)
      }
    }
  }
}

export { DingTalkBridge }
