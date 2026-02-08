/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地将 API 暴露给渲染进程
 * 使用上下文隔离确保安全性
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS, CLOUD_IPC_CHANNELS } from '@proma/shared'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS } from '../types'
import type {
  RuntimeStatus,
  GitRepoStatus,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
  ConversationMeta,
  ChatMessage,
  ChatSendInput,
  GenerateTitleInput,
  StreamChunkEvent,
  StreamReasoningEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  RecentMessagesResult,
  AgentSessionMeta,
  AgentMessage,
  AgentSendInput,
  AgentStreamEvent,
  AgentWorkspace,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSavedFile,
  AgentCopyFolderInput,
  WorkspaceMcpConfig,
  SkillMeta,
  WorkspaceCapabilities,
  FileEntry,
  CloudAuthState,
  CloudAuthIpcResponse,
  BillingIpcResponse,
  BillingInfo,
  CheckBalanceResponse,
  PaymentTiersResponse,
  CreateWechatPaymentResponse,
  CreateStripePaymentResponse,
  OrderRecord,
  VerifyVipResponse,
  QueryExternalBalanceResponse,
  TransferCreditsResponse,
} from '@proma/shared'
import type { UserProfile, AppSettings } from '../types'

/**
 * 暴露给渲染进程的 API 接口定义
 */
export interface ElectronAPI {
  // ===== 运行时相关 =====

  /**
   * 获取运行时状态
   * @returns 运行时状态，包含 Bun、Git 等信息
   */
  getRuntimeStatus: () => Promise<RuntimeStatus | null>

  /**
   * 获取指定目录的 Git 仓库状态
   * @param dirPath - 目录路径
   * @returns Git 仓库状态
   */
  getGitRepoStatus: (dirPath: string) => Promise<GitRepoStatus | null>

  // ===== 通用工具 =====

  /** 在系统默认浏览器中打开外部链接 */
  openExternal: (url: string) => Promise<void>

  // ===== 渠道管理相关 =====

  /** 获取所有渠道列表（apiKey 保持加密态） */
  listChannels: () => Promise<Channel[]>

  /** 创建渠道（apiKey 为明文，主进程加密） */
  createChannel: (input: ChannelCreateInput) => Promise<Channel>

  /** 更新渠道 */
  updateChannel: (id: string, input: ChannelUpdateInput) => Promise<Channel>

  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>

  /** 解密获取明文 API Key（仅在用户查看时调用） */
  decryptApiKey: (channelId: string) => Promise<string>

  /** 测试渠道连接 */
  testChannel: (channelId: string) => Promise<ChannelTestResult>

  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  testChannelDirect: (input: FetchModelsInput) => Promise<ChannelTestResult>

  /** 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道） */
  fetchModels: (input: FetchModelsInput) => Promise<FetchModelsResult>

  // ===== 对话管理相关 =====

  /** 获取对话列表 */
  listConversations: () => Promise<ConversationMeta[]>

  /** 创建对话 */
  createConversation: (title?: string, modelId?: string, channelId?: string) => Promise<ConversationMeta>

  /** 获取对话消息 */
  getConversationMessages: (id: string) => Promise<ChatMessage[]>

  /** 获取对话最近 N 条消息（分页加载） */
  getRecentMessages: (id: string, limit: number) => Promise<RecentMessagesResult>

  /** 更新对话标题 */
  updateConversationTitle: (id: string, title: string) => Promise<ConversationMeta>

  /** 更新对话使用的模型/渠道 */
  updateConversationModel: (id: string, modelId: string, channelId: string) => Promise<ConversationMeta>

  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>

  /** 切换对话置顶状态 */
  togglePinConversation: (id: string) => Promise<ConversationMeta>

  // ===== 消息发送 =====

  /** 发送消息（触发 AI 流式响应） */
  sendMessage: (input: ChatSendInput) => Promise<void>

  /** 中止生成 */
  stopGeneration: (conversationId: string) => Promise<void>

  /** 删除指定消息 */
  deleteMessage: (conversationId: string, messageId: string) => Promise<ChatMessage[]>

  /** 更新上下文分隔线 */
  updateContextDividers: (conversationId: string, dividers: string[]) => Promise<ConversationMeta>

