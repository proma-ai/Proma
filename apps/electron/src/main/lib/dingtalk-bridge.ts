/**
 * 钉钉 Bridge 服务
 *
 * 核心职责：
 * - 通过 WebSocket 长连接（Stream 模式）接收钉钉消息
 * - 管理连接生命周期（启动/停止/重启/状态推送）
 * - 消息路由到 Proma Agent，通过 sessionWebhook 回复
 */

import { BrowserWindow } from 'electron'
import type {
  DingTalkBridgeState,
  DingTalkTestResult,
} from '@proma/shared'
import { DINGTALK_IPC_CHANNELS } from '@proma/shared'
import { getDingTalkConfig, getDecryptedClientSecret } from './dingtalk-config'
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

/** 最近的 chatId → sessionWebhook 映射（webhook 有效期约 35 分钟，限制缓存大小） */
const webhookCache = new Map<string, string>()
const MAX_WEBHOOK_CACHE = 200

function cacheWebhook(chatId: string, webhook: string): void {
  if (webhookCache.size >= MAX_WEBHOOK_CACHE) {
    const firstKey = webhookCache.keys().next().value
    if (firstKey) webhookCache.delete(firstKey)
  }
  webhookCache.set(chatId, webhook)
}

// ===== 单例 Bridge =====

class DingTalkBridge {
  private client: DWClientInstance | null = null
  private state: DingTalkBridgeState = { status: 'disconnected' }

  /** 通用命令处理器 */
  private commandHandler = new BridgeCommandHandler({
    platformName: '钉钉',
    adapter: {
      sendText: async (chatId: string, text: string, meta?: unknown) => {
        // 优先用 meta 中的 webhook，其次用缓存
        const ctx = meta as { sessionWebhook?: string } | undefined
        const webhook = ctx?.sessionWebhook ?? webhookCache.get(chatId)
        if (!webhook) {
          console.warn('[钉钉 Bridge] 无法回复：没有可用的 sessionWebhook')
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
            console.warn(`[钉钉 Bridge] 发送消息失败: HTTP ${resp.status}`)
          }
        } catch (error) {
          console.error('[钉钉 Bridge] 发送消息异常:', error)
        }
      },
    },
  })

  /** 获取当前状态 */
  getStatus(): DingTalkBridgeState {
    return { ...this.state }
  }

  /** 启动 Stream 连接 */
  async start(): Promise<void> {
    const config = getDingTalkConfig()
    if (!config.enabled || !config.clientId || !config.clientSecret) {
      throw new Error('请先配置 Client ID 和 Client Secret')
    }

    // 如果已连接，先停止
    if (this.client) {
      this.stop()
    }

    this.updateStatus({ status: 'connecting' })

    try {
      const clientSecret = getDecryptedClientSecret()
      const sdk = await import('dingtalk-stream-sdk-nodejs') as DWClientModule

      // 创建客户端
      this.client = new sdk.DWClient({
        clientId: config.clientId,
        clientSecret,
        keepAlive: true,
      })

      // 注册 CALLBACK：订阅机器人消息（CALLBACK 类型不会自动 ACK，需手动发送）
      this.client.registerCallbackListener(sdk.TOPIC_ROBOT, (msg: DWClientDownStream) => {
        this.client?.send(msg.headers.messageId, { status: sdk.EventAck.SUCCESS })
        this.handleRobotMessage(msg)
      })

      // 注册 EVENT：其他事件类型（自动 ACK）
      this.client.registerAllEventListener((msg: DWClientDownStream) => {
        console.log('[钉钉 Bridge] 收到事件:', msg.headers.topic, msg.headers.eventType ?? '')
        return { status: sdk.EventAck.SUCCESS }
      })

      // 建立 WebSocket 连接
      await this.client.connect()

      // 订阅 Agent EventBus
      this.commandHandler.subscribe()

      this.updateStatus({ status: 'connected', connectedAt: Date.now() })
      console.log('[钉钉 Bridge] Stream 连接已建立')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage })
      console.error('[钉钉 Bridge] 连接失败:', errorMessage)
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
    console.log('[钉钉 Bridge] 已停止')
  }

  /** 重启连接 */
  async restart(): Promise<void> {
    this.stop()
    await this.start()
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

      // 注册空回调以满足 SDK 要求
      testClient.registerAllEventListener(() => ({ status: sdk.EventAck.SUCCESS }))

      await testClient.connect()

      // 连接成功，立即断开
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

  /** 处理机器人消息，路由到通用命令处理器 */
  private handleRobotMessage(msg: DWClientDownStream): void {
    try {
      const data = JSON.parse(msg.data) as DingTalkRobotMessage
      const text = data.text?.content?.trim() ?? ''

      console.log('[钉钉 Bridge] 收到消息:', {
        msgId: msg.headers.messageId,
        senderNick: data.senderNick,
        text: text.length > 100 ? text.slice(0, 100) + '...' : text,
        conversationType: data.conversationType,
      })

      if (!text) return

      // 缓存 webhook 供后续回复使用
      const chatId = data.conversationId
      cacheWebhook(chatId, data.sessionWebhook)

      // 委托给通用命令处理器
      this.commandHandler.handleIncomingMessage(chatId, text, {
        sessionWebhook: data.sessionWebhook,
      }).catch((error) => {
        console.error('[钉钉 Bridge] 处理消息失败:', error)
      })
    } catch (error) {
      console.error('[钉钉 Bridge] 解析消息失败:', error, msg.data)
    }
  }

  /** 更新状态并推送到渲染进程 */
  private updateStatus(partial: Partial<DingTalkBridgeState>): void {
    this.state = { ...this.state, ...partial }
    // 推送到所有渲染进程窗口
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, this.state)
      }
    }
  }
}

export const dingtalkBridge = new DingTalkBridge()
