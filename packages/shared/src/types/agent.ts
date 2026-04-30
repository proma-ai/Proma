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

// ===== SDK 新增类型声明（0.2.52 ~ 0.2.63） =====

/**
 * 思考模式配置
 *
 * 控制 Claude 的推理/思考行为：
 * - adaptive: Claude 自行决定何时以及思考多少（Opus 4.6+ 默认）
 * - enabled: 固定思考 Token 预算（旧模型）
 * - disabled: 不使用扩展思考
 */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * 推理深度等级
 *
 * 与 adaptive thinking 配合使用，引导思考深度：
 * - low: 最少思考，最快响应
 * - medium: 适度思考
 * - high: 深度推理（默认）
 * - max: 最大深度（仅 Opus 4.6）
 */
export type AgentEffort = 'low' | 'medium' | 'high' | 'max'

/**
 * 自定义子代理定义
 *
 * 通过 SDK 的 agents 选项注册可被 Agent 工具调用的自定义子代理。
 */
export interface AgentDefinition {
  /** 自然语言描述，说明何时使用该代理 */
  description: string
  /** 允许使用的工具名称列表，省略则继承父级所有工具 */
  tools?: string[]
  /** 明确禁止使用的工具名称列表 */
  disallowedTools?: string[]
  /** 自定义系统提示词 */
  prompt?: string
  /** 使用的模型（覆盖父级） */
  model?: string
  /** 最大轮次（覆盖父级） */
  maxTurns?: number
}

/**
 * SDK 会话信息（listSessions 返回）
 *
 * SDK 0.2.53 新增，用于发现和列出历史会话。
 */
export interface SDKSessionInfo {
  /** 会话 ID */
  sessionId: string
  /** 项目路径 */
  projectPath?: string
  /** 会话标题（从 transcript 提取） */
  title?: string
  /** 创建时间 ISO 字符串 */
  createdAt?: string
  /** 最后更新时间 ISO 字符串 */
  lastUpdatedAt?: string
  /** 消息计数概要 */
  messageCount?: number
}

/**
 * SDK 会话消息（getSessionMessages 返回）
 *
 * SDK 0.2.59 新增，用于读取会话的完整对话历史。
 */
export interface SDKSessionMessage {
  /** 消息类型（SDK 原始类型标识） */
  type: string
  /** 消息角色 */
  role?: 'user' | 'assistant'
  /** 消息内容 */
  content?: unknown
  /** 时间戳 */
  timestamp?: string
}

/**
 * SDK Beta 特性标识
 *
 * 当前支持：
 * - context-1m-2025-08-07: 启用 1M token 上下文窗口（Claude Sonnet 4+ / Opus 4.6+、DeepSeek V4 系列）
 */
export type SdkBeta = 'context-1m-2025-08-07'

/**
 * JSON Schema 输出格式
 *
 * 用于指定结构化输出，Agent 将返回符合 Schema 的 JSON 数据。
 */
export interface JsonSchemaOutputFormat {
  type: 'json_schema'
  /** JSON Schema 定义 */
  schema: Record<string, unknown>
  /** Schema 名称（可选） */
  name?: string
  /** Schema 描述（可选） */
  description?: string
}

// ===== SDK 消息类型（直接透传，不再翻译） =====

/** SDK 文本内容块 */
export interface SDKTextBlock {
  type: 'text'
  text: string
}

/** SDK 工具调用内容块 */
export interface SDKToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** SDK 思考内容块 */
export interface SDKThinkingBlock {
  type: 'thinking'
  thinking: string
}

/** SDK 内容块联合类型 */
export type SDKContentBlock =
  | SDKTextBlock
  | SDKToolUseBlock
  | SDKThinkingBlock
  | { type: string; [key: string]: unknown }

/** SDK tool_result 内容块（在 user 消息中） */
export interface SDKToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

/** SDK user 消息内容块联合类型 */
export type SDKUserContentBlock =
  | SDKToolResultBlock
  | SDKTextBlock
  | { type: string; [key: string]: unknown }