  /** 生成对话标题 */
  generateTitle: (input: GenerateTitleInput) => Promise<string | null>

  // ===== 附件管理相关 =====

  /** 保存附件到本地 */
  saveAttachment: (input: AttachmentSaveInput) => Promise<AttachmentSaveResult>

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 删除附件 */
  deleteAttachment: (localPath: string) => Promise<void>

  /** 打开文件选择对话框 */
  openFileDialog: () => Promise<FileDialogResult>

  /** 提取附件文档的文本内容 */
  extractAttachmentText: (localPath: string) => Promise<string>

  // ===== 用户档案相关 =====

  /** 获取用户档案 */
  getUserProfile: () => Promise<UserProfile>

  /** 更新用户档案 */
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>

  // ===== 应用设置相关 =====

  /** 获取应用设置 */
  getSettings: () => Promise<AppSettings>

  /** 更新应用设置 */
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>

  /** 获取系统主题（是否深色模式） */
  getSystemTheme: () => Promise<boolean>

  /** 订阅系统主题变化事件（返回清理函数） */
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => () => void

  // ===== 流式事件订阅（返回清理函数） =====

  /** 订阅内容片段事件 */
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => () => void

  /** 订阅推理片段事件 */
  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => () => void

  /** 订阅流式完成事件 */
  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => () => void

  /** 订阅流式错误事件 */
  onStreamError: (callback: (event: StreamErrorEvent) => void) => () => void

  // ===== Agent 会话管理相关 =====

  /** 获取 Agent 会话列表 */
  listAgentSessions: () => Promise<AgentSessionMeta[]>

