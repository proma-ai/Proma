/**
 * Agent 相关类型定义
 *
 * 包含 Agent SDK 集成所需的事件类型、会话管理、消息持久化和 IPC 通道常量。
 */

// ===== 记忆配置 =====

/** 全局记忆配置（MemOS Cloud） */
export interface MemoryConfig {
  /** 是否启用记忆功能 */
  enabled: boolean
  /** MemOS Cloud API Key */
  apiKey: string
  /** 用户标识 */
  userId: string
  /** 自定义 API 地址（可选，默认 MemOS Cloud） */
  baseUrl?: string
}

/**
 * 全局记忆配置 IPC 通道常量
 */
export const MEMORY_IPC_CHANNELS = {
  /** 获取全局记忆配置 */
  GET_CONFIG: 'memory:get-config',
  /** 保存全局记忆配置 */
  SET_CONFIG: 'memory:set-config',
  /** 测试记忆连接 */
  TEST_CONNECTION: 'memory:test-connection',
} as const

// ===== Agent 工作区 =====

/** Agent 工作区 */
export interface AgentWorkspace {
  /** 工作区唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** URL-safe 目录名（创建后不可变） */
  slug: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

// ===== Agent 事件类型 =====

/** 错误代码 */
export type ErrorCode =
  | 'invalid_api_key'
  | 'invalid_credentials'
  | 'response_too_large'
  | 'expired_oauth_token'
  | 'token_expired'
  | 'rate_limited'
  | 'service_error'
  | 'service_unavailable'
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'
  | 'billing_error'
  | 'model_no_tool_support'
  | 'invalid_model'
  | 'data_policy_error'
  | 'invalid_request'
  | 'image_too_large'
  | 'provider_error'
  | 'unknown_error'

/** 恢复操作 */
export interface RecoveryAction {
  /** 操作键（用于快捷键） */
  key: string
  /** 操作标签 */
  label: string
  /** 操作类型 */
  action: 'settings' | 'retry' | 'cancel' | string
}

/** 类型化错误 */
export interface TypedError {
  /** 错误代码，用于程序化处理 */
  code: ErrorCode
  /** 用户友好的标题 */
  title: string
  /** 详细的错误消息 */
  message: string
  /** 建议的恢复操作 */
  actions: RecoveryAction[]
  /** 是否可以自动重试 */
  canRetry: boolean
  /** 重试延迟（毫秒） */
  retryDelayMs?: number
  /** 诊断详情（用于调试） */
  details?: string[]
  /** 原始错误消息（用于调试） */
  originalError?: string
}

/** Agent 事件 Usage 信息 */
export interface AgentEventUsage {
  inputTokens: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
}

/**
 * 重试尝试记录
 *
 * 记录每次重试尝试的详细信息，用于错误诊断和 UI 展示。
 */
export interface RetryAttempt {
  /** 第几次尝试 (1-based) */
  attempt: number
  /** 时间戳 */
  timestamp: number
  /** 错误原因（简短描述，如"SDK 响应超时"） */
  reason: string
  /** 完整错误消息 */
  errorMessage: string
  /** stderr 输出（可选） */
  stderr?: string
  /** 堆栈跟踪（可选） */
  stack?: string
  /** 运行环境信息（可选） */
  environment?: {
    /** 运行时，如 "Bun 1.0.0" */
    runtime: string
    /** 平台，如 "darwin arm64" */
    platform: string
    /** 模型，如 "claude-sonnet-4-5-20250929" */
    model: string
    /** 工作区名称 */
    workspace?: string
    /** 工作目录 */
    cwd?: string
  }
  /** 延迟秒数 */
  delaySeconds: number
}

/**
 * Agent 事件类型
 *
 * 从 SDK 消息转换而来的扁平事件流，用于驱动 UI 渲染。
 */
export type AgentEvent =
  // 文本流式输出
  | { type: 'text_delta'; text: string; turnId?: string; parentToolUseId?: string }
  | { type: 'text_complete'; text: string; isIntermediate: boolean; turnId?: string; parentToolUseId?: string }
  // 工具执行
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; toolName?: string; result: string; isError: boolean; input?: Record<string, unknown>; turnId?: string; parentToolUseId?: string }
  // 后台任务
  | { type: 'task_backgrounded'; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string; turnId?: string }
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 控制流
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  // 重试机制
  | { type: 'retrying'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string }  // 保留向后兼容
  | { type: 'retry_attempt'; attemptData: RetryAttempt }  // 新增：记录详细尝试信息
  | { type: 'retry_cleared' }  // 新增：重试成功，清除状态
  | { type: 'retry_failed'; finalAttempt: RetryAttempt }  // 新增：重试失败
  // Usage 更新
  | { type: 'usage_update'; usage: { inputTokens: number; contextWindow?: number } }
  // 上下文压缩
  | { type: 'compacting' }
  | { type: 'compact_complete' }
  // 权限请求
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  // AskUserQuestion 交互式问答
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  // 提示建议
  | { type: 'prompt_suggestion'; suggestion: string }