/** SDK assistant 消息 */
export interface SDKAssistantMessage {
  type: 'assistant'
  message: {
    content: SDKContentBlock[]
    usage?: {
      input_tokens: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    model?: string
    stop_reason?: string
  }
  parent_tool_use_id: string | null
  session_id?: string
  /** SDK 消息唯一标识，用于 forkSession / resumeSessionAt */
  uuid?: string
  error?: { message: string; errorType?: string }
  isReplay?: boolean
  /** 渠道配置的模型 ID，持久化/流式期间注入，用于正确匹配模型显示名 */
  _channelModelId?: string
}

/** SDK user 消息 */
export interface SDKUserMessage {
  type: 'user'
  message?: {
    content?: SDKUserContentBlock[]
  }
  parent_tool_use_id: string | null
  session_id?: string
  /** SDK 消息唯一标识 */
  uuid?: string
  tool_use_result?: unknown
  isReplay?: boolean
  /** SDK 合成的消息（如 Skill 展开 prompt），非人类用户输入 */
  isSynthetic?: boolean
}

/** SDK result 消息（查询结束时返回） */
export interface SDKResultMessage {
  type: 'result'
  subtype: 'success' | 'error' | 'error_max_turns' | 'error_max_budget_usd' | 'error_during_execution' | (string & {})
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  total_cost_usd?: number
  modelUsage?: Record<string, { contextWindow?: number }>
  errors?: string[]
  session_id?: string
}

/** SDK system 消息（init / compact_boundary / task_started / task_progress / task_notification） */
export interface SDKSystemMessage {
  type: 'system'
  subtype?: string
  session_id?: string
  /** init: 确认的模型 */
  model?: string
  /** task 相关字段 */
  task_id?: string
  description?: string
  task_type?: string
  tool_use_id?: string
  status?: string
  summary?: string
  output_file?: string
  last_tool_name?: string
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
  [key: string]: unknown
}

/** SDK tool_progress 消息（工具执行心跳） */
export interface SDKToolProgressMessage {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds?: number
  /** Agent Teams: 所属 teammate 任务 ID */
  task_id?: string
  session_id?: string
}

/** SDK prompt_suggestion 消息 */
export interface SDKPromptSuggestionMessage {
  type: 'prompt_suggestion'
  suggestion?: string
  session_id?: string
}

/** SDK tool_use_summary 消息 */
export interface SDKToolUseSummaryMessage {
  type: 'tool_use_summary'
  summary?: string
  preceding_tool_use_ids?: string[]
  session_id?: string
}

/** SDK 消息联合类型（v1 query + includePartialMessages: false 返回的完整 JSON 对象） */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKToolProgressMessage
  | SDKPromptSuggestionMessage
  | SDKToolUseSummaryMessage
  | { type: string; session_id?: string; parent_tool_use_id?: string | null; [key: string]: unknown }

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
  | 'prompt_too_long'
  | 'provider_error'
  // 环境 / 配置类错误（本地可修复）
  | 'windows_shell_missing'
  | 'channel_not_found'
  | 'api_key_decrypt_failed'
  | 'claude_binary_not_found'
  | 'session_busy'
  | 'unknown_error'

/** 恢复操作 */
export interface RecoveryAction {
  /** 操作键（用于快捷键） */
  key: string
  /** 操作标签 */
  label: string
  /** 操作类型 */
  action:
    | 'settings'
    | 'retry'
    | 'cancel'
    | 'compact'
    | 'open_environment_check'
    | 'open_channel_settings'
    | 'open_external'
    | (string & {})
  /** 操作附带的载荷，例如 open_external 的 URL */
  payload?: string
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

/** Teammate 任务用量统计 */
export interface TaskUsage {
  /** 总 Token 数 */
  totalTokens: number
  /** 工具调用次数 */
  toolUses: number
  /** 运行耗时（毫秒） */
  durationMs: number
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
/** MCP 工具结果中的图片附件 */
export interface AgentToolResultImage {
  localPath: string
  filename: string
  mediaType: string
}

/**
 * Agent 事件流类型
 *
 * 从 SDK 消息转换而来的扁平事件流，用于驱动 UI 渲染。
 */
export type AgentEvent =
  // 文本流式输出
  | { type: 'text_delta'; text: string; turnId?: string; parentToolUseId?: string }
  | { type: 'text_complete'; text: string; isIntermediate: boolean; turnId?: string; parentToolUseId?: string }
  // 工具执行
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; toolName?: string; result: string; isError: boolean; input?: Record<string, unknown>; turnId?: string; parentToolUseId?: string; imageAttachments?: AgentToolResultImage[] }
  // 后台任务
  | { type: 'task_backgrounded'; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string; turnId?: string }
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds?: number; turnId?: string; taskId?: string; description?: string; lastToolName?: string; usage?: TaskUsage }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; status: 'completed' | 'failed' | 'stopped'; summary: string; outputFile?: string; usage?: TaskUsage; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 工具使用摘要
  | { type: 'tool_use_summary'; summary: string; precedingToolUseIds: string[] }
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
  | { type: 'usage_update'; usage: AgentEventUsage }
  // 上下文压缩
  | { type: 'compacting' }
  | { type: 'compact_complete' }
  // 权限请求
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  // AskUserQuestion 交互式问答
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  // ExitPlanMode 计划审批
  | { type: 'exit_plan_mode_request'; request: ExitPlanModeRequest }
  | { type: 'exit_plan_mode_resolved'; requestId: string }
  // EnterPlanMode 进入计划模式
  | { type: 'enter_plan_mode'; sessionId: string }
  // 提示建议
  | { type: 'prompt_suggestion'; suggestion: string }
  // 模型确认（SDK 确认实际使用的模型）
  | { type: 'model_resolved'; model: string }
  // Auto-Resume（Teams 完成后自动收集结果）
  | { type: 'waiting_resume'; message: string }
  | { type: 'resume_start'; messageId: string }
  // 权限模式变更（Plan → bypassPermissions 等）
  | { type: 'permission_mode_changed'; mode: PromaPermissionMode }

// ===== Proma 内部事件（SDK 不覆盖的场景） =====

/** Proma 内部事件类型 */
export type PromaEvent =
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  | { type: 'exit_plan_mode_request'; request: ExitPlanModeRequest }
  | { type: 'exit_plan_mode_resolved'; requestId: string }
  | { type: 'enter_plan_mode'; sessionId: string }
  | { type: 'retry'; status: 'starting' | 'attempt' | 'cleared' | 'failed'; attempt?: number; maxAttempts?: number; delaySeconds?: number; reason?: string; attemptData?: RetryAttempt; error?: TypedError }
  | { type: 'model_resolved'; model: string }
  | { type: 'waiting_resume'; message: string }
  | { type: 'resume_start'; messageId: string }
  | { type: 'permission_mode_changed'; mode: PromaPermissionMode }


/** IPC 传输的统一 payload（替代 AgentEvent） */
export type AgentStreamPayload =
  | { kind: 'sdk_message'; message: SDKMessage }
  | { kind: 'proma_event'; event: PromaEvent }

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
  /** 是否置顶 */
  pinned?: boolean
  /** 是否已归档 */
  archived?: boolean
  /** 附加的外部目录路径列表（绝对路径，作为 SDK additionalDirectories 传递） */
  attachedDirectories?: string[]
  /** 分叉来源：源会话的 Proma 工作目录（SDK session 文件在此目录的项目空间中，首次 resume 后清除） */
  forkSourceDir?: string
  /** 分叉来源：源会话的 SDK session ID（用于 rewind 时读取源会话的 file-history-snapshot 和备份文件） */
  forkSourceSdkSessionId?: string
  /** 回退后的 resume 截断点：下次发消息时传给 SDK resumeSessionAt（消费后清除） */
  resumeAtMessageUuid?: string
  /** 手动标记为工作中 */
  manualWorking?: boolean
  /** 最后一次流式执行是否被用户主动中断 */
  stoppedByUser?: boolean
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
  /** 耗时（毫秒），assistant 消息从流式开始到完成的时间 */
  durationMs?: number
  /** Token 用量明细（assistant 消息完成时记录） */
  usage?: AgentEventUsage
}

