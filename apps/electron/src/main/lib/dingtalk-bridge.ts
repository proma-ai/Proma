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
import { BridgeCommandHandler, type BridgeAttachment } from './bridge-command-handler'
import { inferImageMediaType, saveImageToSession, inferExtension, MAX_IMAGE_SIZE } from './bridge-attachment-utils'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getSettings } from './settings-service'

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
  /** msgtype === 'picture' 时使用 */
  content?: { downloadCode?: string; pictureDownloadCode?: string }
  /** msgtype === 'richText' 时使用 */
  richText?: {
    richText?: Array<{
      text?: string
      type?: string
      downloadCode?: string
      pictureDownloadCode?: string
    }>
  }
  senderNick: string
  senderId: string
  conversationId: string
  conversationType: '1' | '2'  // 1=单聊, 2=群聊
  sessionWebhook: string
  sessionWebhookExpiredTime: number
  /** 机器人标识，用于图片下载 API */
  robotCode?: string
}

interface DingTalkImageAttachment {
  id: string
  data: Buffer
  mediaType: string
}

// ===== Bridge 实例 =====

class DingTalkBridge {
  private client: DWClientInstance | null = null
  private state: DingTalkBridgeState = { status: 'disconnected' }

  /** 每个实例独立的 webhook 缓存 */
  private webhookCache = new Map<string, string>()
  private readonly MAX_WEBHOOK_CACHE = 200

  /** 消息处理队列（串行化，避免同一 chatId 并发创建 session） */
  private messageQueue: Promise<void> = Promise.resolve()

  /** 图片缓冲（纯图片消息等待文字触发） */
  private pendingImages = new Map<string, { images: DingTalkImageAttachment[]; createdAt: number }>()
  private static readonly PENDING_IMAGES_TTL = 10 * 60 * 1000 // 10 minutes
  private static readonly PENDING_IMAGES_MAX = 20
  private pendingImagesCleanupTimer: ReturnType<typeof setInterval> | null = null

  /** access_token 缓存 */
  private accessToken: { value: string; expiresAt: number } | null = null