  /** 创建 Agent 会话 */
  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) => Promise<AgentSessionMeta>

  /** 获取 Agent 会话消息 */
  getAgentSessionMessages: (id: string) => Promise<AgentMessage[]>

  /** 更新 Agent 会话标题 */
  updateAgentSessionTitle: (id: string, title: string) => Promise<AgentSessionMeta>

  /** 删除 Agent 会话 */
  deleteAgentSession: (id: string) => Promise<void>

  /** 生成 Agent 会话标题 */
  generateAgentTitle: (input: AgentGenerateTitleInput) => Promise<string | null>

  /** 发送 Agent 消息 */
  sendAgentMessage: (input: AgentSendInput) => Promise<void>

  /** 中止 Agent 执行 */
  stopAgent: (sessionId: string) => Promise<void>

  // ===== Agent 工作区管理相关 =====

  /** 获取 Agent 工作区列表 */
  listAgentWorkspaces: () => Promise<AgentWorkspace[]>

  /** 创建 Agent 工作区 */
  createAgentWorkspace: (name: string) => Promise<AgentWorkspace>

  /** 更新 Agent 工作区 */
  updateAgentWorkspace: (id: string, updates: { name: string }) => Promise<AgentWorkspace>

  /** 删除 Agent 工作区 */
  deleteAgentWorkspace: (id: string) => Promise<void>

  // ===== 工作区能力（MCP + Skill） =====

  /** 获取工作区能力摘要 */
  getWorkspaceCapabilities: (workspaceSlug: string) => Promise<WorkspaceCapabilities>

  /** 获取工作区 MCP 配置 */
  getWorkspaceMcpConfig: (workspaceSlug: string) => Promise<WorkspaceMcpConfig>

  /** 保存工作区 MCP 配置 */
  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) => Promise<void>

  /** 获取工作区 Skill 列表 */
  getWorkspaceSkills: (workspaceSlug: string) => Promise<SkillMeta[]>

  /** 删除工作区 Skill */
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>

  /** 订阅 Agent 流式事件（返回清理函数） */
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => () => void

  /** 订阅 Agent 流式完成事件 */
  onAgentStreamComplete: (callback: (data: { sessionId: string }) => void) => () => void

  /** 订阅 Agent 流式错误事件 */
  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void

  /** 订阅 Agent 标题自动更新事件 */
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void

  // ===== Agent 附件 =====

  /** 保存文件到 Agent session 工作目录 */
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => Promise<AgentSavedFile[]>

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 复制文件夹到 Agent session 工作目录 */
  copyFolderToSession: (input: AgentCopyFolderInput) => Promise<AgentSavedFile[]>

  // ===== Agent 文件系统操作 =====

  /** 获取 session 工作路径 */
  getAgentSessionPath: (workspaceId: string, sessionId: string) => Promise<string | null>

  /** 列出目录内容 */
  listDirectory: (dirPath: string) => Promise<FileEntry[]>

  /** 删除文件/目录 */
  deleteFile: (filePath: string) => Promise<void>

  /** 用系统默认应用打开文件 */
  openFile: (filePath: string) => Promise<void>

  /** 在系统文件管理器中显示文件 */
  showInFolder: (filePath: string) => Promise<void>

  // ===== 自动更新相关（可选，仅在 updater 模块存在时可用） =====

  /** 更新 API */
  updater?: {
    checkForUpdates: () => Promise<void>
    downloadUpdate: () => Promise<void>
    installUpdate: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      releaseNotes?: string
      progress?: { percent: number; transferred: number; total: number }
      error?: string
    }>
    onStatusChanged: (callback: (status: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      releaseNotes?: string
      progress?: { percent: number; transferred: number; total: number }
      error?: string
    }) => void) => () => void
  }

  // ===== Cloud 认证相关 =====

  /** Cloud 认证 API（始终暴露，handler 仅在 cloud 模式注册） */
  cloudAuth: {
    /** 登录 */
    login: (data: { email: string; password: string }) => Promise<CloudAuthIpcResponse>
    /** 注册 */
    register: (data: { email: string; password: string; name: string }) => Promise<CloudAuthIpcResponse>
    /** 登出 */
    logout: () => Promise<CloudAuthIpcResponse>
    /** 获取当前用户 */
    getMe: () => Promise<CloudAuthIpcResponse>
    /** 获取认证状态 */
    getAuthState: () => Promise<CloudAuthState>
    /** 邮箱验证 */
    verifyEmail: (data: { email: string; code: string }) => Promise<CloudAuthIpcResponse>
    /** 忘记密码 */
    forgotPassword: (data: { email: string }) => Promise<CloudAuthIpcResponse>
    /** 重置密码 */
    resetPassword: (data: { email: string; code: string; password: string }) => Promise<CloudAuthIpcResponse>
    /** 重发验证码 */
    resendCode: (data: { email: string }) => Promise<CloudAuthIpcResponse>
    /** 获取 Google OAuth 状态 */
    getGoogleOAuthStatus: () => Promise<{ configured: boolean }>
    /** 打开 Google 登录（系统浏览器） */
    openGoogleLogin: () => Promise<CloudAuthIpcResponse>
    /** 订阅认证状态变化（返回清理函数） */
    onAuthStateChanged: (callback: (state: CloudAuthState) => void) => () => void
  }

  // ===== Cloud 账单/支付相关 =====

  /** Cloud 账单 API（始终暴露，handler 仅在 cloud 模式注册） */
  cloudBilling: {
    /** 获取账单信息 */
    getBilling: () => Promise<BillingIpcResponse<BillingInfo>>
    /** 检查余额 */
    checkBalance: () => Promise<BillingIpcResponse<CheckBalanceResponse>>
    /** 获取套餐列表 */
    getTiers: () => Promise<BillingIpcResponse<PaymentTiersResponse>>
    /** 创建微信支付 */
    createWechatPayment: (tierId: string) => Promise<BillingIpcResponse<CreateWechatPaymentResponse>>
    /** 创建 Stripe 支付 */
    createStripePayment: (tierId: string) => Promise<BillingIpcResponse<CreateStripePaymentResponse>>
    /** 查询订单状态 */
    getOrderStatus: (orderNo: string) => Promise<BillingIpcResponse<OrderRecord>>
    /** 获取订单历史 */
    getOrders: () => Promise<BillingIpcResponse<OrderRecord[]>>
    /** VIP 验证 */
    verifyVip: (apiKey: string) => Promise<BillingIpcResponse<VerifyVipResponse>>
    /** 查询外部（DeepClaude）余额 */
    queryExternalBalance: (apiKey: string) => Promise<BillingIpcResponse<QueryExternalBalanceResponse>>
    /** 迁移外部额度 */
    transferCredits: (apiKey: string, amount: number) => Promise<BillingIpcResponse<TransferCreditsResponse>>
    /** 订阅额度不足事件（返回清理函数） */
    onQuotaExceeded: (callback: () => void) => () => void
    /** 订阅余额变动事件（对话扣费后，返回清理函数） */
    onBillingChanged: (callback: () => void) => () => void
    /** 同步官方渠道（拉取最新模型列表） */
    syncOfficialChannel: () => Promise<BillingIpcResponse<void>>
    /** 订阅官方渠道更新事件（返回清理函数） */
    onOfficialChannelUpdated: (callback: () => void) => () => void
  }
}

