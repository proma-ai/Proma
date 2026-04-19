/**
 * 通用 Bridge 命令处理器
 *
 * 为微信、钉钉等平台提供统一的斜杠命令和 Agent 消息路由。
 * 各平台通过 BridgePlatformAdapter 接入，只需实现发送文本的方法。
 *
 * 飞书 Bridge 使用独立的卡片消息格式，暂不接入此模块。
 */

import { BrowserWindow } from 'electron'
import type { AgentStreamPayload } from '@proma/shared'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import { createAgentSession, listAgentSessions, getAgentSessionMeta } from './agent-session-manager'
import {
  listAgentWorkspacesByUpdatedAt,
  getAgentWorkspace,
  getWorkspaceCapabilities,
} from './agent-workspace-manager'
import { runAgentHeadless, agentEventBus, stopAgent, isAgentSessionActive } from './agent-service'
import { getSettings } from './settings-service'
import { getAgentWorkspacePath } from './config-paths'
import { readdirSync } from 'node:fs'

// ===== 接口定义 =====

/** 平台适配器 — 各 Bridge 只需实现此接口 */
export interface BridgePlatformAdapter {
  /** 发送纯文本回复。meta 是平台专属的上下文数据（如微信的 contextToken） */
  sendText(chatId: string, text: string, meta?: unknown): Promise<void>
}

/** 命令处理器配置 */
export interface BridgeCommandHandlerConfig {
  /** 平台名称，用于日志（如 '微信', '钉钉'） */
  platformName: string
  /** 平台适配器 */
  adapter: BridgePlatformAdapter
  /** 获取默认工作区 ID */
  getDefaultWorkspaceId?: () => string | undefined
  /** 工作区切换后的回调 */
  onWorkspaceSwitched?: (workspaceId: string) => void
}

/** 通用聊天绑定 */
export interface BridgeChatBinding {
  chatId: string
  sessionId: string
  workspaceId: string
  channelId: string
  modelId?: string
  mode: 'agent' | 'chat'
}

/** Agent 回复缓冲 */
interface SessionBuffer {
  text: string
  chatId: string
  contextData: unknown
  startedAt: number
}

/** Agent SDK 消息中的内容块 */
interface ContentBlock {
  type: string
  text?: string
}

/** Agent SDK assistant 消息结构 */
interface AssistantMessagePayload {
  message?: {
    content?: ContentBlock[]
  }
}

// ===== 命令处理器实现 =====

export class BridgeCommandHandler {
  private readonly config: BridgeCommandHandlerConfig
  private readonly log: (msg: string) => void

  /** chatId → 聊天绑定 */
  private chatBindings = new Map<string, BridgeChatBinding>()
  /** sessionId → chatId（反向索引） */
  private sessionToChat = new Map<string, string>()
  /** sessionId → 回复缓冲 */
  private sessionBuffers = new Map<string, SessionBuffer>()
  /** EventBus 取消订阅 */
  private eventBusUnsubscribe: (() => void) | null = null

  constructor(config: BridgeCommandHandlerConfig) {
    this.config = config
    this.log = (msg: string) => console.log(`[${config.platformName} Bridge] ${msg}`)
  }

  // ===== 公开 API =====