// ===== Agent 消息搜索 =====

/**
 * Agent 会话消息搜索结果
 */
export interface AgentMessageSearchResult {
  /** 会话 ID */
  sessionId: string
  /** 会话标题 */
  sessionTitle: string
  /** 消息 ID */
  messageId: string
  /** 消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'status'
  /** 匹配上下文片段（约 80 字符） */
  snippet: string
  /** snippet 内匹配起始位置 */
  matchStart: number
  /** 匹配长度 */
  matchLength: number
  /** 是否已归档 */
  archived?: boolean
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
  /** 启动超时（秒），仅 stdio 类型有效，默认 30 */
  timeout?: number
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

/** 从其他工作区导入的 Skill 来源元数据 */
export interface SkillImportSource {
  sourceWorkspaceSlug: string
  sourceWorkspaceName: string
  importedAt: string        // ISO 8601
  sourceVersion: string     // 导入时源 Skill 的 version，无则 '0.0.0'
}

/** 工作区 Skill 元数据 */
export interface SkillMeta {
  slug: string
  name: string
  description?: string
  icon?: string
  version?: string
  enabled: boolean
  /** 如果此 Skill 是从其他工作区导入的，则携带来源信息 */
  importSource?: SkillImportSource
  /** 是否有可用更新（源 Skill 版本 > importSource.sourceVersion） */
  hasUpdate?: boolean
}

/** 其他工作区 Skill 分组（导入对话框用） */
export interface OtherWorkspaceSkillsGroup {
  workspaceName: string
  workspaceSlug: string
  skills: SkillMeta[]
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
  /** 附加的外部目录（绝对路径，传递给 SDK additionalDirectories） */
  additionalDirectories?: string[]
  /** 动态注入的 MCP 服务器（仅在本次会话中生效，如飞书群聊工具） */
  customMcpServers?: Record<string, Record<string, unknown>>
  /** 强制覆盖权限模式（飞书等无 UI 交互场景下强制 'bypassPermissions'） */
  permissionModeOverride?: PromaPermissionMode
  /** 用户通过 /skill:xxx 引用的 Skill slug 列表 */
  mentionedSkills?: string[]
  /** 用户通过 #mcp:xxx 引用的 MCP 服务器名称列表 */
  mentionedMcpServers?: string[]
  /** 渲染进程生成的流式开始时间戳，主进程原样回传到 STREAM_COMPLETE，确保竞态保护比较的是同一个值 */
  startedAt?: number
}

// ===== Agent 队列消息 =====

/** 流式追加消息的输入参数（Agent 流式中发送新消息） */
export interface AgentQueueMessageInput {
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 前端预生成的 UUID（用于乐观更新去重） */
  uuid?: string
  /**
   * 软中断当前 Agent turn 后再追加消息。
   * true：先调用 SDK query.interrupt() 立即打断正在输出的 turn，再注入消息。
   * false / undefined：排队追加（默认行为，turn 结束后才会被消费）。
   */
  interrupt?: boolean
}

// ===== 会话迁移输入 =====

/**
 * 迁移会话到另一个工作区的输入参数
 */
export interface MoveSessionToWorkspaceInput {
  /** 要迁移的会话 ID */
  sessionId: string
  /** 目标工作区 ID */
  targetWorkspaceId: string
}

/** Fork（分叉）会话输入 */
export interface ForkSessionInput {
  /** Proma 会话 ID */
  sessionId: string
  /** SDK 消息 uuid（截断点，inclusive）。省略时复制全部历史 */
  upToMessageUuid?: string
}

/** 快照回退输入（同一会话内回退到指定点） */
export interface RewindSessionInput {
  /** Proma 会话 ID */
  sessionId: string
  /** 回退到哪条 assistant message（inclusive，截断该消息之后的一切） */
  assistantMessageUuid: string
}

/** 快照回退结果 */
export interface RewindSessionResult {
  /** 截断后剩余的消息数 */
  remainingMessages: number
  /** 文件恢复结果（enableFileCheckpointing 启用时可用） */
  fileRewind?: {
    canRewind: boolean
    error?: string
    filesChanged?: string[]
    insertions?: number
    deletions?: number
  }
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
  /** 事件数据（新格式） */
  payload: AgentStreamPayload
  /** @deprecated 兼容旧格式，Phase 2 后移除 */
  event?: AgentEvent
}

/**
 * Agent 流式完成事件载荷（主进程 → 渲染进程）
 * 包含已持久化的消息列表，避免异步重新加载的竞态窗口。
 */
export interface AgentStreamCompletePayload {
  sessionId: string
  /** 已持久化的完整消息列表 */
  messages?: AgentMessage[]
  /** 是否由用户手动中止 */
  stoppedByUser?: boolean
  /** 本轮流式开始时间戳（用于区分新旧流，防止旧流的 complete 事件重置新流状态） */
  startedAt?: number
  /** SDK result 消息的 subtype（success / error_max_turns / error_max_budget_usd / error_during_execution 等） */
  resultSubtype?: string
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

/** 文件索引条目（用于 @ 引用搜索） */
export interface FileIndexEntry {
  /** 文件/目录名称 */
  name: string
  /** 相对于工作区的路径 */
  path: string
  /** 条目类型 */
  type: 'file' | 'dir'
}

/** 文件搜索结果 */
export interface FileSearchResult {
  entries: FileIndexEntry[]
  total: number
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
  /** 文件原始路径（从侧面板添加时设置，发送时跳过复制直接引用） */
  sourcePath?: string
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

/** Agent 文件保存到工作区文件目录的输入 */
export interface AgentSaveWorkspaceFilesInput {
  workspaceSlug: string
  files: Array<{ filename: string; data: string }>
}

/** 附加/分离目录的输入参数 */
export interface AgentAttachDirectoryInput {
  /** 会话 ID */
  sessionId: string
  /** 目录的绝对路径 */
  directoryPath: string
}

/** 工作区级附加/分离目录的输入参数 */
export interface WorkspaceAttachDirectoryInput {
  /** 工作区 slug */
  workspaceSlug: string
  /** 目录的绝对路径 */
  directoryPath: string
}

// ===== AskUserQuestion 交互式问答类型 =====

/** AskUserQuestion 工具的选项定义 */
export interface AskUserQuestionOption {
  /** 选项显示文本 */
  label: string
  /** 选项说明 */
  description?: string
  /** 选项预览内容（聚焦时展示，支持 Markdown） */
  preview?: string
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
  /** 用户答案（问题文本 → 答案文本，与 SDK 约定一致） */
  answers: Record<string, string>
}

// ===== ExitPlanMode 计划审批类型 =====

/** ExitPlanMode SDK 工具输入中的 allowedPrompts 项 */
export interface ExitPlanAllowedPrompt {
  /** 工具名称（目前仅 "Bash"） */
  tool: 'Bash'
  /** 语义化的操作描述（如 "run tests"、"install dependencies"） */
  prompt: string
}

/** ExitPlanMode 请求（主进程 → 渲染进程） */
export interface ExitPlanModeRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** SDK 工具原始输入 */
  toolInput: Record<string, unknown>
  /** 解析后的 allowedPrompts 列表 */
  allowedPrompts: ExitPlanAllowedPrompt[]
}

/** ExitPlanMode 用户选择行为 */
export type ExitPlanModeAction = 'approve_auto' | 'approve_edit' | 'deny' | 'feedback'

/** ExitPlanMode 响应（渲染进程 → 主进程） */
export interface ExitPlanModeResponse {
  /** 请求 ID */
  requestId: string
  /** 用户选择的行为 */
  action: ExitPlanModeAction
  /** 用户反馈内容（action 为 feedback 时有值） */
  feedback?: string
}

// ===== 权限系统类型 =====

/** Proma 权限模式（直接映射 SDK 原生模式） */
export type PromaPermissionMode = 'auto' | 'bypassPermissions' | 'plan'

/** 权限模式定义顺序（用于循环切换） */
export const PROMA_PERMISSION_MODE_ORDER: readonly PromaPermissionMode[] = ['auto', 'bypassPermissions', 'plan']

/** 迁移旧权限模式值到新模式 */
export function migratePermissionMode(mode: string): PromaPermissionMode {
  if (mode === 'auto' || mode === 'bypassPermissions' || mode === 'plan') return mode
  const migration: Record<string, PromaPermissionMode> = {
    acceptEdits: 'auto',
    smart: 'auto',
    supervised: 'auto',
  }
  return migration[mode] ?? 'auto'
}

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
  /** 操作描述（人类可读，Proma 生成） */
  description: string
  /** 具体命令（Bash 工具时有值��� */
  command?: string
  /** 危险等级 */
  dangerLevel: DangerLevel
  /** SDK 提供的原因说明 */
  decisionReason?: string
  /** SDK 提供的工具显示名称，如 "Write" */
  sdkDisplayName?: string
  /** SDK 提供的操作标题，如 "Write to /path/to/file.ts" */
  sdkTitle?: string
  /** SDK 提供的详细描述，如 "Claude wants to write 200 lines to /path/to/file.ts" */
  sdkDescription?: string
}

/** 权限响应（渲染进程 → 主进程） */
export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  /** 是否记住选择（加入会话白名单） */
  alwaysAllow: boolean
}

