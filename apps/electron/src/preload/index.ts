/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地将 API 暴露给渲染进程
 * 使用上下文隔离确保安全性
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, MEMORY_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS, FEISHU_IPC_CHANNELS } from '@proma/shared'
// Cloud 模式专属 IPC 通道
import { CLOUD_IPC_CHANNELS, SYNC_IPC_CHANNELS } from '@proma/shared'
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
  StreamToolActivityEvent,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  RecentMessagesResult,
  AgentSessionMeta,
  AgentMessage,
  AgentSendInput,
  AgentStreamEvent,
  AgentStreamCompletePayload,
  AgentWorkspace,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  WorkspaceAttachDirectoryInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
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
  ApiKeyResponse,
  ApiKeyCreateResponse,
  ApiKeyCreateParams,
  ApiKeyUpdateParams,
  SubscriptionTiersResponse,
  SubscriptionStatusResponse,
  SubscriptionOrderRecord,
  CreateSubscriptionWechatResponse,
  SyncState,
  SyncResult,
  SyncProgressEvent,
  FileSearchResult,
  EnvironmentCheckResult,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  PermissionRequest,
  PermissionResponse,
  PromaPermissionMode,
  AskUserRequest,
  AskUserResponse,
  SystemPromptConfig,
  SystemPrompt,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
  MemoryConfig,
  // Cloud 模式专属类型
  DownloadCloudPromptsResult,
  UsageQueryParams,
  UsageLogResponse,
  ToolUsageLogResponse,
  SpeechUsageLogResponse,
  AgentUsageLogResponse,
  ChatToolInfo,
  ChatToolState,
  ChatToolMeta,
  AgentTeamData,
  MoveSessionToWorkspaceInput,
  FeishuConfig,
  FeishuConfigInput,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuNotifyMode,
  FeishuNotificationSentPayload,
  FeishuUpdateBindingInput,
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

  // ===== 教程 =====

  /** 获取教程内容 */
  getTutorialContent: () => Promise<string | null>

  /** 创建欢迎对话（含教程附件） */
  createWelcomeConversation: () => Promise<ConversationMeta | null>

  // ===== 消息发送 =====

  /** 发送消息（触发 AI 流式响应） */
  sendMessage: (input: ChatSendInput) => Promise<void>

  /** 中止生成 */
  stopGeneration: (conversationId: string) => Promise<void>

  /** 删除指定消息 */
  deleteMessage: (conversationId: string, messageId: string) => Promise<ChatMessage[]>

  /** 从指定消息开始截断（包含该消息） */
  truncateMessagesFrom: (
    conversationId: string,
    messageId: string,
    preserveFirstMessageAttachments?: boolean,
  ) => Promise<ChatMessage[]>

  /** 更新上下文分隔线 */
  updateContextDividers: (conversationId: string, dividers: string[]) => Promise<ConversationMeta>

  /** 生成对话标题 */
  generateTitle: (input: GenerateTitleInput) => Promise<string | null>

  // ===== 附件管理相关 =====

  /** 保存附件到本地 */
  saveAttachment: (input: AttachmentSaveInput) => Promise<AttachmentSaveResult>

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>

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

  // ===== 环境检测相关 =====

  /** 执行环境检测 */
  checkEnvironment: () => Promise<EnvironmentCheckResult>

  // ===== 代理配置相关 =====

  /** 获取代理配置 */
  getProxySettings: () => Promise<ProxyConfig>

  /** 更新代理配置 */
  updateProxySettings: (config: ProxyConfig) => Promise<void>

  /** 检测系统代理 */
  detectSystemProxy: () => Promise<SystemProxyDetectResult>

  // ===== 流式事件订阅（返回清理函数） =====

  /** 订阅内容片段事件 */
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => () => void

  /** 订阅推理片段事件 */
  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => () => void

  /** 订阅流式完成事件 */
  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => () => void

  /** 订阅流式错误事件 */
  onStreamError: (callback: (event: StreamErrorEvent) => void) => () => void

  /** 订阅流式工具活动事件 */
  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => () => void

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

  /** 迁移 Chat 对话记录到 Agent 会话 */
  migrateChatToAgent: (conversationId: string, agentSessionId: string) => Promise<void>

  /** 切换 Agent 会话置顶状态 */
  togglePinAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 迁移 Agent 会话到另一个工作区 */
  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => Promise<AgentSessionMeta>

  /** 生成 Agent 会话标题 */
  generateAgentTitle: (input: AgentGenerateTitleInput) => Promise<string | null>

  /** 发送 Agent 消息 */
  sendAgentMessage: (input: AgentSendInput) => Promise<void>

  /** 中止 Agent 执行 */
  stopAgent: (sessionId: string) => Promise<void>

  // ===== Agent 后台任务管理 =====

  /** 获取任务输出 */
  getTaskOutput: (input: GetTaskOutputInput) => Promise<GetTaskOutputResult>

  /** 停止任务 */
  stopTask: (input: StopTaskInput) => Promise<void>

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

  /** 测试 MCP 服务器连接 */
  testMcpServer: (name: string, entry: import('@proma/shared').McpServerEntry) => Promise<{ success: boolean; message: string }>

  /** 获取工作区 Skill 列表（含活跃和不活跃） */
  getWorkspaceSkills: (workspaceSlug: string) => Promise<SkillMeta[]>

  /** 获取工作区 Skills 目录绝对路径 */
  getWorkspaceSkillsDir: (workspaceSlug: string) => Promise<string>

  /** 删除工作区 Skill */
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>

  /** 切换工作区 Skill 启用/禁用 */
  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => Promise<void>

  /** 订阅 Agent 流式事件（返回清理函数） */
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => () => void

  /** 订阅 Agent 流式完成事件 */
  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => () => void

  /** 订阅 Agent 流式错误事件 */
  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void

  /** 订阅 Agent 标题自动更新事件 */
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void

  // ===== Agent 权限系统 =====

  /** 响应权限请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>

  /** 获取工作区权限模式 */
  getPermissionMode: (workspaceSlug: string) => Promise<PromaPermissionMode>

  /** 设置工作区权限模式 */
  setPermissionMode: (workspaceSlug: string, mode: PromaPermissionMode) => Promise<void>

  /** 获取全局记忆配置 */
  getMemoryConfig: () => Promise<MemoryConfig>

  /** 保存全局记忆配置 */
  setMemoryConfig: (config: MemoryConfig) => Promise<void>

  /** 测试记忆连接 */
  testMemoryConnection: () => Promise<{ success: boolean; message: string }>

  // ===== Chat 工具管理 =====

  /** 获取所有工具信息 */
  getChatTools: () => Promise<ChatToolInfo[]>

  /** 获取工具凭据 */
  getChatToolCredentials: (toolId: string) => Promise<Record<string, string>>

  /** 更新工具开关状态 */
  updateChatToolState: (toolId: string, state: ChatToolState) => Promise<void>

  /** 更新工具凭据 */
  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => Promise<void>

  /** 创建自定义工具 */
  createCustomChatTool: (meta: ChatToolMeta) => Promise<void>

  /** 删除自定义工具 */
  deleteCustomChatTool: (toolId: string) => Promise<void>

  /** 监听自定义工具配置变更 */
  onCustomToolChanged: (callback: () => void) => () => void

  /** 测试工具连接 */
  testChatTool: (toolId: string) => Promise<{ success: boolean; message: string }>

  // ===== AskUserQuestion 交互式问答 =====

  /** 响应 AskUser 请求 */
  respondAskUser: (response: AskUserResponse) => Promise<void>

  // ===== Agent Teams 数据 =====

  /** 获取 Team 聚合数据（团队配置 + 任务列表 + 收件箱） */
  getAgentTeamData: (sdkSessionId: string) => Promise<AgentTeamData | null>

  /** 读取 Teammate 输出文件内容 */
  getAgentOutput: (filePath: string) => Promise<string>

  // ===== Agent 附件 =====

  /** 保存文件到 Agent session 工作目录 */
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => Promise<AgentSavedFile[]>

  /** 保存文件到工作区文件目录 */
  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => Promise<AgentSavedFile[]>

  /** 获取工作区文件目录路径 */
  getWorkspaceFilesPath: (workspaceSlug: string) => Promise<string>

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 附加外部目录到 Agent 会话 */
  attachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 移除会话的附加目录 */
  detachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 附加外部目录到工作区（所有会话可访问） */
  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 移除工作区的附加目录 */
  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 获取工作区附加目录列表 */
  getWorkspaceDirectories: (workspaceSlug: string) => Promise<string[]>

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

  /** 在新窗口中预览文件 */
  previewFile: (filePath: string) => Promise<void>

  /** 重命名文件/目录 */
  renameFile: (filePath: string, newName: string) => Promise<void>

  /** 移动文件/目录到目标目录 */
  moveFile: (filePath: string, targetDir: string) => Promise<void>

  /** 列出附加目录内容（无工作区路径限制） */
  listAttachedDirectory: (dirPath: string) => Promise<FileEntry[]>

  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  openAttachedFile: (filePath: string) => Promise<void>

  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  showAttachedInFolder: (filePath: string) => Promise<void>

  /** 重命名附加目录文件/目录（无工作区路径限制） */
  renameAttachedFile: (filePath: string, newName: string) => Promise<void>

  /** 移动附加目录文件/目录（无工作区路径限制） */
  moveAttachedFile: (filePath: string, targetDir: string) => Promise<void>

  /** 搜索工作区文件（用于 @ 引用，支持附加目录） */
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[]) => Promise<FileSearchResult>

  // ===== 系统提示词管理 =====

  /** 获取系统提示词配置 */
  getSystemPromptConfig: () => Promise<SystemPromptConfig>

  /** 创建提示词 */
  createSystemPrompt: (input: SystemPromptCreateInput) => Promise<SystemPrompt>

  /** 更新提示词 */
  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) => Promise<SystemPrompt>

  /** 删除提示词 */
  deleteSystemPrompt: (id: string) => Promise<void>

  /** 更新追加日期时间和用户名开关 */
  updateAppendSetting: (enabled: boolean) => Promise<void>

  /** 设置默认提示词 */
  setDefaultPrompt: (id: string | null) => Promise<void>

  // ===== 版本检测相关（仅检测，不自动下载/安装） =====

  /** 更新 API */
  updater?: {
    checkForUpdates: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      error?: string
    }>
    onStatusChanged: (callback: (status: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
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
    /** 更新用户档案（Cloud 模式） */
    updateProfile: (data: { name?: string; image?: string }) => Promise<CloudAuthIpcResponse>
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
    /** 订阅额度不足事件（返回清理函数） */
    onQuotaExceeded: (callback: () => void) => () => void
    /** 订阅余额变动事件（对话扣费后，返回清理函数） */
    onBillingChanged: (callback: () => void) => () => void
    /** 同步官方渠道（拉取最新模型列表） */
    syncOfficialChannel: () => Promise<BillingIpcResponse<void>>
    /** 订阅官方渠道更新事件（返回清理函数） */
    onOfficialChannelUpdated: (callback: () => void) => () => void
  }

  // ===== Cloud API Key 管理相关 =====

  /** Cloud API Key 管理 API */
  cloudApiKeys: {
    /** 获取 API Keys 列表 */
    list: () => Promise<BillingIpcResponse<ApiKeyResponse[]>>
    /** 创建 API Key */
    create: (params: ApiKeyCreateParams) => Promise<BillingIpcResponse<ApiKeyCreateResponse>>
    /** 更新 API Key */
    update: (keyId: string, params: ApiKeyUpdateParams) => Promise<BillingIpcResponse<ApiKeyResponse>>
    /** 删除 API Key */
    delete: (keyId: string) => Promise<BillingIpcResponse<void>>
  }

  // ===== Cloud 订阅相关 =====

  /** Cloud 订阅 API */
  cloudSubscription: {
    /** 获取订阅档位列表 */
    getTiers: () => Promise<BillingIpcResponse<SubscriptionTiersResponse>>
    /** 获取当前活跃订阅 */
    getCurrent: () => Promise<BillingIpcResponse<SubscriptionStatusResponse>>
    /** 创建订阅微信支付 */
    createWechatPayment: (tierId: string) => Promise<BillingIpcResponse<CreateSubscriptionWechatResponse>>
    /** 查询订阅订单状态 */
    getOrderStatus: (orderNo: string) => Promise<BillingIpcResponse<SubscriptionOrderRecord>>
    /** 获取订阅历史 */
    getHistory: () => Promise<BillingIpcResponse<SubscriptionOrderRecord[]>>
  }

  // ===== Cloud 提示词下载相关 =====

  /** Cloud 提示词下载 API */
  cloudPrompts: {
    /** 下载云端提示词到本地 */
    download: () => Promise<DownloadCloudPromptsResult>
  }

  // ===== Cloud 用量日志相关 =====

  /** Cloud 用量日志 API */
  cloudUsage: {
    /** 获取模型调用日志 */
    getUsageLogs: (params?: UsageQueryParams) => Promise<BillingIpcResponse<UsageLogResponse>>
    /** 获取工具调用日志 */
    getToolUsageLogs: (params?: UsageQueryParams) => Promise<BillingIpcResponse<ToolUsageLogResponse>>
    /** 获取语音用量日志 */
    getSpeechUsageLogs: (params?: UsageQueryParams) => Promise<BillingIpcResponse<SpeechUsageLogResponse>>
    /** 获取 Agent API 调用日志 */
    getAgentUsageLogs: (params?: UsageQueryParams) => Promise<BillingIpcResponse<AgentUsageLogResponse>>
  }

  // ===== 数据同步相关 =====

  /** 数据同步 API */
  sync: {
    /** 执行全量同步（首次使用） */
    fullSync: () => Promise<SyncResult>
    /** 执行增量同步 */
    incrementalSync: () => Promise<SyncResult>
    /** 加载更多历史对话（每次 5 个） */
    pullMore: () => Promise<SyncResult>
    /** 从云端下载全部对话 */
    downloadAllConversations: () => Promise<SyncResult>
    /** 获取同步状态 */
    getSyncState: () => Promise<SyncState>
    /** 订阅同步进度事件（返回清理函数） */
    onSyncProgress: (callback: (event: SyncProgressEvent) => void) => () => void
  }

  // ===== GitHub Release 相关 =====

  /** 获取最新 Release */
  getLatestRelease: () => Promise<GitHubRelease | null>
  /** 列出所有 Release */
  listReleases: (options?: GitHubReleaseListOptions) => Promise<GitHubRelease[]>
  /** 根据 tag 获取 Release */
  getReleaseByTag: (tag: string) => Promise<GitHubRelease | null>

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  // ===== 飞书集成 =====

  /** 获取飞书配置 */
  getFeishuConfig: () => Promise<FeishuConfig>
  /** 获取解密后的 App Secret */
  getDecryptedFeishuSecret: () => Promise<string>
  /** 保存飞书配置（appSecret 为明文） */
  saveFeishuConfig: (input: FeishuConfigInput) => Promise<FeishuConfig>
  /** 测试飞书连接 */
  testFeishuConnection: (appId: string, appSecret: string) => Promise<FeishuTestResult>
  /** 启动飞书 Bridge */
  startFeishuBridge: () => Promise<void>
  /** 停止飞书 Bridge */
  stopFeishuBridge: () => Promise<void>
  /** 获取飞书 Bridge 状态 */
  getFeishuStatus: () => Promise<FeishuBridgeState>
  /** 获取活跃绑定列表 */
  listFeishuBindings: () => Promise<FeishuChatBinding[]>
  /** 更新绑定（修改工作区/会话） */
  updateFeishuBinding: (input: FeishuUpdateBindingInput) => Promise<FeishuChatBinding | null>
  /** 移除绑定 */
  removeFeishuBinding: (chatId: string) => Promise<boolean>
  /** 上报用户在场状态 */
  reportFeishuPresence: (report: FeishuPresenceReport) => Promise<void>
  /** 设置会话通知模式 */
  setFeishuSessionNotify: (sessionId: string, mode: FeishuNotifyMode) => Promise<void>
  /** 订阅飞书 Bridge 状态变化 */
  onFeishuStatusChanged: (callback: (state: FeishuBridgeState) => void) => () => void
  /** 订阅飞书通知已发送事件 */
  onFeishuNotificationSent: (callback: (payload: FeishuNotificationSentPayload) => void) => () => void
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

  // 教程
  getTutorialContent: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT)
  },

  createWelcomeConversation: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION)
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

  truncateMessagesFrom: (
    conversationId: string,
    messageId: string,
    preserveFirstMessageAttachments = false,
  ) => {
    return ipcRenderer.invoke(
      CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM,
      conversationId,
      messageId,
      preserveFirstMessageAttachments,
    )
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

  saveImageAs: (localPath: string, defaultFilename: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename)
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

  // 环境检测
  checkEnvironment: () => {
    return ipcRenderer.invoke(ENVIRONMENT_IPC_CHANNELS.CHECK)
  },

  // 代理配置
  getProxySettings: () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_SETTINGS)
  },

  updateProxySettings: (config: ProxyConfig) => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config)
  },

  detectSystemProxy: () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM)
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

  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => {
    const listener = (_: unknown, event: StreamToolActivityEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener) }
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

  migrateChatToAgent: (conversationId: string, agentSessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT, conversationId, agentSessionId)
  },

  togglePinAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE, input)
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

  // Agent 后台任务管理
  getTaskOutput: (input: GetTaskOutputInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input)
  },

  stopTask: (input: StopTaskInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_TASK, input)
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

  testMcpServer: (name: string, entry: import('@proma/shared').McpServerEntry) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry) as Promise<{ success: boolean; message: string }>
  },

  getWorkspaceSkills: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug)
  },

  getWorkspaceSkillsDir: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS_DIR, workspaceSlug)
  },

  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug)
  },

  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_SKILL, workspaceSlug, skillSlug, enabled)
  },

  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => {
    const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_EVENT, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_EVENT, listener) }
  },

  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => {
    const listener = (_: unknown, data: AgentStreamCompletePayload): void => callback(data)
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

  // Agent 权限系统
  respondPermission: (response: PermissionResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response)
  },

  getPermissionMode: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PERMISSION_MODE, workspaceSlug)
  },

  setPermissionMode: (workspaceSlug: string, mode: PromaPermissionMode) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SET_PERMISSION_MODE, workspaceSlug, mode)
  },

  getMemoryConfig: () => {
    return ipcRenderer.invoke(MEMORY_IPC_CHANNELS.GET_CONFIG)
  },

  setMemoryConfig: (config: MemoryConfig) => {
    return ipcRenderer.invoke(MEMORY_IPC_CHANNELS.SET_CONFIG, config)
  },

  testMemoryConnection: () => {
    return ipcRenderer.invoke(MEMORY_IPC_CHANNELS.TEST_CONNECTION)
  },

  // Chat 工具管理
  getChatTools: () => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS)
  },

  getChatToolCredentials: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS, toolId)
  },

  updateChatToolState: (toolId: string, state: ChatToolState) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE, toolId, state)
  },

  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS, toolId, credentials)
  },

  createCustomChatTool: (meta: ChatToolMeta) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL, meta)
  },

  deleteCustomChatTool: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL, toolId)
  },

  onCustomToolChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener)
    return () => { ipcRenderer.removeListener(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener) }
  },

  testChatTool: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.TEST_TOOL, toolId)
  },

  // AskUserQuestion 交互式问答
  respondAskUser: (response: AskUserResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response)
  },

  // Agent Teams 数据
  getAgentTeamData: (sdkSessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TEAM_DATA, sdkSessionId)
  },

  getAgentOutput: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_AGENT_OUTPUT, filePath)
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

  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE, input)
  },

  getWorkspaceFilesPath: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH, workspaceSlug)
  },

  openFolderDialog: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG)
  },

  attachDirectory: (input: AgentAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_DIRECTORY, input)
  },

  detachDirectory: (input: AgentAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_DIRECTORY, input)
  },

  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY, input)
  },

  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY, input)
  },

  getWorkspaceDirectories: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES, workspaceSlug)
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

  previewFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_FILE, filePath)
  },

  renameFile: (filePath: string, newName: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName)
  },

  moveFile: (filePath: string, targetDir: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir)
  },

  listAttachedDirectory: (dirPath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath)
  },

  openAttachedFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_ATTACHED_FILE, filePath)
  },

  showAttachedInFolder: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath)
  },

  renameAttachedFile: (filePath: string, newName: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName)
  },

  moveAttachedFile: (filePath: string, targetDir: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir)
  },

  searchWorkspaceFiles: (rootPath: string, query: string, limit = 20, additionalPaths?: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths)
  },

  // 系统提示词管理
  getSystemPromptConfig: () => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG)
  },

  createSystemPrompt: (input: SystemPromptCreateInput) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.CREATE, input)
  },

  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE, id, input)
  },

  deleteSystemPrompt: (id: string) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.DELETE, id)
  },

  updateAppendSetting: (enabled: boolean) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING, enabled)
  },

  setDefaultPrompt: (id: string | null) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT, id)
  },

  // 自动更新（仅版本检测，不自动下载/安装）
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
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
    updateProfile: (data: { name?: string; image?: string }) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.UPDATE_PROFILE, data)
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

  // Cloud API Key 管理
  cloudApiKeys: {
    list: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LIST_API_KEYS)
    },
    create: (params: ApiKeyCreateParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_API_KEY, params)
    },
    update: (keyId: string, params: ApiKeyUpdateParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.UPDATE_API_KEY, keyId, params)
    },
    delete: (keyId: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.DELETE_API_KEY, keyId)
    },
  },

  // Cloud 订阅
  cloudSubscription: {
    getTiers: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_TIERS)
    },
    getCurrent: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_CURRENT)
    },
    createWechatPayment: (tierId: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_SUBSCRIPTION_WECHAT, tierId)
    },
    getOrderStatus: (orderNo: string) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_ORDER_STATUS, orderNo)
    },
    getHistory: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_HISTORY)
    },
  },

  // Cloud 提示词下载
  cloudPrompts: {
    download: () => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.DOWNLOAD_CLOUD_PROMPTS)
    },
  },

  // Cloud 用量日志
  cloudUsage: {
    getUsageLogs: (params?: UsageQueryParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_USAGE_LOGS, params)
    },
    getToolUsageLogs: (params?: UsageQueryParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_TOOL_USAGE_LOGS, params)
    },
    getSpeechUsageLogs: (params?: UsageQueryParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SPEECH_USAGE_LOGS, params)
    },
    getAgentUsageLogs: (params?: UsageQueryParams) => {
      return ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_AGENT_USAGE_LOGS, params)
    },
  },

  // 数据同步
  sync: {
    fullSync: () => {
      return ipcRenderer.invoke(SYNC_IPC_CHANNELS.FULL_SYNC)
    },
    incrementalSync: () => {
      return ipcRenderer.invoke(SYNC_IPC_CHANNELS.INCREMENTAL_SYNC)
    },
    pullMore: () => {
      return ipcRenderer.invoke(SYNC_IPC_CHANNELS.PULL_MORE)
    },
    downloadAllConversations: () => {
      return ipcRenderer.invoke(SYNC_IPC_CHANNELS.DOWNLOAD_ALL_CONVERSATIONS)
    },
    getSyncState: () => {
      return ipcRenderer.invoke(SYNC_IPC_CHANNELS.GET_SYNC_STATE)
    },
    onSyncProgress: (callback: (event: SyncProgressEvent) => void) => {
      const listener = (_: unknown, event: SyncProgressEvent): void => callback(event)
      ipcRenderer.on(SYNC_IPC_CHANNELS.SYNC_PROGRESS, listener)
      return () => { ipcRenderer.removeListener(SYNC_IPC_CHANNELS.SYNC_PROGRESS, listener) }
    },
  },

  // GitHub Release
  getLatestRelease: () => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE)
  },

  listReleases: (options) => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options)
  },

  getReleaseByTag: (tag) => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag)
  },

  // ===== 飞书集成 =====

  getFeishuConfig: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_CONFIG)
  },

  getDecryptedFeishuSecret: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET)
  },

  saveFeishuConfig: (input: FeishuConfigInput) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_CONFIG, input)
  },

  testFeishuConnection: (appId: string, appSecret: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.TEST_CONNECTION, appId, appSecret)
  },

  startFeishuBridge: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BRIDGE)
  },

  stopFeishuBridge: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BRIDGE)
  },

  getFeishuStatus: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_STATUS)
  },

  listFeishuBindings: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.LIST_BINDINGS)
  },

  updateFeishuBinding: (input: FeishuUpdateBindingInput) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.UPDATE_BINDING, input)
  },

  removeFeishuBinding: (chatId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BINDING, chatId)
  },

  reportFeishuPresence: (report: FeishuPresenceReport) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REPORT_PRESENCE, report)
  },

  setFeishuSessionNotify: (sessionId: string, mode: FeishuNotifyMode) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SET_SESSION_NOTIFY, sessionId, mode)
  },

  onFeishuStatusChanged: (callback: (state: FeishuBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: FeishuBridgeState): void => callback(state)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  onFeishuNotificationSent: (callback: (payload: FeishuNotificationSentPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: FeishuNotificationSentPayload): void => callback(payload)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.NOTIFICATION_SENT, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.NOTIFICATION_SENT, listener) }
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