  /** 处理收到的消息（自动区分命令 vs 普通消息） */
  async handleIncomingMessage(chatId: string, text: string, contextData?: unknown): Promise<void> {
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text, contextData)
    } else {
      await this.handleUserMessage(chatId, text, contextData)
    }
  }

  /** 订阅 Agent EventBus（Bridge 连接建立后调用） */
  subscribe(): void {
    this.eventBusUnsubscribe?.()
    this.eventBusUnsubscribe = agentEventBus.on((sessionId, payload) => {
      this.handleAgentPayload(sessionId, payload)
    })
  }

  /** 取消订阅（Bridge 断开时调用） */
  unsubscribe(): void {
    this.eventBusUnsubscribe?.()
    this.eventBusUnsubscribe = null
    this.sessionBuffers.clear()
  }

  /** 获取聊天绑定 */
  getBinding(chatId: string): BridgeChatBinding | undefined {
    return this.chatBindings.get(chatId)
  }

  /** 清理所有状态 */
  clear(): void {
    this.chatBindings.clear()
    this.sessionToChat.clear()
    this.sessionBuffers.clear()
  }

  // ===== 命令路由 =====

  private async handleCommand(chatId: string, text: string, contextData?: unknown): Promise<void> {
    const [command, ...args] = text.split(/\s+/)
    const arg = args.join(' ').trim()

    switch (command?.toLowerCase()) {
      case '/help':
        await this.sendHelp(chatId, contextData)
        break

      case '/new':
        await this.createNewSession(chatId, arg || undefined, contextData)
        break

      case '/chat':
        await this.updateBindingMode(chatId, 'chat', contextData)
        break

      case '/agent':
        await this.updateBindingMode(chatId, 'agent', contextData)
        break

      case '/list':
        await this.handleListCommand(chatId, contextData)
        break

      case '/stop':
        await this.handleStopCommand(chatId, contextData)
        break

      case '/switch':
        if (!arg) {
          await this.send(chatId, '用法: /switch <序号>（先用 /list 查看）', contextData)
          return
        }
        await this.handleSwitchCommand(chatId, arg, contextData)
        break

      case '/workspace':
        await this.handleWorkspaceCommand(chatId, arg || undefined, contextData)
        break

      case '/now':
        await this.handleNowCommand(chatId, contextData)
        break

      default:
        await this.send(chatId, `未知命令: ${command}。输入 /help 查看帮助。`, contextData)
    }
  }

  // ===== 命令实现 =====

  private async sendHelp(chatId: string, contextData?: unknown): Promise<void> {
    const lines = [
      '📋 可用命令:',
      '',
      '/help — 显示此帮助',
      '/new [标题] — 创建新 Agent 会话',
      '/list — 列出所有会话',
      '/switch <序号> — 切换到指定会话',
      '/stop — 停止当前 Agent',
      '/workspace [名称] — 查看或切换工作区',
      '/agent — 切换到 Agent 模式',
      '/chat — 切换到 Chat 模式',
      '/now — 查看当前状态',
    ]
    await this.send(chatId, lines.join('\n'), contextData)
  }

  private async createNewSession(chatId: string, title?: string, contextData?: unknown): Promise<void> {
    const settings = getSettings()
    const channelId = settings.agentChannelId
    if (!channelId) {
      await this.send(chatId, '请先在 Proma 设置中选择 Agent 渠道。', contextData)
      return
    }

    // 确定工作区
    const workspaceId = this.config.getDefaultWorkspaceId?.() ?? settings.agentWorkspaceId ?? ''

    const session = createAgentSession(
      title || '新会话',
      channelId,
      workspaceId || undefined,
    )

    // 清理旧绑定
    const oldBinding = this.chatBindings.get(chatId)
    if (oldBinding) {
      this.sessionToChat.delete(oldBinding.sessionId)
    }

    const binding: BridgeChatBinding = {
      chatId,
      sessionId: session.id,
      workspaceId,
      channelId,
      modelId: settings.agentModelId ?? undefined,
      mode: 'agent',
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(session.id, chatId)

    // 通知渲染进程刷新会话列表
    this.notifySessionCreated(session.id, session.title)

    await this.send(chatId, `✅ 已创建 Agent 会话: ${session.title} (${session.id.slice(0, 8)})`, contextData)
  }

  private async updateBindingMode(chatId: string, mode: 'agent' | 'chat', contextData?: unknown): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    if (!binding) {
      await this.send(chatId, '当前没有绑定的会话，发送消息将自动创建。', contextData)
      return
    }
    binding.mode = mode
    const label = mode === 'agent' ? 'Agent' : 'Chat'
    await this.send(chatId, `✅ 已切换到 ${label} 模式`, contextData)
  }

  private async handleListCommand(chatId: string, contextData?: unknown): Promise<void> {
    const sessions = listAgentSessions()
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.chatBindings.get(chatId)

    if (sessions.length === 0) {
      await this.send(chatId, '暂无会话。发送消息将自动创建，或使用 /new 创建。', contextData)
      return
    }

    const MAX_PER_WS = 5
    const lines: string[] = ['📋 会话列表:']

    // 按工作区分组
    for (const ws of workspaces) {
      const wsSessions = sessions
        .filter((s) => s.workspaceId === ws.id)
        .slice(0, MAX_PER_WS)

      if (wsSessions.length === 0) continue

      lines.push('')
      lines.push(`【${ws.name}】`)
      for (const s of wsSessions) {
        const globalIdx = sessions.indexOf(s) + 1
        const marker = binding?.sessionId === s.id ? ' ← 当前' : ''
        lines.push(`  ${globalIdx}. ${s.title} (${s.id.slice(0, 8)})${marker}`)
      }
    }

    // 未归属工作区的会话
    const orphans = sessions
      .filter((s) => !s.workspaceId || !workspaces.some((w) => w.id === s.workspaceId))
      .slice(0, MAX_PER_WS)

    if (orphans.length > 0) {
      lines.push('')
      lines.push('【未分配工作区】')
      for (const s of orphans) {
        const globalIdx = sessions.indexOf(s) + 1
        const marker = binding?.sessionId === s.id ? ' ← 当前' : ''
        lines.push(`  ${globalIdx}. ${s.title} (${s.id.slice(0, 8)})${marker}`)
      }
    }

    lines.push('')
    lines.push('使用 /switch <序号> 切换会话')

    await this.send(chatId, lines.join('\n'), contextData)
  }

  private async handleStopCommand(chatId: string, contextData?: unknown): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    if (!binding) {
      await this.send(chatId, '当前没有绑定的会话。', contextData)
      return
    }
    stopAgent(binding.sessionId)
    await this.send(chatId, '✅ 已停止 Agent', contextData)
  }

  private async handleSwitchCommand(chatId: string, arg: string, contextData?: unknown): Promise<void> {
    const sessions = listAgentSessions()
    const settings = getSettings()

    // 支持序号和 ID 前缀两种匹配
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= sessions.length
      ? sessions[index - 1]
      : sessions.find((s) => s.id.startsWith(arg))

    if (!match) {
      await this.send(chatId, `未找到会话。使用 /list 查看可用会话。`, contextData)
      return
    }

    // 清理旧绑定
    const oldBinding = this.chatBindings.get(chatId)
    if (oldBinding) {
      this.sessionToChat.delete(oldBinding.sessionId)
    }

    const binding: BridgeChatBinding = {
      chatId,
      sessionId: match.id,
      workspaceId: match.workspaceId ?? this.config.getDefaultWorkspaceId?.() ?? settings.agentWorkspaceId ?? '',
      channelId: match.channelId ?? settings.agentChannelId ?? '',
      modelId: settings.agentModelId ?? undefined,
      mode: 'agent',
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(match.id, chatId)

    await this.send(chatId, `✅ 已切换到会话: ${match.title} (${match.id.slice(0, 8)})`, contextData)
  }

  private async handleWorkspaceCommand(chatId: string, arg?: string, contextData?: unknown): Promise<void> {
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.chatBindings.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    // 无参数 → 列出
    if (!arg) {
      if (workspaces.length === 0) {
        await this.send(chatId, '暂无工作区。', contextData)
        return
      }
      const lines = ['📋 工作区列表:']
      workspaces.forEach((w, i) => {
        const marker = w.id === currentWorkspaceId ? ' ← 当前' : ''
        lines.push(`  ${i + 1}. ${w.name}${marker}`)
      })
      lines.push('')
      lines.push('使用 /workspace <序号或名称> 切换')
      await this.send(chatId, lines.join('\n'), contextData)
      return
    }

    // 支持序号和名称匹配
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= workspaces.length
      ? workspaces[index - 1]
      : workspaces.find(
          (w) => w.name.toLowerCase() === arg.toLowerCase() || w.slug === arg.toLowerCase(),
        )

    if (!match) {
      const available = workspaces.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
      await this.send(chatId, `未找到工作区 "${arg}"。可用: ${available}`, contextData)
      return
    }

    // 清理旧绑定（切换工作区后需要新建会话）
    if (binding) {
      this.sessionToChat.delete(binding.sessionId)
      this.chatBindings.delete(chatId)
    }

    // 通知平台持久化
    this.config.onWorkspaceSwitched?.(match.id)

    // 列出该工作区下最近会话
    const sessions = listAgentSessions()
    const recentSessions = sessions
      .filter((s) => s.workspaceId === match.id)
      .slice(0, 5)

    const lines = [`✅ 已切换到工作区: ${match.name}`]
    if (recentSessions.length > 0) {
      lines.push('')
      lines.push('最近会话:')
      recentSessions.forEach((s) => {
        const globalIdx = sessions.indexOf(s) + 1
        lines.push(`  ${globalIdx}. ${s.title} (${s.id.slice(0, 8)})`)
      })
      lines.push('')
      lines.push('使用 /switch <序号> 切换，或发送消息自动创建新会话')
    } else {
      lines.push('该工作区暂无会话，发送消息将自动创建。')
    }

    await this.send(chatId, lines.join('\n'), contextData)
  }

  private async handleNowCommand(chatId: string, contextData?: unknown): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    const lines: string[] = ['📊 当前状态:']

    // 会话信息
    if (binding) {
      const session = getAgentSessionMeta(binding.sessionId)
      lines.push(`会话: ${session?.title ?? '未知'} (${binding.sessionId.slice(0, 8)})`)
      lines.push(`模式: ${binding.mode === 'agent' ? 'Agent' : 'Chat'}`)
    } else {
      lines.push('会话: 未绑定（发送消息将自动创建）')
    }

    // 工作区信息
    const workspaceId = binding?.workspaceId
    const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
    if (workspace) {
      lines.push(`工作区: ${workspace.name} (${workspace.slug})`)

      // MCP Servers
      const capabilities = getWorkspaceCapabilities(workspace.slug)
      if (capabilities.mcpServers.length > 0) {
        lines.push('')
        lines.push('MCP Servers:')
        for (const mcp of capabilities.mcpServers) {
          const status = mcp.enabled !== false ? '✅' : '⏸️'
          lines.push(`  ${status} ${mcp.name}`)
        }
      }

      // Skills
      if (capabilities.skills.length > 0) {
        lines.push('')
        lines.push('Skills:')
        for (const skill of capabilities.skills) {
          const status = skill.enabled !== false ? '✅' : '⏸️'
          lines.push(`  ${status} ${skill.name}`)
        }
      }

      // 工作区文件
      try {
        const wsPath = getAgentWorkspacePath(workspace.slug)
        const entries = readdirSync(wsPath, { withFileTypes: true })
        const fileList = entries
          .filter((e) => !e.name.startsWith('.') && e.name !== 'mcp.json' && e.name !== 'config.json' && e.name !== 'skills' && e.name !== 'skills-inactive')
          .map((e) => e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`)
        if (fileList.length > 0) {
          lines.push('')
          lines.push('工作区文件:')
          for (const f of fileList.slice(0, 20)) {
            lines.push(`  ${f}`)
          }
          if (fileList.length > 20) {
            lines.push(`  ... 还有 ${fileList.length - 20} 项`)
          }
        }
      } catch {
        // 忽略
      }
    } else {
      lines.push('工作区: 未设置')
    }

    await this.send(chatId, lines.join('\n'), contextData)
  }

  // ===== Agent 消息路由 =====

  private async handleUserMessage(chatId: string, text: string, contextData?: unknown): Promise<void> {
    const settings = getSettings()
    const channelId = settings.agentChannelId
    if (!channelId) {
      await this.send(chatId, '请先在 Proma 设置中选择 Agent 渠道。', contextData)
      return
    }

    let binding = this.chatBindings.get(chatId)

    // 自动创建会话
    if (!binding) {
      const workspaceId = this.config.getDefaultWorkspaceId?.() ?? settings.agentWorkspaceId ?? ''

      const session = createAgentSession(
        `${this.config.platformName}会话`,
        channelId,
        workspaceId || undefined,
      )

      binding = {
        chatId,
        sessionId: session.id,
        workspaceId,
        channelId,
        modelId: settings.agentModelId ?? undefined,
        mode: 'agent',
      }
      this.chatBindings.set(chatId, binding)
      this.sessionToChat.set(session.id, chatId)
      this.log(`为 ${chatId.slice(0, 8)}... 创建会话: ${session.id.slice(0, 8)}`)

      this.notifySessionCreated(session.id, session.title)
    }

    if (binding.mode !== 'agent') {
      await this.send(chatId, 'Chat 模式暂未实现，请使用 /agent 切换到 Agent 模式。', contextData)
      return
    }

    // 并发保护：如果该会话的 Agent 仍在运行，直接拒绝，不要触碰 buffer
    if (isAgentSessionActive(binding.sessionId)) {
      await this.send(chatId, '❌ 上一条消息仍在处理中，请稍候再试', contextData)
      return
    }

    // 即时确认：[workspace_name]->[session_title]: ⏳ Agent 处理中...
    const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    const session = getAgentSessionMeta(binding.sessionId)
    const wsName = workspace?.name ?? '默认'
    const chatName = session?.title ?? '新会话'
    await this.send(chatId, `${wsName} → ${chatName}: ⏳ Agent 处理中...`, contextData)

    // 初始化回复缓冲
    this.sessionBuffers.set(binding.sessionId, {
      text: '',
      chatId,
      contextData,
      startedAt: Date.now(),
    })

    // 使用最新设置
    const latestSettings = getSettings()
    const latestChannelId = latestSettings.agentChannelId || binding.channelId
    const modelId = latestSettings.agentModelId || binding.modelId

    const input = {
      sessionId: binding.sessionId,
      userMessage: text,
      channelId: latestChannelId,
      modelId,
      workspaceId: binding.workspaceId,
      permissionModeOverride: 'bypassPermissions' as const,
    }

    runAgentHeadless(input, {
      onError: (error) => {
        this.log(`Agent 错误: ${error}`)
        this.send(chatId, `❌ Agent 错误: ${error}`, contextData).catch(console.error)
        this.sessionBuffers.delete(binding!.sessionId)
      },
      onComplete: () => {
        // complete 由 EventBus listener 处理
      },
      onTitleUpdated: () => {},
    }).catch((error) => {
      this.log(`Agent 运行异常: ${error}`)
    })
  }

  // ===== EventBus 事件处理 =====

  private handleAgentPayload(sessionId: string, payload: AgentStreamPayload): void {
    const buffer = this.sessionBuffers.get(sessionId)
    if (!buffer) return

    if (payload.kind === 'sdk_message') {
      const msg = payload.message

      // 从 assistant 消息中提取文本
      if (msg.type === 'assistant') {
        const aMsg = msg as AssistantMessagePayload
        for (const block of aMsg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            buffer.text += block.text
          }
        }
      }

      // result → 会话完成
      if (msg.type === 'result') {
        this.handleSessionComplete(sessionId)
      }
    }
  }

  private handleSessionComplete(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId)
    if (!buffer) return

    const duration = ((Date.now() - buffer.startedAt) / 1000).toFixed(1)
    const replyText = buffer.text.trim() || '✅ Agent 已完成（无文本输出）'

    this.log(`Agent 回复 (${duration}s): ${replyText.slice(0, 100)}${replyText.length > 100 ? '...' : ''}`)
    this.send(buffer.chatId, replyText, buffer.contextData).catch(console.error)
    this.sessionBuffers.delete(sessionId)
  }

  // ===== 工具方法 =====

  private async send(chatId: string, text: string, contextData?: unknown): Promise<void> {
    await this.config.adapter.sendText(chatId, text, contextData)
  }

  private notifySessionCreated(sessionId: string, title: string): void {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, { sessionId, title })
    }
  }
}