// ===== Agent Teams 数据类型 =====

/** Team 配置（~/.claude/teams/{name}/config.json） */
export interface TeamConfig {
  /** 团队名称 */
  name: string
  /** 团队描述 */
  description?: string
  /** 创建时间戳 */
  createdAt: number
  /** 领导 Agent ID */
  leadAgentId?: string
  /** 领导 Agent 的 SDK 会话 ID */
  leadSessionId?: string
  /** 团队成员列表 */
  members: TeamMember[]
}

/** Team 成员 */
export interface TeamMember {
  /** Agent ID */
  agentId: string
  /** 显示名称 */
  name: string
  /** Agent 类型（如 'general-purpose', 'Explore'） */
  agentType: string
  /** 使用的模型 */
  model?: string
  /** 颜色标识 */
  color?: string
  /** 加入时间戳 */
  joinedAt?: number
}

/** 任务项（~/.claude/tasks/{teamName}/） */
export interface TaskItem {
  /** 任务 ID */
  id: string
  /** 任务标题 */
  subject: string
  /** 任务描述 */
  description?: string
  /** 进行中的显示文本 */
  activeForm?: string
  /** 负责人 Agent 名称 */
  owner?: string
  /** 任务状态 */
  status: 'pending' | 'in_progress' | 'completed'
  /** 阻塞的任务 ID 列表 */
  blocks: string[]
  /** 被阻塞的任务 ID 列表 */
  blockedBy: string[]
}