  /** Bot 配置（构造时传入，workspace 切换时同步更新） */
  botConfig: DingTalkBotConfig

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
      onWorkspaceSwitched: async (workspaceId) => {
        const { saveDingTalkBotConfig } = await import('./dingtalk-config')
        saveDingTalkBotConfig({
          id: this.botConfig.id,
          name: this.botConfig.name,
          enabled: this.botConfig.enabled,
          clientId: this.botConfig.clientId,
          clientSecret: '',
          defaultWorkspaceId: workspaceId,
        })
        this.botConfig = { ...this.botConfig, defaultWorkspaceId: workspaceId }
      },
    })
  }

  /** 更新 Bot 配置（重连时复用实例，避免丢失 chatBindings） */
  updateConfig(botConfig: DingTalkBotConfig): void {
    this.botConfig = botConfig
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
      this.pendingImagesCleanupTimer = setInterval(() => this.cleanExpiredPendingImages(), 20 * 60 * 1000)

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
    if (this.pendingImagesCleanupTimer) {
      clearInterval(this.pendingImagesCleanupTimer)
      this.pendingImagesCleanupTimer = null
    }
    this.pendingImages.clear()
    this.messageQueue = Promise.resolve()
    this.accessToken = null
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

  /** 处理机器人消息（串行排队，避免并发竞争） */
  private handleRobotMessage(msg: DWClientDownStream): void {
    this.messageQueue = this.messageQueue
      .then(() => this.processRobotMessage(msg))
      .catch((error) => {
        console.error(`[钉钉 Bridge/${this.botConfig.name}] 处理消息失败:`, error)
      })
  }

  private cleanExpiredPendingImages(): void {
    const now = Date.now()
    for (const [chatId, entry] of this.pendingImages) {
      if (now - entry.createdAt > DingTalkBridge.PENDING_IMAGES_TTL) {
        console.log(`[钉钉 Bridge/${this.botConfig.name}] 清理过期图片缓冲: ${chatId.slice(0, 8)}... (${entry.images.length} 张)`)
        this.pendingImages.delete(chatId)
      }
    }
  }

  private async processRobotMessage(msg: DWClientDownStream): Promise<void> {
    let data: DingTalkRobotMessage
    try {
      data = JSON.parse(msg.data) as DingTalkRobotMessage
    } catch (error) {
      console.error(`[钉钉 Bridge/${this.botConfig.name}] 解析消息失败:`, error, msg.data)
      return
    }

    const chatId = data.conversationId
    const ctx = { sessionWebhook: data.sessionWebhook }
    this.cacheWebhook(chatId, data.sessionWebhook)

    // 根据 msgtype 提取文本 + 图片下载码
    let text = ''
    const downloadCodes: string[] = []

    if (data.msgtype === 'text') {
      text = data.text?.content?.trim() ?? ''
    } else if (data.msgtype === 'picture') {
      const code = data.content?.downloadCode || data.content?.pictureDownloadCode
      if (code) downloadCodes.push(code)
    } else if (data.msgtype === 'richText') {
      for (const node of data.richText?.richText ?? []) {
        if (node.text) text += node.text
        const code = node.downloadCode || node.pictureDownloadCode
        if (node.type === 'picture' && code) downloadCodes.push(code)
      }
      text = text.trim()
    } else {
      console.log(`[钉钉 Bridge/${this.botConfig.name}] 跳过不支持的消息类型: ${data.msgtype}`)
      return
    }

    console.log(`[钉钉 Bridge/${this.botConfig.name}] 收到消息:`, {
      msgId: msg.headers.messageId,
      senderNick: data.senderNick,
      text: text.length > 100 ? text.slice(0, 100) + '...' : text,
      imageCount: downloadCodes.length,
      conversationType: data.conversationType,
    })

    // 下载图片（使用消息中的 robotCode，而非 clientId）
    const robotCode = data.robotCode || this.botConfig.clientId
    const downloads: DingTalkImageAttachment[] = []
    for (let idx = 0; idx < downloadCodes.length; idx++) {
      try {
        const buf = await this.downloadDingTalkImage(downloadCodes[idx]!, robotCode)
        const mediaType = inferImageMediaType(buf)
        if (buf.length > MAX_IMAGE_SIZE) {
          console.warn(`[钉钉 Bridge/${this.botConfig.name}] 图片较大: ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
        }
        downloads.push({ id: `${msg.headers.messageId}-${idx}`, data: buf, mediaType })
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        console.error(`[钉钉 Bridge/${this.botConfig.name}] 图片下载失败:`, errMsg)
        await this.replyTextViaWebhook(data.sessionWebhook, '⚠️ 一张图片下载失败，已跳过')
      }
    }

    if (!text && downloads.length === 0) return

    // 清理过期缓冲
    this.cleanExpiredPendingImages()

    // 纯图片 → 缓冲，等待文字触发
    if (!text && downloads.length > 0) {
      const entry = this.pendingImages.get(chatId)
      const existing = entry ? entry.images : []
      const merged = [...existing, ...downloads].slice(-DingTalkBridge.PENDING_IMAGES_MAX)
      this.pendingImages.set(chatId, { images: merged, createdAt: entry?.createdAt ?? Date.now() })
      await this.replyTextViaWebhook(
        data.sessionWebhook,
        `📎 已收到 ${merged.length} 张图片，请继续发送文字消息以触发处理。`,
      )
      return
    }

    // 文字消息：合并缓冲
    const pendingEntry = this.pendingImages.get(chatId)
    const pending = pendingEntry ? pendingEntry.images : []
    const allImages = [...pending, ...downloads]
    this.pendingImages.delete(chatId)

    if (allImages.length === 0) {
      await this.commandHandler.handleIncomingMessage(chatId, text, ctx)
      return
    }

    // 命令消息携带图片：把图片放回缓冲，仅处理命令
    if (text.startsWith('/')) {
      this.pendingImages.set(chatId, { images: allImages, createdAt: Date.now() })
      await this.commandHandler.handleIncomingMessage(chatId, text, ctx)
      return
    }

    // 有图片：先检查 session 是否正在运行，避免保存图片后消息被拦截
    if (this.commandHandler.isSessionActive(chatId)) {
      this.pendingImages.set(chatId, { images: allImages, createdAt: Date.now() })
      await this.replyTextViaWebhook(data.sessionWebhook, '❌ 上一条消息仍在处理中，图片已暂存，请稍候再试')
      return
    }

    // 先验证 workspace 是否有效，避免 ensureBinding 创建孤儿 binding
    const preCheckWorkspaceId = this.botConfig.defaultWorkspaceId ?? getSettings().agentWorkspaceId ?? ''
    if (!preCheckWorkspaceId || !getAgentWorkspace(preCheckWorkspaceId)) {
      await this.replyTextViaWebhook(data.sessionWebhook, '⚠️ 当前未设置工作区，无法保存图片')
      return
    }

    const binding = this.commandHandler.ensureBinding(chatId)
    if (!binding) {
      await this.replyTextViaWebhook(data.sessionWebhook, '请先在 Proma 设置中选择 Agent 渠道。')
      return
    }
    const workspace = getAgentWorkspace(binding.workspaceId)
    if (!workspace) {
      await this.replyTextViaWebhook(data.sessionWebhook, '⚠️ 当前未设置工作区，无法保存图片')
      return
    }

    const attachments: BridgeAttachment[] = allImages.map((img) => {
      const hint = `dingtalk-${img.id}`
      const absolutePath = saveImageToSession(
        workspace.slug,
        binding.sessionId,
        hint,
        img.mediaType,
        img.data,
      )
      const label = `${hint}.${inferExtension(img.mediaType)}`
      return { absolutePath, label, kind: 'image' as const }
    })

    await this.commandHandler.handleIncomingMessage(chatId, text, ctx, attachments)
  }

  /** 通过 sessionWebhook 发送纯文本（用于提示/警告） */
  private async replyTextViaWebhook(webhook: string, text: string): Promise<void> {
    try {
      const resp = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
      })
      if (!resp.ok) {
        console.warn(`[钉钉 Bridge/${this.botConfig.name}] webhook 回复失败: HTTP ${resp.status}`)
      }
    } catch (error) {
      console.error(`[钉钉 Bridge/${this.botConfig.name}] webhook 发送失败:`, error)
    }
  }

  /** 获取 access_token（带缓存，过期前 5 分钟刷新） */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt) {
      return this.accessToken.value
    }
    const secret = getDecryptedBotClientSecret(this.botConfig.id)
    const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.botConfig.clientId,
        appSecret: secret,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`获取 access_token 失败: HTTP ${resp.status} ${body}`)
    }
    const data = await resp.json() as { accessToken: string; expireIn?: number; expiresIn?: number }
    const expireSeconds = data.expireIn ?? data.expiresIn ?? 7200
    this.accessToken = {
      value: data.accessToken,
      expiresAt: Date.now() + Math.max(60, expireSeconds - 300) * 1000,
    }
    return data.accessToken
  }

  /** 通过 downloadCode 下载钉钉图片 */
  private async downloadDingTalkImage(downloadCode: string, robotCode: string): Promise<Buffer> {
    const token = await this.getAccessToken()
    const resp = await fetch('https://api.dingtalk.com/v1.0/robot/messageFiles/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify({
        downloadCode,
        robotCode,
      }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`换取下载 URL 失败: HTTP ${resp.status} ${body}`)
    }
    const { downloadUrl } = await resp.json() as { downloadUrl: string }
    if (!downloadUrl) throw new Error('钉钉返回空 downloadUrl')
    const bin = await fetch(downloadUrl)
    if (!bin.ok) throw new Error(`下载图片失败: HTTP ${bin.status}`)
    return Buffer.from(await bin.arrayBuffer())
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