// ===== Agent 会话管理 =====

/**
 * Agent 会话轻量索引项
 *
 * 存储在 ~/.proma/agent-sessions.json 中，
 * 类似 ConversationMeta，独立存储。
 */
export interface AgentSessionMeta {
  /** 会话唯一标识 */
  id: string
  /** 会话标题 */
  title: string
  /** 使用的渠道 ID */
  channelId?: string
  /** SDK 内部会话 ID（用于 resume 衔接上下文） */
  sdkSessionId?: string
  /** 所属工作区 ID */
  workspaceId?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * Agent 持久化消息
 *
 * 存储在 ~/.proma/agent-sessions/{id}.jsonl 中。
 */
export interface AgentMessage {
  /** 消息唯一标识 */
  id: string
  /** 角色 */
  role: 'user' | 'assistant' | 'tool' | 'status'
  /** 消息内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** 使用的模型 ID（assistant 消息） */
  model?: string
  /** 工具活动数据（agent 事件列表，用于回放工具调用） */
  events?: AgentEvent[]
  /** 错误代码（status 消息，role='status' 时使用） */
  errorCode?: ErrorCode
  /** 错误标题（status 消息） */
  errorTitle?: string
  /** 错误详细信息（status 消息） */
  errorDetails?: string[]
  /** 原始错误消息（status 消息） */
  errorOriginal?: string
  /** 是否可以重试（status 消息） */
  errorCanRetry?: boolean
  /** 错误恢复操作（status 消息） */
  errorActions?: RecoveryAction[]
}

// ===== Agent 标题生成输入 =====

/** Agent 标题生成输入 */
export interface AgentGenerateTitleInput {
  /** 用户第一条消息内容 */
  userMessage: string
  /** 渠道 ID（用于获取 API Key） */
  channelId: string
  /** 模型 ID */
  modelId: string
}

// ===== MCP 服务器配置 =====

/** MCP 传输类型 */
export type McpTransportType = 'stdio' | 'http' | 'sse'

/** MCP 服务器条目 */
export interface McpServerEntry {
  type: McpTransportType
  /** stdio: 可执行命令 */
  command?: string
  /** stdio: 命令参数 */
  args?: string[]
  /** stdio: 环境变量 */
  env?: Record<string, string>
  /** http/sse: 服务端 URL */
  url?: string
  /** http/sse: 请求头 */
  headers?: Record<string, string>
  /** 是否启用 */
  enabled: boolean
  /** 是否为内置 MCP（不可删除，仅可配置 env） */
  isBuiltin?: boolean
  /** 最后一次测试结果 */
  lastTestResult?: {
    success: boolean
    message: string
    timestamp: number
  }
}

/** 工作区 MCP 配置文件 */
export interface WorkspaceMcpConfig {
  servers: Record<string, McpServerEntry>
}

// ===== Skill 元数据 =====

/** 工作区 Skill 元数据 */
export interface SkillMeta {
  slug: string
  name: string
  description?: string
  icon?: string
}

/** 工作区能力摘要（MCP + Skill 计数） */
export interface WorkspaceCapabilities {
  mcpServers: Array<{ name: string; enabled: boolean; type: McpTransportType }>
  skills: SkillMeta[]
}

// ===== Agent 发送输入 =====

/**
 * Agent 发送消息的输入参数
 */
export interface AgentSendInput {
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 渠道 ID（用于获取 API Key） */
  channelId: string
  /** 模型 ID */
  modelId?: string
  /** 工作区 ID（用于确定 cwd） */
  workspaceId?: string
}

// ===== 后台任务管理 =====

/**
 * 获取任务输出请求
 */
export interface GetTaskOutputInput {
  /** 任务 ID */
  taskId: string
  /** 是否阻塞等待完成（默认 false） */
  block?: boolean
}

/**
 * 获取任务输出响应
 */
export interface GetTaskOutputResult {
  /** 任务输出内容 */
  output: string
  /** 任务是否已完成 */
  isComplete: boolean
}

/**
 * 停止任务请求
 */
export interface StopTaskInput {
  /** 会话 ID */
  sessionId: string
  /** 任务 ID */
  taskId: string
  /** 任务类型 */
  type: 'agent' | 'shell'
}

// ===== Agent 流式事件载荷 =====

/**
 * Agent 流式事件（主进程 → 渲染进程推送）
 */
export interface AgentStreamEvent {
  /** 会话 ID */
  sessionId: string
  /** 事件数据 */
  event: AgentEvent
}

/**
 * Agent 流式完成事件载荷（主进程 → 渲染进程）
 * 包含已持久化的消息列表，避免异步重新加载的竞态窗口。
 */
export interface AgentStreamCompletePayload {
  sessionId: string
  /** 已持久化的完整消息列表 */
  messages?: AgentMessage[]
}

// ===== 文件浏览器 =====

/** 文件/目录条目（用于文件浏览器树形视图） */
export interface FileEntry {
  /** 文件/目录名称 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 子条目（懒加载，仅目录展开时填充） */
  children?: FileEntry[]
}

// ===== Agent 附件 =====

/** Agent 待发送文件（UI 侧暂存） */
export interface AgentPendingFile {
  id: string
  filename: string
  size: number
  mediaType: string
  /** 图片预览 URL（blob/data URL） */
  previewUrl?: string
}

/** Agent 文件保存到 session 的输入 */
export interface AgentSaveFilesInput {
  workspaceSlug: string
  sessionId: string
  files: Array<{ filename: string; data: string }>
}

/** Agent 已保存文件信息 */
export interface AgentSavedFile {
  filename: string
  targetPath: string
}

/** Agent 复制文件夹到 session 的输入 */
export interface AgentCopyFolderInput {
  sourcePath: string
  workspaceSlug: string
  sessionId: string
}

// ===== AskUserQuestion 交互式问答类型 =====

/** AskUserQuestion 工具的选项定义 */
export interface AskUserQuestionOption {
  /** 选项显示文本 */
  label: string
  /** 选项说明 */
  description?: string
}

/** AskUserQuestion 工具的问题定义 */
export interface AskUserQuestion {
  /** 问题内容 */
  question: string
  /** 短标签（chip 显示） */
  header?: string
  /** 可选项列表 */
  options: AskUserQuestionOption[]
  /** 是否支持多选 */
  multiSelect?: boolean
}

/** AskUser 请求（主进程 → 渲染进程） */
export interface AskUserRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 问题列表 */
  questions: AskUserQuestion[]
  /** 工具原始输入（用于构建 updatedInput） */
  toolInput: Record<string, unknown>
}