/** 解析后的收件箱消息 */
export interface ParsedMailboxMessage {
  /** 发送者名称 */
  from: string
  /** 消息文本 */
  text: string
  /** 摘要 */
  summary?: string
  /** 时间戳 */
  timestamp?: string
  /** 解析后的消息类型 */
  parsedType: 'idle_notification' | 'shutdown_request' | 'shutdown_approved' | 'task_assignment' | 'text'
}

/** Agent Team 聚合数据（IPC 返回） */
export interface AgentTeamData {
  /** 团队名称 */
  teamName: string
  /** 团队配置 */
  team: TeamConfig
  /** 任务列表 */
  tasks: TaskItem[]
  /** 收件箱消息（agent 名称 → 消息列表） */
  inboxes: Record<string, ParsedMailboxMessage[]>
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
  /** 获取会话 SDKMessage（Phase 4 新格式） */
  GET_SDK_MESSAGES: 'agent:get-sdk-messages',
  /** 更新会话标题 */
  UPDATE_TITLE: 'agent:update-title',
  /** 删除会话 */
  DELETE_SESSION: 'agent:delete-session',
  /** 迁移 Chat 对话记录到 Agent 会话 */
  MIGRATE_CHAT_TO_AGENT: 'agent:migrate-chat-to-agent',
  /** 切换会话置顶状态 */
  TOGGLE_PIN: 'agent:toggle-pin',
  /** 切换会话手动工作中状态 */
  TOGGLE_MANUAL_WORKING: 'agent:toggle-manual-working',
  /** 切换会话归档状态 */
  TOGGLE_ARCHIVE: 'agent:toggle-archive',
  /** 搜索会话消息内容 */
  SEARCH_MESSAGES: 'agent:search-messages',
  /** 迁移会话到另一个工作区 */
  MOVE_SESSION_TO_WORKSPACE: 'agent:move-session-to-workspace',
  /** 分叉会话（从指定消息处创建新会话） */
  FORK_SESSION: 'agent:fork-session',
  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  REWIND_SESSION: 'agent:rewind-session',

