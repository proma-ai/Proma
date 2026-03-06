/**
 * 飞书 Bridge 服务
 *
 * 核心职责：
 * - 通过 WebSocket 长连接接收飞书消息
 * - 路由命令或转发用户消息到 Agent/Chat 服务
 * - 监听 AgentEventBus 事件，累积完整回复后发送到飞书
 * - 管理聊天绑定（chatId ↔ sessionId）
 * - 智能通知路由：桌面发起的会话根据在场状态决定是否发飞书通知
 */

import { BrowserWindow } from 'electron'
import type {
  AgentEvent,
  AgentSendInput,
  FeishuBridgeState,
  FeishuChatBinding,
  FeishuTestResult,
  FeishuNotifyMode,
  FeishuNotificationSentPayload,
} from '@proma/shared'
import { FEISHU_IPC_CHANNELS, AGENT_IPC_CHANNELS } from '@proma/shared'
import { getFeishuConfig, getDecryptedAppSecret } from './feishu-config'
import { agentEventBus, runAgentHeadless, stopAgent } from './agent-service'
import { createAgentSession, listAgentSessions, getAgentSessionMeta } from './agent-session-manager'
import { listAgentWorkspaces, getAgentWorkspace } from './agent-workspace-manager'
import { getSettings } from './settings-service'
import { presenceService } from './feishu-presence'
import {
  buildAgentReplyCard,
  buildNotificationCard,
  buildErrorCard,
  buildSessionListCard,
  buildWorkspaceSwitchedCard,
  buildWorkspaceListCard,
  buildHelpCard,
  accumulateToolSummary,
  splitLongContent,
} from './feishu-message'
import type { ToolSummary, FormattedAgentResult, WorkspaceListItem } from './feishu-message'

// ===== 类型定义 =====

/** 会话累积缓冲 */
interface SessionBuffer {
  text: string
  toolSummaries: Map<string, ToolSummary>
  startedAt: number
}

// ===== 单例 Bridge =====

class FeishuBridge {
  /** SDK Client（发消息用） */
  private client: InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null = null
  /** WebSocket Client */
  private wsClient: InstanceType<typeof import('@larksuiteoapi/node-sdk').WSClient> | null = null

  /** 连接状态 */
  private status: FeishuBridgeState = { status: 'disconnected', activeBindings: 0 }

  /** chatId → 绑定信息 */
  private chatBindings = new Map<string, FeishuChatBinding>()
  /** sessionId → chatId（反向索引） */
  private sessionToChat = new Map<string, string>()
  /** sessionId → 文本累积缓冲 */
  private sessionBuffers = new Map<string, SessionBuffer>()
  /** sessionId → 通知模式 */
  private sessionNotifyModes = new Map<string, FeishuNotifyMode>()
  /** 默认通知目标 chatId（最后一个与 Bot 交互的飞书聊天） */
  private defaultNotifyChatId: string | null = null

  /** 消息去重（防止 SDK WebSocket 重复投递） */
  private recentMessageIds = new Set<string>()
  /** 事件去重（防止网关超时重投） */
  private recentEventIds = new Set<string>()
  /** chatId 级处理锁（防止 bot 回复触发的事件重入） */
  private processingChats = new Set<string>()
  private static readonly DEDUP_MAX = 200

  /** EventBus 监听器取消函数 */
  private eventBusUnsubscribe: (() => void) | null = null

  // ===== 生命周期 =====