/** AskUser 响应（渲染进程 → 主进程） */
export interface AskUserResponse {
  /** 请求 ID */
  requestId: string
  /** 用户答案（问题索引字符串 → 答案文本） */
  answers: Record<string, string>
}

// ===== 权限系统类型 =====

/** Proma 权限模式 */
export type PromaPermissionMode = 'auto' | 'smart' | 'supervised'

/** 权限模式定义顺序（用于循环切换） */
export const PROMA_PERMISSION_MODE_ORDER: readonly PromaPermissionMode[] = ['auto', 'smart', 'supervised']

/** 危险等级 */
export type DangerLevel = 'safe' | 'normal' | 'dangerous'

/** 权限请求（主进程 → 渲染进程） */
export interface PermissionRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 工具名称 */
  toolName: string
  /** 工具输入参数 */
  toolInput: Record<string, unknown>
  /** 操作描述（人类可读） */
  description: string
  /** 具体命令（Bash 工具时有值） */
  command?: string
  /** 危险等级 */
  dangerLevel: DangerLevel
  /** SDK 提供的原因说明 */
  decisionReason?: string
}

/** 权限响应（渲染进程 → 主进程） */
export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  /** 是否记住选择（加入会话白名单） */
  alwaysAllow: boolean
}

// ===== IPC 通道常量 =====

/**
 * Agent 相关 IPC 通道常量
 */