  // 工作区管理
  /** 获取工作区列表 */
  LIST_WORKSPACES: 'agent:list-workspaces',
  /** 创建工作区 */
  CREATE_WORKSPACE: 'agent:create-workspace',
  /** 更新工作区 */
  UPDATE_WORKSPACE: 'agent:update-workspace',
  /** 删除工作区 */
  DELETE_WORKSPACE: 'agent:delete-workspace',
  /** 重排工作区顺序 */
  REORDER_WORKSPACES: 'agent:reorder-workspaces',

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
  /** 获取工作区 Skills 目录绝对路径 */
  GET_SKILLS_DIR: 'agent:get-skills-dir',
  /** 删除工作区 Skill */
  DELETE_SKILL: 'agent:delete-skill',
  /** 切换工作区 Skill 启用/禁用 */
  TOGGLE_SKILL: 'agent:toggle-skill',
  /** 获取其他工作区的 Skill 列表 */
  GET_OTHER_WORKSPACE_SKILLS: 'agent:get-other-workspace-skills',
  /** 从其他工作区导入 Skill 到当前工作区 */
  IMPORT_SKILL_FROM_WORKSPACE: 'agent:import-skill-from-workspace',
  /** 从源工作区同步更新已导入的 Skill */
  UPDATE_SKILL_FROM_SOURCE: 'agent:update-skill-from-source',

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
  /** 保存文件到工作区文件目录 */
  SAVE_FILES_TO_WORKSPACE: 'agent:save-files-to-workspace',
  /** 获取工作区文件目录路径 */
  GET_WORKSPACE_FILES_PATH: 'agent:get-workspace-files-path',
  /** 打开文件夹选择对话框 */
  OPEN_FOLDER_DIALOG: 'agent:open-folder-dialog',
  /** 附加外部目录到 Agent 会话 */
  ATTACH_DIRECTORY: 'agent:attach-directory',
  /** 移除会话的附加目录 */
  DETACH_DIRECTORY: 'agent:detach-directory',
  /** 附加外部目录到工作区（所有会话共享） */
  ATTACH_WORKSPACE_DIRECTORY: 'agent:attach-workspace-directory',
  /** 移除工作区的附加目录 */
  DETACH_WORKSPACE_DIRECTORY: 'agent:detach-workspace-directory',
  /** 获取工作区附加目录列表 */
  GET_WORKSPACE_DIRECTORIES: 'agent:get-workspace-directories',

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
  /** 在新窗口中预览文件 */
  PREVIEW_FILE: 'agent:preview-file',
  /** 重命名文件/目录 */
  RENAME_FILE: 'agent:rename-file',
  /** 移动文件/目录到目标目录 */
  MOVE_FILE: 'agent:move-file',
  /** 列出附加目录内容（无工作区路径限制） */
  LIST_ATTACHED_DIRECTORY: 'agent:list-attached-directory',
  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  OPEN_ATTACHED_FILE: 'agent:open-attached-file',
  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  SHOW_ATTACHED_IN_FOLDER: 'agent:show-attached-in-folder',
  /** 重命名附加目录文件/目录（无工作区路径限制） */
  RENAME_ATTACHED_FILE: 'agent:rename-attached-file',
  /** 移动附加目录文件/目录（无工作区路径限制） */
  MOVE_ATTACHED_FILE: 'agent:move-attached-file',
  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  CHECK_PATHS_TYPE: 'agent:check-paths-type',
  /** 读取附加目录文件内容为 base64（限制在已附加目录范围内，用于侧面板添加到聊天） */
  READ_ATTACHED_FILE: 'agent:read-attached-file',
  /** 搜索工作区文件（用于 @ 引用） */
  SEARCH_WORKSPACE_FILES: 'agent:search-workspace-files',