  async start(): Promise<void> {
    const config = getFeishuConfig()
    if (!config.enabled || !config.appId || !config.appSecret) {
      console.log('[飞书 Bridge] 未配置或未启用，跳过启动')
      return
    }

    this.updateStatus({ status: 'connecting' })

    try {
      const appSecret = getDecryptedAppSecret()
      const lark = await import('@larksuiteoapi/node-sdk')

      // 创建 SDK Client
      this.client = new lark.Client({
        appId: config.appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
      })

      // 创建事件分发器
      // 重要：回调必须立即返回，不能 await 长时间操作
      // SDK 需要回调返回后发送 ACK 给飞书网关，否则网关会超时重投事件
      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': (data: Record<string, unknown>) => {
          this.handleFeishuMessage(data).catch((error) => {
            console.error('[飞书 Bridge] 处理消息异常:', error)
          })
        },
      })

      // 创建 WebSocket 长连接
      this.wsClient = new lark.WSClient({
        appId: config.appId,
        appSecret,
        loggerLevel: lark.LoggerLevel.warn,
      })

      await this.wsClient.start({ eventDispatcher })

      // 注册 EventBus 监听器
      this.eventBusUnsubscribe = agentEventBus.on((sessionId, event) => {
        this.handleAgentEvent(sessionId, event)
      })

      this.updateStatus({ status: 'connected', connectedAt: Date.now() })
      console.log('[飞书 Bridge] 已连接')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage: message })
      console.error('[飞书 Bridge] 启动失败:', error)
    }
  }

  stop(): void {
    // 取消 EventBus 监听
    this.eventBusUnsubscribe?.()
    this.eventBusUnsubscribe = null

    // 清理 WebSocket
    if (this.wsClient) {
      // SDK WSClient 没有显式的 stop 方法，清空引用让 GC 回收
      this.wsClient = null
    }
    this.client = null

    // 清理状态
    this.chatBindings.clear()
    this.sessionToChat.clear()
    this.sessionBuffers.clear()
    this.sessionNotifyModes.clear()
    this.recentMessageIds.clear()
    this.recentEventIds.clear()
    this.processingChats.clear()
    this.defaultNotifyChatId = null

    this.updateStatus({ status: 'disconnected', activeBindings: 0 })
    console.log('[飞书 Bridge] 已停止')
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  // ===== 状态查询 =====

  getStatus(): FeishuBridgeState {
    return { ...this.status }
  }

  listBindings(): FeishuChatBinding[] {
    return Array.from(this.chatBindings.values())
  }

  setSessionNotifyMode(sessionId: string, mode: FeishuNotifyMode): void {
    this.sessionNotifyModes.set(sessionId, mode)
  }

  // ===== 连接测试 =====

  async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
    try {
      const lark = await import('@larksuiteoapi/node-sdk')
      const client = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
      })

      // 通过获取 tenant_access_token 来验证凭证
      const resp = await client.auth.tenantAccessToken.internal({
        data: {
          app_id: appId,
          app_secret: appSecret,
        },
      })

      if (resp.code === 0) {
        return {
          success: true,
          message: '连接成功',
          botName: `App ${appId.slice(0, 8)}...`,
        }
      }

      return {
        success: false,
        message: `飞书 API 错误: ${resp.msg ?? '未知错误'} (code: ${resp.code})`,
      }
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // ===== 飞书消息处理 =====

  private async handleFeishuMessage(data: Record<string, unknown>): Promise<void> {
    if (!this.client) return

    // 事件级去重（飞书网关超时重投时 event_id 相同）
    const eventId = data.event_id as string | undefined
    if (eventId && this.recentEventIds.has(eventId)) {
      console.log('[飞书 Bridge] 跳过重复事件 (event_id):', eventId)
      return
    }
    if (eventId) {
      this.addToDedup(this.recentEventIds, eventId)
    }

    // 解析消息
    const message = (data as { message?: Record<string, unknown> }).message
    if (!message) return

    const sender = (data as { sender?: Record<string, unknown> }).sender

    // 过滤非用户消息（Bot 自己发的消息 sender_type 不是 "user"）
    const senderType = (sender?.sender_type as string) ?? ''
    if (senderType !== 'user') {
      return
    }

    // 消息级去重（同一条消息被不同 event 包裹时 message_id 相同）
    const messageId = message.message_id as string
    if (messageId && this.recentMessageIds.has(messageId)) {
      console.log('[飞书 Bridge] 跳过重复消息 (message_id):', messageId)
      return
    }
    if (messageId) {
      this.addToDedup(this.recentMessageIds, messageId)
    }

    const chatId = message.chat_id as string
    const messageType = message.message_type as string
    const chatType = message.chat_type as string
    const userId = (sender?.sender_id as Record<string, unknown>)?.open_id as string ?? 'unknown'

    // chatId 级处理锁：同一聊天同时只处理一条消息，防止 bot 回复被重入处理
    if (this.processingChats.has(chatId)) {
      console.log('[飞书 Bridge] 跳过重入消息 (chatId lock):', chatId)
      return
    }

    // 群聊中仅处理 @Bot 的消息
    if (chatType === 'group') {
      const mentions = message.mentions as Array<Record<string, unknown>> | undefined
      const hasBotMention = mentions?.some(
        (m) => (m as Record<string, unknown>).id?.toString()?.includes('app_id') ||
               (m as Record<string, unknown>).key !== undefined
      ) ?? false
      if (!hasBotMention && mentions?.length === 0) {
        return
      }
    }

    // 记录最近交互的 chatId 作为默认通知目标
    this.defaultNotifyChatId = chatId

    // 仅处理文本消息
    if (messageType !== 'text') {
      await this.sendTextMessage(chatId, '目前仅支持文本消息。')
      return
    }

    const content = JSON.parse(message.content as string) as { text?: string }
    let text = content.text?.trim() ?? ''

    // 去除 @Bot 的占位符（如 @_user_1）
    text = text.replace(/@_user_\d+/g, '').trim()

    if (!text) return

    // 加锁：防止命令回复触发的事件被重入处理
    this.processingChats.add(chatId)
    try {
      // 命令路由
      if (text.startsWith('/')) {
        await this.handleCommand(chatId, userId, text)
        return
      }

      // 普通文本 → 转发到会话
      await this.handleUserMessage(chatId, userId, text)
    } finally {
      this.processingChats.delete(chatId)
    }
  }

  private async handleCommand(chatId: string, userId: string, text: string): Promise<void> {
    const [command, ...args] = text.split(/\s+/)
    const arg = args.join(' ').trim()

    switch (command?.toLowerCase()) {
      case '/help':
        await this.sendCard(chatId, buildHelpCard())
        break

      case '/new':
        await this.createNewSession(chatId, userId, 'agent', arg || undefined)
        break

      case '/chat':
        await this.updateBindingMode(chatId, userId, 'chat')
        break

      case '/agent':
        await this.updateBindingMode(chatId, userId, 'agent')
        break

      case '/list':
        await this.handleListCommand(chatId, userId)
        break

      case '/stop':
        await this.handleStopCommand(chatId)
        break

      case '/switch': {
        if (!arg) {
          await this.sendTextMessage(chatId, '用法: /switch <序号>（先用 /list 查看）')
          return
        }
        await this.handleSwitchCommand(chatId, userId, arg)
        break
      }

      case '/workspace': {
        await this.handleWorkspaceCommand(chatId, userId, arg || undefined)
        break
      }

      default:
        await this.sendTextMessage(chatId, `未知命令: ${command}。输入 /help 查看帮助。`)
    }
  }

  // ===== 会话管理 =====

  private async createNewSession(
    chatId: string,
    userId: string,
    mode: 'agent' | 'chat',
    title?: string,
    overrideWorkspaceId?: string,
  ): Promise<void> {
    const config = getFeishuConfig()
    const appSettings = getSettings()

    // 选择工作区：显式指定 > 飞书配置 > 应用设置 > 第一个工作区
    let workspaceId = overrideWorkspaceId ?? config.defaultWorkspaceId ?? appSettings.agentWorkspaceId
    if (!workspaceId) {
      const workspaces = await listAgentWorkspaces()
      workspaceId = workspaces[0]?.id
    }

    if (!workspaceId) {
      await this.sendTextMessage(chatId, '请先在 Proma 设置中创建工作区。')
      return
    }

    // 渠道/模型：直接复用 Proma 应用当前设置
    const channelId = appSettings.agentChannelId
    if (!channelId) {
      await this.sendTextMessage(chatId, '请先在 Proma Agent 设置中选择渠道。')
      return
    }

    // 创建会话（使用默认标题，首次对话完成后会自动生成标题）
    const session = await createAgentSession(
      title,
      channelId,
      workspaceId,
    )

    // 绑定
    const binding: FeishuChatBinding = {
      chatId,
      userId,
      sessionId: session.id,
      workspaceId,
      channelId,
      modelId: appSettings.agentModelId ?? undefined,
      mode,
      createdAt: Date.now(),
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(session.id, chatId)
    this.updateStatus({ activeBindings: this.chatBindings.size })

    // 通知渲染进程刷新会话列表（复用 TITLE_UPDATED 通道触发列表刷新）
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
        sessionId: session.id,
        title: session.title,
      })
    }

    const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
    await this.sendTextMessage(chatId, `✅ 已创建 ${modeLabel} 会话 (${session.id.slice(0, 8)})`)
  }

  private async updateBindingMode(chatId: string, _userId: string, mode: 'agent' | 'chat'): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    if (binding) {
      binding.mode = mode
      const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
      await this.sendTextMessage(chatId, `已切换到 ${modeLabel} 模式`)
    } else {
      const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
      await this.sendTextMessage(chatId, `当前没有会话。直接发送消息将自动创建 ${modeLabel} 会话，或使用 /new 创建。`)
    }
  }

  private async handleListCommand(chatId: string, _userId: string): Promise<void> {
    const sessions = listAgentSessions()
    const workspaces = listAgentWorkspaces()
    const binding = this.chatBindings.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    // 每个工作区最多展示最近 5 个会话
    const MAX_SESSIONS_PER_WS = 5

    // 为所有会话建立全局序号映射（序号 = 全局排序位置，从 1 开始）
    const sessionIndexMap = new Map<string, number>()
    sessions.forEach((s, i) => sessionIndexMap.set(s.id, i + 1))

    // 按工作区分组
    const wsItems: WorkspaceListItem[] = workspaces.map((ws) => {
      const wsSessions = sessions
        .filter((s) => s.workspaceId === ws.id)
        .slice(0, MAX_SESSIONS_PER_WS)
        .map((s) => ({
          id: s.id,
          title: s.title,
          active: binding?.sessionId === s.id,
          index: sessionIndexMap.get(s.id) ?? 0,
        }))

      return { id: ws.id, name: ws.name, sessions: wsSessions }
    })

    // 未归属工作区的会话
    const orphanSessions = sessions
      .filter((s) => !s.workspaceId || !workspaces.some((w) => w.id === s.workspaceId))
      .slice(0, MAX_SESSIONS_PER_WS)
      .map((s) => ({
        id: s.id,
        title: s.title,
        active: binding?.sessionId === s.id,
        index: sessionIndexMap.get(s.id) ?? 0,
      }))

    if (orphanSessions.length > 0) {
      wsItems.push({ id: '', name: '未分配工作区', sessions: orphanSessions })
    }

    await this.sendCard(chatId, buildSessionListCard(wsItems, currentWorkspaceId))
  }

  private async handleStopCommand(chatId: string): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    if (!binding) {
      await this.sendTextMessage(chatId, '当前没有绑定的会话。')
      return
    }

    stopAgent(binding.sessionId)
    await this.sendTextMessage(chatId, '✅ 已停止 Agent')
  }

  private async handleSwitchCommand(chatId: string, userId: string, arg: string): Promise<void> {
    const sessions = listAgentSessions()

    // 支持序号（如 /switch 1）和 ID 前缀两种方式
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= sessions.length
      ? sessions[index - 1]
      : sessions.find((s) => s.id.startsWith(arg))

    if (!match) {
      await this.sendTextMessage(chatId, `未找到会话。使用 /list 查看可用会话。`)
      return
    }

    // 清理旧绑定的反向索引
    const oldBinding = this.chatBindings.get(chatId)
    if (oldBinding) {
      this.sessionToChat.delete(oldBinding.sessionId)
    }

    const appSettings = getSettings()
    const config = getFeishuConfig()
    const binding: FeishuChatBinding = {
      chatId,
      userId,
      sessionId: match.id,
      workspaceId: match.workspaceId ?? config.defaultWorkspaceId ?? appSettings.agentWorkspaceId ?? '',
      channelId: match.channelId ?? appSettings.agentChannelId ?? '',
      modelId: appSettings.agentModelId ?? undefined,
      mode: 'agent',
      createdAt: Date.now(),
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(match.id, chatId)
    this.updateStatus({ activeBindings: this.chatBindings.size })

    await this.sendTextMessage(chatId, `✅ 已切换到会话: ${match.title} (${match.id.slice(0, 8)})`)
  }

  private async handleWorkspaceCommand(chatId: string, _userId: string, arg?: string): Promise<void> {
    const workspaces = listAgentWorkspaces()
    const binding = this.chatBindings.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    // 无参数 → 列出所有工作区供选择
    if (!arg) {
      const items = workspaces.map((w, i) => ({
        index: i + 1,
        name: w.name,
        isCurrent: w.id === currentWorkspaceId,
      }))
      await this.sendCard(chatId, buildWorkspaceListCard(items))
      return
    }

    // 支持序号（如 /workspace 1）和名称两种方式
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= workspaces.length
      ? workspaces[index - 1]
      : workspaces.find(
          (w) => w.name.toLowerCase() === arg.toLowerCase() || w.slug === arg.toLowerCase(),
        )

    if (!match) {
      const available = workspaces.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
      await this.sendTextMessage(chatId, `未找到工作区 "${arg}"。可用: ${available}`)
      return
    }

    // 清理旧绑定（切换工作区后需要用户选择或新建会话）
    if (binding) {
      this.sessionToChat.delete(binding.sessionId)
      this.chatBindings.delete(chatId)
      this.updateStatus({ activeBindings: this.chatBindings.size })
    }

    // 更新飞书配置的默认工作区（下次自动创建会话时使用）
    const { updateFeishuConfigPartial } = await import('./feishu-config')
    updateFeishuConfigPartial({ defaultWorkspaceId: match.id })

    // 列出该工作区下最近 10 条会话（序号为全局排序位置）
    const sessions = listAgentSessions()
    const recentSessions = sessions
      .filter((s) => s.workspaceId === match.id)
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        title: s.title,
        index: sessions.indexOf(s) + 1,
      }))

    await this.sendCard(chatId, buildWorkspaceSwitchedCard(match.name, recentSessions))
  }

  // ===== 用户消息处理 =====

  private async handleUserMessage(chatId: string, userId: string, text: string): Promise<void> {
    let binding = this.chatBindings.get(chatId)

    // 自动创建会话
    if (!binding) {
      await this.createNewSession(chatId, userId, 'agent')
      binding = this.chatBindings.get(chatId)
      if (!binding) return
    }

    // 初始化缓冲
    this.sessionBuffers.set(binding.sessionId, {
      text: '',
      toolSummaries: new Map(),
      startedAt: Date.now(),
    })

    // 发送思考中指示
    const prefix = this.resolveContextPrefix(chatId)
    await this.sendTextMessage(chatId, `${prefix}⏳ Agent 处理中...`)

    if (binding.mode === 'agent') {
      // Agent 模式 — fire-and-forget，不阻塞事件回调
      const input: AgentSendInput = {
        sessionId: binding.sessionId,
        userMessage: text,
        channelId: binding.channelId,
        modelId: binding.modelId,
        workspaceId: binding.workspaceId,
      }

      runAgentHeadless(input, {
        onError: (error) => {
          const errPrefix = this.resolveContextPrefix(chatId)
          this.sendCard(chatId, buildErrorCard(`${errPrefix}${error}`)).catch(console.error)
          this.sessionBuffers.delete(binding!.sessionId)
        },
        onComplete: () => {
          // complete 事件由 EventBus listener 处理
        },
        onTitleUpdated: (_title) => {
          // 标题更新可选通知
        },
      }).catch((error) => {
        console.error('[飞书 Bridge] Agent 运行异常:', error)
      })
    } else {
      // Chat 模式 — TODO: Phase 4 实现
      await this.sendTextMessage(chatId, 'Chat 模式暂未实现，请使用 /agent 切换到 Agent 模式。')
      this.sessionBuffers.delete(binding.sessionId)
    }
  }

  // ===== EventBus 事件处理 =====

  private handleAgentEvent(sessionId: string, event: AgentEvent): void {
    // 对于飞书发起的会话，缓冲由 handleUserMessage 初始化
    // 对于桌面发起的会话，complete 事件时检查是否需要通知
    const buffer = this.sessionBuffers.get(sessionId)

    if (buffer) {
      if (event.type === 'text_delta') {
        buffer.text += event.text
      }
      accumulateToolSummary(buffer.toolSummaries, event)
    }

    if (event.type === 'complete') {
      if (buffer) {
        // 飞书发起的会话 → 发送完整回复
        this.handleFeishuSessionComplete(sessionId)
      } else {
        // 桌面发起的会话 → 检查是否需要发送通知
        this.handleDesktopSessionComplete(sessionId)
      }
    } else if (event.type === 'error') {
      const chatId = this.sessionToChat.get(sessionId)
      if (chatId) {
        const prefix = this.resolveContextPrefix(chatId)
        this.sendCard(chatId, buildErrorCard(`${prefix}${event.message}`)).catch(console.error)
      }
      this.sessionBuffers.delete(sessionId)
    }
  }

  /** 飞书发起的会话完成：发送完整回复到飞书 */
  private handleFeishuSessionComplete(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId)
    if (!buffer) return

    const duration = (Date.now() - buffer.startedAt) / 1000
    const toolSummaries = Array.from(buffer.toolSummaries.values())
    const result: FormattedAgentResult = {
      text: buffer.text,
      toolSummaries,
      duration,
    }

    const chatId = this.sessionToChat.get(sessionId)
    if (chatId) {
      this.sendAgentReply(chatId, result).catch(console.error)
    }

    this.sessionBuffers.delete(sessionId)
  }

  /**
   * 桌面发起的会话完成：根据通知模式和在场状态决定是否发飞书通知
   *
   * - off → 不发
   * - always → 发
   * - auto → 用户不在场时才发
   */
  private handleDesktopSessionComplete(sessionId: string): void {
    if (!this.client || !this.defaultNotifyChatId) return

    const mode = this.sessionNotifyModes.get(sessionId) ?? 'auto'

    if (mode === 'off') return
    if (mode === 'auto' && presenceService.isUserPresent(sessionId)) return

    // 需要发通知 → 发送简短通知卡片
    this.sendDesktopNotification(sessionId).catch(console.error)
  }

  /** 向飞书发送桌面会话完成通知，并通知渲染进程 */
  private async sendDesktopNotification(sessionId: string): Promise<void> {
    if (!this.defaultNotifyChatId) return

    // 获取会话标题
    const sessions = await listAgentSessions()
    const session = sessions.find((s) => s.id === sessionId)
    const title = session?.title ?? '未命名会话'
    const preview = '任务已完成，请在 Proma 中查看详情。'

    // 发送通知卡片到飞书
    const card = buildNotificationCard(title, preview, [], 0)
    await this.sendCard(this.defaultNotifyChatId, card)

    // 通知渲染进程（用于 Sonner toast + 桌面通知）
    const payload: FeishuNotificationSentPayload = {
      sessionId,
      sessionTitle: title,
      preview,
    }
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(FEISHU_IPC_CHANNELS.NOTIFICATION_SENT, payload)
    }
  }

  private async sendAgentReply(chatId: string, result: FormattedAgentResult): Promise<void> {
    const prefix = this.resolveContextPrefix(chatId)

    if (!result.text.trim()) {
      await this.sendTextMessage(chatId, `${prefix}✅ Agent 已完成（无文本输出）`)
      return
    }

    // 在正文前追加上下文前缀
    const prefixedResult: FormattedAgentResult = {
      ...result,
      text: `${prefix}\n${result.text}`,
    }
    const chunks = splitLongContent(prefixedResult.text)

    if (chunks.length === 1) {
      // 单条卡片
      await this.sendCard(chatId, buildAgentReplyCard(prefixedResult))
    } else {
      // 多条消息
      for (let i = 0; i < chunks.length; i++) {
        const chunkResult: FormattedAgentResult = {
          text: chunks[i]!,
          toolSummaries: i === chunks.length - 1 ? result.toolSummaries : [],
          duration: i === chunks.length - 1 ? result.duration : 0,
        }
        await this.sendCard(chatId, buildAgentReplyCard(chunkResult))
      }
    }
  }

  // ===== 飞书 API =====

  /** 向去重集合添加 ID，保持集合大小不超过上限 */
  private addToDedup(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size > FeishuBridge.DEDUP_MAX) {
      const first = set.values().next().value as string
      set.delete(first)
    }
  }

  /**
   * 解析消息上下文前缀：[工作区名称]->[会话名称]：
   *
   * 用于在每条回复的飞书消息开头标注来源，方便用户区分。
   */
  private resolveContextPrefix(chatId: string): string {
    const binding = this.chatBindings.get(chatId)
    if (!binding) return ''

    const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    const session = getAgentSessionMeta(binding.sessionId)

    const wsName = workspace?.name ?? '默认工作区'
    const sessName = session?.title ?? binding.sessionId.slice(0, 8)

    return `[${wsName}]->[${sessName}]：`
  }

  private async sendTextMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })
      // 将 Bot 发出的消息 ID 加入去重集合，防止回环
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 发送文本消息失败:', error)
    }
  }

  private async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      })
      // 将 Bot 发出的消息 ID 加入去重集合，防止回环
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 发送卡片消息失败:', error)
    }
  }

  // ===== 状态更新与广播 =====

  private updateStatus(partial: Partial<FeishuBridgeState>): void {
    this.status = { ...this.status, ...partial }

    // 广播到渲染进程
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(FEISHU_IPC_CHANNELS.STATUS_CHANGED, this.status)
    }
  }
}

// ===== 导出单例 =====

export const feishuBridge = new FeishuBridge()