export const AGENT_IPC_CHANNELS = {
  // 会话管理
  /** 获取会话列表 */
  LIST_SESSIONS: 'agent:list-sessions',
  /** 创建会话 */
  CREATE_SESSION: 'agent:create-session',
  /** 获取会话消息 */
  GET_MESSAGES: 'agent:get-messages',
  /** 更新会话标题 */
  UPDATE_TITLE: 'agent:update-title',
  /** 删除会话 */
  DELETE_SESSION: 'agent:delete-session',

  // 工作区管理
  /** 获取工作区列表 */
  LIST_WORKSPACES: 'agent:list-workspaces',
  /** 创建工作区 */
  CREATE_WORKSPACE: 'agent:create-workspace',
  /** 更新工作区 */
  UPDATE_WORKSPACE: 'agent:update-workspace',
  /** 删除工作区 */
  DELETE_WORKSPACE: 'agent:delete-workspace',

  // 标题生成
  /** 生成 Agent 会话标题 */
  GENERATE_TITLE: 'agent:generate-title',

  // 消息发送
  /** 发送消息（触发 Agent 流式响应） */
  SEND_MESSAGE: 'agent:send-message',
  /** 中止 Agent 执行 */
  STOP_AGENT: 'agent:stop',

  // 后台任务管理
  /** 获取任务输出 */
  GET_TASK_OUTPUT: 'agent:get-task-output',
  /** 停止任务 */
  STOP_TASK: 'agent:stop-task',

  // 工作区能力（MCP + Skill）
  /** 获取工作区能力摘要 */
  GET_CAPABILITIES: 'agent:get-capabilities',
  /** 获取工作区 MCP 配置 */
  GET_MCP_CONFIG: 'agent:get-mcp-config',
  /** 保存工作区 MCP 配置 */
  SAVE_MCP_CONFIG: 'agent:save-mcp-config',
  /** 测试 MCP 服务器连接 */
  TEST_MCP_SERVER: 'agent:test-mcp-server',
  /** 获取工作区 Skill 列表 */
  GET_SKILLS: 'agent:get-skills',
  /** 删除工作区 Skill */
  DELETE_SKILL: 'agent:delete-skill',

  // 流式事件（主进程 → 渲染进程推送）
  /** Agent 流式事件 */
  STREAM_EVENT: 'agent:stream:event',
  /** Agent 流式完成 */
  STREAM_COMPLETE: 'agent:stream:complete',
  /** Agent 流式错误 */
  STREAM_ERROR: 'agent:stream:error',

  // 附件
  /** 保存文件到 Agent session 工作目录 */
  SAVE_FILES_TO_SESSION: 'agent:save-files-to-session',
  /** 打开文件夹选择对话框 */
  OPEN_FOLDER_DIALOG: 'agent:open-folder-dialog',
  /** 复制文件夹到 session 工作目录 */
  COPY_FOLDER_TO_SESSION: 'agent:copy-folder-to-session',

  // 文件系统操作
  /** 获取 session 工作路径 */
  GET_SESSION_PATH: 'agent:get-session-path',
  /** 列出目录内容 */
  LIST_DIRECTORY: 'agent:list-directory',
  /** 删除文件/空目录 */
  DELETE_FILE: 'agent:delete-file',
  /** 用系统默认应用打开文件 */
  OPEN_FILE: 'agent:open-file',
  /** 在系统文件管理器中显示文件 */
  SHOW_IN_FOLDER: 'agent:show-in-folder',

  // 标题自动生成通知（主进程 → 渲染进程推送）
  /** 标题已更新（首次对话完成后自动生成） */
  TITLE_UPDATED: 'agent:title-updated',

  // 工作区配置变化通知（主进程 → 渲染进程推送）
  /** 工作区能力变化（MCP/Skills 文件监听触发） */
  CAPABILITIES_CHANGED: 'agent:capabilities-changed',
  /** 工作区文件变化（session 目录文件监听触发，用于文件浏览器刷新） */
  WORKSPACE_FILES_CHANGED: 'agent:workspace-files-changed',

  // 权限系统
  /** 权限请求（主进程 → 渲染进程推送） */
  PERMISSION_REQUEST: 'agent:permission:request',
  /** 权限响应（渲染进程 → 主进程） */
  PERMISSION_RESPOND: 'agent:permission:respond',
  /** 设置权限模式（渲染进程 → 主进程） */
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  /** 获取权限模式（渲染进程 → 主进程） */
  GET_PERMISSION_MODE: 'agent:get-permission-mode',

  // AskUserQuestion 交互式问答
  /** AskUser 请求（主进程 → 渲染进程推送） */
  ASK_USER_REQUEST: 'agent:ask-user:request',
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: 'agent:ask-user:respond',
} as const