  // 标题自动生成通知（主进程 → 渲染进程推送）
  /** 标题已更新（首次对话完成后自动生成） */
  TITLE_UPDATED: 'agent:title-updated',

  // 工作区配置变化通知（主进程 → 渲染进程推送）
  /** 工作区能力变化（MCP/Skills 文件监听触发） */
  CAPABILITIES_CHANGED: 'agent:capabilities-changed',
  /** 工作区文件变化（session 目录文件监听触发，用于文件浏览器刷新） */
  WORKSPACE_FILES_CHANGED: 'agent:workspace-files-changed',

  // 权限系统
  /** 权限响应（渲染进程 → 主进程） */
  PERMISSION_RESPOND: 'agent:permission:respond',
  /** 设置权限模式（渲染进程 → 主进程） */
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  /** 获取权限模式（渲染进程 → 主进程） */
  GET_PERMISSION_MODE: 'agent:get-permission-mode',

  // AskUserQuestion 交互式问答
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: 'agent:ask-user:respond',

  // ExitPlanMode 计划审批
  /** ExitPlanMode 响应（渲染进程 → 主进程） */
  EXIT_PLAN_MODE_RESPOND: 'agent:exit-plan-mode:respond',

  // Agent Teams 数据
  /** 获取 Team 聚合数据（sdkSessionId → AgentTeamData | null） */
  GET_TEAM_DATA: 'agent:get-team-data',
  /** 读取 Teammate 输出文件（filePath → string） */
  GET_AGENT_OUTPUT: 'agent:get-agent-output',

  // 队列消息（Agent 运行中排队发送）
  /** 排队发送消息 */
  QUEUE_MESSAGE: 'agent:queue-message',
  /** 取消队列消息 */
  CANCEL_QUEUED_MESSAGE: 'agent:cancel-queued-message',
  /** 提升队列消息为立即发送 */
  PROMOTE_QUEUED_MESSAGE: 'agent:promote-queued-message',
  /** 队列消息状态变更通知（主进程 → 渲染进程推送） */
  QUEUED_MESSAGE_STATUS: 'agent:queued-message-status',

  // 待处理请求恢复（渲染进程重载后查询主进程状态）
  /** 获取所有待处理的交互请求快照 */
  GET_PENDING_REQUESTS: 'agent:get-pending-requests',
} as const

/**
 * 待处理交互请求快照（用于渲染进程重载后恢复状态）
 */
export interface PendingRequestsSnapshot {
  /** 待处理的权限请求 */
  permissions: PermissionRequest[]
  /** 待处理的 AskUser 请求 */
  askUsers: AskUserRequest[]
  /** 待处理的 ExitPlanMode 请求 */
  exitPlans: ExitPlanModeRequest[]
}