/**
 * 实现 ElectronAPI 接口
 */
const electronAPI: ElectronAPI = {
  // 运行时
  getRuntimeStatus: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_RUNTIME_STATUS)
  },

  getGitRepoStatus: (dirPath: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath)
  },

  // 通用工具
  openExternal: (url: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
  },

  // 渠道管理
  listChannels: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.LIST)
  },

  createChannel: (input: ChannelCreateInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CREATE, input)
  },

  updateChannel: (id: string, input: ChannelUpdateInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input)
  },

  deleteChannel: (id: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DELETE, id)
  },

  decryptApiKey: (channelId: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId)
  },

  testChannel: (channelId: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST, channelId)
  },

  testChannelDirect: (input: FetchModelsInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input)
  },

  fetchModels: (input: FetchModelsInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input)
  },

  // 对话管理
  listConversations: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.LIST_CONVERSATIONS)
  },

  createConversation: (title?: string, modelId?: string, channelId?: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_CONVERSATION, title, modelId, channelId)
  },

  getConversationMessages: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_MESSAGES, id)
  },

  getRecentMessages: (id: string, limit: number) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES, id, limit)
  },

  updateConversationTitle: (id: string, title: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  updateConversationModel: (id: string, modelId: string, channelId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_MODEL, id, modelId, channelId)
  },

  deleteConversation: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_CONVERSATION, id)
  },

  togglePinConversation: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  // 消息发送
  sendMessage: (input: ChatSendInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  stopGeneration: (conversationId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.STOP_GENERATION, conversationId)
  },

  deleteMessage: (conversationId: string, messageId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_MESSAGE, conversationId, messageId)
  },

  updateContextDividers: (conversationId: string, dividers: string[]) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS, conversationId, dividers)
  },

  generateTitle: (input: GenerateTitleInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GENERATE_TITLE, input)
  },

  // 附件管理
  saveAttachment: (input: AttachmentSaveInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_ATTACHMENT, input)
  },

  readAttachment: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.READ_ATTACHMENT, localPath)
  },

  deleteAttachment: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_ATTACHMENT, localPath)
  },

  openFileDialog: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG)
  },

  extractAttachmentText: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT, localPath)
  },

  // 用户档案
  getUserProfile: () => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.GET)
  },

  updateUserProfile: (updates: Partial<UserProfile>) => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates)
  },

  // 应用设置
  getSettings: () => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET)
  },

  updateSettings: (updates: Partial<AppSettings>) => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates)
  },

  getSystemTheme: () => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME)
  },

  onSystemThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_: unknown, isDark: boolean): void => callback(isDark)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener) }
  },

  // 流式事件订阅
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => {
    const listener = (_: unknown, event: StreamChunkEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener) }
  },

  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => {
    const listener = (_: unknown, event: StreamReasoningEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_REASONING, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_REASONING, listener) }
  },

  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => {
    const listener = (_: unknown, event: StreamCompleteEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onStreamError: (callback: (event: StreamErrorEvent) => void) => {
    const listener = (_: unknown, event: StreamErrorEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  // Agent 会话管理
  listAgentSessions: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSIONS)
  },

  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SESSION, title, channelId, workspaceId)
  },

  getAgentSessionMessages: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MESSAGES, id)
  },

  updateAgentSessionTitle: (id: string, title: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  deleteAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SESSION, id)
  },

  generateAgentTitle: (input: AgentGenerateTitleInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GENERATE_TITLE, input)
  },

  sendAgentMessage: (input: AgentSendInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  stopAgent: (sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_AGENT, sessionId)
  },

  // Agent 工作区管理
  listAgentWorkspaces: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACES)
  },

  createAgentWorkspace: (name: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_WORKSPACE, name)
  },

  updateAgentWorkspace: (id: string, updates: { name: string }) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_WORKSPACE, id, updates)
  },

  deleteAgentWorkspace: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_WORKSPACE, id)
  },

  // 工作区能力（MCP + Skill）
  getWorkspaceCapabilities: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_CAPABILITIES, workspaceSlug)
  },

  getWorkspaceMcpConfig: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MCP_CONFIG, workspaceSlug)
  },

  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG, workspaceSlug, config)
  },

  getWorkspaceSkills: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug)
  },

  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug)
  },

  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => {
    const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_EVENT, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_EVENT, listener) }
  },

  onAgentStreamComplete: (callback: (data: { sessionId: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  // 标题自动更新通知
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; title: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener) }
  },

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener) }
  },

  onWorkspaceFilesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener) }
  },

  // Agent 附件
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION, input)
  },

  openFolderDialog: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG)
  },

  copyFolderToSession: (input: AgentCopyFolderInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.COPY_FOLDER_TO_SESSION, input)
  },

  // Agent 文件系统操作
  getAgentSessionPath: (workspaceId: string, sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_PATH, workspaceId, sessionId)
  },

  listDirectory: (dirPath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath)
  },

  deleteFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath)
  },

  openFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath)
  },

  showInFolder: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath)
  },

  // 自动更新（updater 模块为可选，bridge 始终暴露，IPC 调用失败时由渲染进程处理）
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    onStatusChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]): void => callback(status)
      ipcRenderer.on('updater:status-changed', listener)
      return () => { ipcRenderer.removeListener('updater:status-changed', listener) }
    },
  },

  // Cloud 认证
  cloudAuth: {
    login: (data: { email: string; password: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LOGIN, data)
    },
    register: (data: { email: string; password: string; name: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.REGISTER, data)
    },
    logout: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LOGOUT)
    },
    getMe: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_ME)
    },
    getAuthState: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_AUTH_STATE)
    },
    verifyEmail: (data: { email: string; code: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.VERIFY_EMAIL, data)
    },
    forgotPassword: (data: { email: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.FORGOT_PASSWORD, data)
    },
    resetPassword: (data: { email: string; code: string; password: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.RESET_PASSWORD, data)
    },
    resendCode: (data: { email: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.RESEND_CODE, data)
    },
    getGoogleOAuthStatus: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_GOOGLE_OAUTH_STATUS)
    },
    openGoogleLogin: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.OPEN_GOOGLE_LOGIN)
    },
    onAuthStateChanged: (callback: (state: CloudAuthState) => void) => {
      const listener = (_: unknown, state: CloudAuthState): void => callback(state)
      ipcRenderer.on(CLOUD_IPC_CHANNELS.AUTH_STATE_CHANGED, listener)
      return () => { ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.AUTH_STATE_CHANGED, listener) }
    },
  },

  // Cloud 账单/支付
  cloudBilling: {
    getBilling: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_BILLING)
    },
    checkBalance: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CHECK_BALANCE)
    },
    getTiers: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_TIERS)
    },
    createWechatPayment: (tierId: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_WECHAT_PAYMENT, tierId)
    },
    createStripePayment: (tierId: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_STRIPE_PAYMENT, tierId)
    },
    getOrderStatus: (orderNo: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_ORDER_STATUS, orderNo)
    },
    getOrders: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_ORDERS)
    },
    verifyVip: (apiKey: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.VERIFY_VIP, apiKey)
    },
    queryExternalBalance: (apiKey: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.QUERY_EXTERNAL_BALANCE, apiKey)
    },
    transferCredits: (apiKey: string, amount: number) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.TRANSFER_CREDITS, apiKey, amount)
    },
    onQuotaExceeded: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED, listener)
      return () => { ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED, listener) }
    },
    onBillingChanged: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(CLOUD_IPC_CHANNELS.BILLING_CHANGED, listener)
      return () => { ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.BILLING_CHANGED, listener) }
    },
    syncOfficialChannel: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.SYNC_OFFICIAL_CHANNEL)
    },
    onOfficialChannelUpdated: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED, listener)
      return () => { ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED, listener) }
    },
  },
}

// 将 API 暴露到渲染进程的 window 对象上
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 扩展 Window 接口的类型定义
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
