import type { ProviderType } from './channel'

/**
 * Agent 相关类型定义
 *
 * 包含 Agent SDK 集成所需的事件类型、会话管理、消息持久化和 IPC 通道常量。
 */

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

/** Agent 思考等级（用于 Pi runtime；Claude runtime 继续使用 ThinkingConfig/AgentEffort） */
export type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** 是否为 Proma 可暴露 reasoning.effort 的 OpenAI 推理模型。 */
export function isOpenAIReasoningSupportedModel(modelId: string | undefined): boolean {
  const normalized = modelId?.toLowerCase() ?? ''
  // Pi catalog 中 gpt-5*-chat-latest 是非 reasoning 的对话变体；它们不能接受
  // reasoning.effort，必须在 UI 层与请求层共同排除。
  if (normalized.endsWith('-chat-latest')) return false
  return normalized.startsWith('gpt-5') || /^(o1|o3|o4)(?:-|$)/.test(normalized)
}

/** 支持 ChatGPT Codex Fast Mode（priority service tier）的模型。 */
export const CODEX_FAST_MODE_MODEL_IDS = [
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const

/** 模型 ID 是否可通过 ChatGPT Codex OAuth 使用 Fast Mode。 */
export function isCodexFastModeSupportedModel(modelId: string | undefined): boolean {
  return modelId !== undefined && (CODEX_FAST_MODE_MODEL_IDS as readonly string[]).includes(modelId.toLowerCase())
}

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
  /** 渠道 provider，用于按 Agent SDK 实际运行窗口计算压缩阈值 */
  _channelProvider?: ProviderType
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
  terminal_reason?: string
  background_tasks?: SDKBackgroundTaskSummary[]
  session_crons?: SDKSessionCronSummary[]
  session_id?: string
  /** 渠道配置的模型 ID，用于缺失 modelUsage.contextWindow 时按 Agent SDK 运行窗口兜底 */
  _channelModelId?: string
  /** 渠道 provider，用于按 Agent SDK 实际运行窗口计算压缩阈值 */
  _channelProvider?: ProviderType
}

/** SDK system 消息（init / compact_boundary / permission_denied / task_started / task_progress / task_notification） */
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
  /** SDK status: 上下文压缩结果 */
  compact_result?: 'success' | 'failed'
  /** SDK status: 上下文压缩失败原因 */
  compact_error?: string
  summary?: string
  output_file?: string
  last_tool_name?: string
  /** permission_denied 相关字段 */
  tool_name?: string
  message?: string
  decision_reason_type?: string
  decision_reason?: string
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
  [key: string]: unknown
}

/** SDK thinking token 估算消息（Claude Agent SDK 0.3.156+） */
export interface SDKThinkingTokensMessage {
  type: 'system'
  subtype: 'thinking_tokens'
  estimated_tokens: number
  estimated_tokens_delta: number
  uuid?: string
  session_id?: string
}

/** SDK 后台任务摘要（result / hook 中可能出现） */
export interface SDKBackgroundTaskSummary {
  id: string
  type: string
  status: string
  description: string
  command?: string
  agent_type?: string
  server?: string
  tool?: string
  name?: string
}

/** SDK 会话级定时任务摘要（result / hook 中可能出现） */
export interface SDKSessionCronSummary {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

/** SDK tool_progress 消息（工具执行心跳） */
export interface SDKToolProgressMessage {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds?: number
  /** 所属 SDK 子任务 / SubAgent 任务 ID */
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
  | SDKThinkingTokensMessage
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
  | 'thinking_signature_invalid'
  | 'provider_error'
  // 环境 / 配置类错误（本地可修复）
  | 'windows_shell_missing'
  | 'channel_not_found'
  | 'channel_disabled'
  | 'agent_provider_not_supported'
  | 'agent_model_unavailable'
  | 'api_key_decrypt_failed'
  | 'claude_binary_not_found'
  | 'agent_runtime_not_found'
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
    | 'select_model'
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
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
}

/** SDK 子任务 / SubAgent 用量统计 */
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

/** 计划阶段状态变化来源 */
export type AgentPlanModeChangeSource = 'initial' | 'tool' | 'permission'

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
  | { type: 'thinking_tokens'; estimatedTokens: number; estimatedTokensDelta: number }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 工具使用摘要
  | { type: 'tool_use_summary'; summary: string; precedingToolUseIds: string[] }
  // 控制流
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'run_resumed' }
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
  // 当前是否处于计划阶段（与用户选择的权限模式分离）
  | { type: 'plan_mode_changed'; active: boolean; source: AgentPlanModeChangeSource }
  // 提示建议
  | { type: 'prompt_suggestion'; suggestion: string }
  // 模型确认（SDK 确认实际使用的模型）
  | { type: 'model_resolved'; model: string }
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
  | { type: 'plan_mode_changed'; sessionId: string; active: boolean; source: AgentPlanModeChangeSource }
  | { type: 'retry'; status: 'starting' | 'attempt' | 'cleared' | 'failed'; attempt?: number; maxAttempts?: number; delaySeconds?: number; reason?: string; attemptData?: RetryAttempt; error?: TypedError }
  | { type: 'model_resolved'; model: string }
  | { type: 'context_window'; contextWindow: number }
  | { type: 'permission_mode_changed'; mode: PromaPermissionMode }
  | { type: 'title_updated'; title: string }
  | { type: 'external_run_started'; source: AgentExternalRunSource; sessionId: string; title?: string; workspaceId?: string; modelId?: string; startedAt: number }
  | { type: 'run_resumed'; sessionId: string }
  // 协作子会话阻塞事件上浮
  | { type: 'delegation_blocked'; delegationId: string; blockedEvent: unknown }
  // 自动任务会话被用户接管（毕业）
  | { type: 'automation_graduated' }

/** 外部入口触发 Agent 运行的来源 */
export type AgentExternalRunSource = 'feishu' | 'dingtalk' | 'wechat' | 'bridge' | 'delegation'

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
  /** 使用的模型 ID（自动任务子会话恢复输入框模型选择时使用） */
  modelId?: string
  /** SDK 内部会话 ID（用于 resume 衔接上下文） */
  sdkSessionId?: string
  /** 当前会话使用的 Agent runtime；历史会话缺省为 claude */
  agentRuntime?: import('./agent-provider').AgentRuntime
  /** ChatGPT Codex Fast Mode 开关；仅 Pi + ChatGPT OAuth 的受支持模型实际生效。 */
  codexFastMode?: boolean
  /** 本会话的 OpenAI（Codex OAuth / Responses API）推理深度；未设置时兼容旧版全局思考设置。 */
  openAIThinkingLevel?: AgentThinkingLevel
  /** 所属工作区 ID */
  workspaceId?: string
  /** 是否置顶 */
  pinned?: boolean
  /** 是否已归档 */
  archived?: boolean
  /** 附加的外部目录路径列表（绝对路径，作为 SDK additionalDirectories 传递） */
  attachedDirectories?: string[]
  /** 附加的外部文件路径列表（绝对路径，发送时以父目录作为 SDK additionalDirectories） */
  attachedFiles?: string[]
  /** 分叉来源：源会话的 Proma 工作目录（SDK session 文件在此目录的项目空间中，首次 resume 后清除） */
  forkSourceDir?: string
  /** 分叉来源：源会话的 SDK session ID（用于 rewind 时读取源会话的 file-history-snapshot 和备份文件） */
  forkSourceSdkSessionId?: string
  /** 回退后的 resume 截断点：下次发消息时传给 SDK resumeSessionAt（消费后清除） */
  resumeAtMessageUuid?: string
  /** 历史兼容字段：旧版手动保留状态 */
  manualWorking?: boolean
  /** Agent 执行完成但用户尚未清除完成状态 */
  completedButUnconfirmed?: boolean
  /** 最后一次流式执行是否被用户主动中断 */
  stoppedByUser?: boolean
  /** 该会话当前的权限模式（持久化到磁盘，重启后恢复）。未设置时新会话默认 auto */
  permissionMode?: PromaPermissionMode
  /** 来源定时任务 ID（该会话由定时任务自动创建/复用时标记，用于侧栏显示钟表图标 + 跳转设置） */
  sourceAutomationId?: string
  /**
   * 自动任务会话是否已被用户手动接管而"毕业"：true 时该会话回到普通项目会话列表，
   * 且调度器不再复用它注入新的定时运行（避免污染用户已接管的会话）。默认 undefined/false。
   */
  automationGraduated?: boolean
  /** 父 Agent 会话 ID（该会话由父 Agent 委派创建时标记） */
  parentSessionId?: string
  /** 根 Agent 会话 ID（多层委派时用于追溯；当前仅允许一层，预留字段） */
  rootSessionId?: string
  /** 来源委派任务 ID（由 collaboration 工具生成，用于父子会话关联） */
  sourceDelegationId?: string
  /** 委派角色，用于 UI 和后续统计 */
  delegationRole?: AgentDelegationRole
  /** 委派任务当前状态 */
  delegationStatus?: AgentDelegationStatus
  /** 委派深度；手动会话为 undefined，首层子会话为 1 */
  delegationDepth?: number
  /** 委派目标摘要，便于 UI 展示和追溯 */
  delegationGoal?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** Agent 委派子会话的任务角色 */
export type AgentDelegationRole = 'explore' | 'research' | 'implement' | 'review' | 'custom'

/** Agent 委派子会话的运行状态（interrupted：应用退出时仍在运行，重启后无法续跑） */
export type AgentDelegationStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

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

/**
 * Agent 会话引用搜索输入
 */
export interface AgentSessionReferenceSearchInput {
  /** 当前工作区 ID，仅搜索该工作区下的会话 */
  workspaceId: string
  /** 搜索关键词，匹配标题或消息内容 */
  query?: string
  /** 排除当前会话，避免引用自己 */
  excludeSessionId?: string
  /** 最大返回数量 */
  limit?: number
}

/**
 * Agent 会话引用搜索结果
 */
export interface AgentSessionReferenceSearchResult {
  /** 会话 ID */
  sessionId: string
  /** 会话标题 */
  title: string
  /** 更新时间戳 */
  updatedAt: number
  /** 命中消息片段；标题命中时可为空 */
  snippet?: string
  /** 命中来源 */
  matchSource: 'title' | 'message' | 'recent'
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

/** MCP 传输类型；Proma 将 Streamable HTTP 规范化存储为 http */
export type McpTransportType = 'stdio' | 'http' | 'sse'

/** 外部配置中常见的 Streamable HTTP 别名 */
export type McpTransportTypeAlias = 'streamableHttp' | 'streamable-http' | 'streamable_http'

/** MCP 传输类型输入；保存和运行前会规范化为 McpTransportType */
export type McpTransportTypeInput = McpTransportType | McpTransportTypeAlias

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

/** MCP 工具摘要，用于前端只读展示 */
export interface McpToolSummary {
  name: string
  description: string
  readOnly?: boolean
}

/** Proma 内置 MCP 分类 */
export type BuiltinMcpCategory = 'system' | 'automation' | 'collaboration' | 'memory' | 'media' | 'browser'

/** Proma 内置 MCP 摘要，不写入工作区 mcp.json */
export interface BuiltinMcpServerSummary {
  id: string
  name: string
  displayName: string
  description: string
  category: BuiltinMcpCategory
  enabled: boolean
  available: boolean
  availabilityReason?: string
  tools: McpToolSummary[]
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
  /** UI 分组名，用于把 Proma 内嵌 Skills 收拢到同一组 */
  group?: string
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

/** Skill 目录下的文件/子目录节点（递归树） */
export interface SkillFileNode {
  /** 相对于 Skill 根目录的相对路径，使用 POSIX 分隔符 */
  relativePath: string
  /** 末段名字（用于显示） */
  name: string
  /** 类型：文件 / 目录 */
  type: 'file' | 'directory'
  /** 文件大小（字节）；目录为 undefined */
  size?: number
  /** 是否为文本文件（可在内置编辑器中打开）；目录为 undefined */
  isText?: boolean
  /** 子节点（仅 type=directory 有值，已按目录优先 + 名称排序） */
  children?: SkillFileNode[]
}

/** 读取 Skill 子文件的响应 */
export interface SkillFileContent {
  relativePath: string
  /** 文本内容（仅 isText=true 时存在） */
  content?: string
  /** 是否为文本文件 */
  isText: boolean
  /** 文件大小（字节） */
  size: number
}

/** 工作区记忆文件摘要 */
export interface WorkspaceMemoryFileSummary {
  /** 文件是否存在 */
  exists: boolean
  /** 绝对路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 最近修改时间戳 */
  updatedAt?: number
}

/** 工作区记忆摘要 */
export interface WorkspaceMemorySummary {
  /** 工作区级 CLAUDE.md */
  claudeMd: WorkspaceMemoryFileSummary
  /** SDK auto memory 目录 */
  autoMemory: {
    /** 绝对目录路径 */
    directory: string
    /** MEMORY.md 是否存在 */
    memoryMdExists: boolean
    /** 文本文件数量 */
    fileCount: number
    /** 总大小（字节） */
    totalSize: number
    /** 最近修改时间戳 */
    updatedAt?: number
  }
}

/** 工作区能力摘要（MCP + Skill 计数） */
export interface WorkspaceCapabilities {
  mcpServers: Array<{ name: string; enabled: boolean; type: McpTransportType }>
  builtinMcpServers: BuiltinMcpServerSummary[]
  skills: SkillMeta[]
  memory: WorkspaceMemorySummary
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
  /** 本轮请求使用的 Agent runtime（用于输入区快速切换后的兜底同步） */
  agentRuntime?: import('./agent-provider').AgentRuntime
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
  /** 用户通过会话引用 mention 指定的 Agent 会话 ID 列表 */
  mentionedSessionIds?: string[]
  /** 渲染进程生成的流式开始时间戳，主进程原样回传到 STREAM_COMPLETE，确保竞态保护比较的是同一个值 */
  startedAt?: number
  /** 触发来源：用户手动、定时任务、父 Agent 委派（用于 UI 区分标记） */
  triggeredBy?: 'user' | 'automation' | 'delegation'
  /** 定时任务执行上下文（注入到系统提示词，用户不可见） */
  automationContext?: string
}

// ===== Agent 队列消息 =====

/** 流式追加消息的输入参数（Agent 流式中发送新消息） */
export interface AgentQueueMessageInput {
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 仅用于持久化/重放的原始用户输入；省略时回退到 userMessage */
  rawUserMessage?: string
  /** 前端预生成的 UUID（用于乐观更新去重） */
  uuid?: string
  /**
   * 软中断当前 Agent turn 后再追加消息。
   * true：先调用 SDK query.interrupt() 立即打断正在输出的 turn，再注入消息。
   * false / undefined：排队追加（默认行为，turn 结束后才会被消费）。
   */
  interrupt?: boolean
  /** 用户通过 /skill:xxx 引用的 Skill slug 列表 */
  mentionedSkills?: string[]
  /** 用户通过 #mcp:xxx 引用的 MCP 服务器名称列表 */
  mentionedMcpServers?: string[]
  /** 用户通过 &session:xxx 引用的 Agent 会话 ID 列表 */
  mentionedSessionIds?: string[]
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
  /** 目标模型 ID。省略时继承源会话模型；传入时必须属于源会话同一渠道且已启用 */
  modelId?: string
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
  /** SDK result 消息携带的错误详情（error_during_execution 等场景下的真实错误原因，用于展示具体错误） */
  resultErrors?: string[]
  /** 本轮主体结束但仍有后台任务/定时任务在飞行：UI 进入"空闲可输入"态，等待任务完成自动唤醒 */
  backgroundTasksPending?: boolean
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
  /** 文件大小（字节）。目录为空 */
  size?: number
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
  /** 来源：会话文件或工作区文件 */
  source: 'session' | 'workspace'
}

/** 文件搜索结果 */
export interface FileSearchResult {
  entries: FileIndexEntry[]
  total: number
  /** 会话文件条目（来自 session 工作目录） */
  sessionEntries: FileIndexEntry[]
  /** 工作区文件条目（来自 workspace files + 附加目录） */
  workspaceEntries: FileIndexEntry[]
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
  /**
   * 标记 sourcePath 指向的是剪贴板临时预览文件（os.tmpdir）。
   * 这类文件可能被系统清理，发送时需读取其最新内容拷贝进 session 目录，
   * 而非像侧面板真实文件那样原地引用。
   */
  isClipboardDraft?: boolean
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

/** 附加/分离文件的输入参数 */
export interface AgentAttachFileInput {
  /** 会话 ID */
  sessionId: string
  /** 文件的绝对路径 */
  filePath: string
}

/** 工作区级附加/分离目录的输入参数 */
export interface WorkspaceAttachDirectoryInput {
  /** 工作区 slug */
  workspaceSlug: string
  /** 目录的绝对路径 */
  directoryPath: string
}

/** 工作区级附加/分离文件的输入参数 */
export interface WorkspaceAttachFileInput {
  /** 工作区 slug */
  workspaceSlug: string
  /** 文件的绝对路径 */
  filePath: string
}

/** Worktree 仓库配置 */
export interface WorkspaceWorktreeRepo {
  /** 显示名称 */
  name: string
  /** 主仓库绝对路径 */
  repoPath: string
  /** Worktree 存放目录绝对路径 */
  worktreesPath: string
  /** 优先级（数字越小越优先） */
  priority?: number
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
export type ExitPlanModeAction = 'approve_bypass' | 'deny' | 'feedback'

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

/** 当前 Proma 支持的权限模式，值直接映射 SDK 原生 permissionMode */
export const PROMA_PERMISSION_MODES = ['bypassPermissions', 'plan'] as const

export type PromaPermissionMode = typeof PROMA_PERMISSION_MODES[number]

export const PROMA_DEFAULT_PERMISSION_MODE: PromaPermissionMode = 'bypassPermissions'

export interface PromaPermissionModeConfig {
  /** 对应 Claude Agent SDK 的 permissionMode */
  sdkMode: PromaPermissionMode
  label: string
  description: string
}

/** Proma 权限模式的单一配置来源 */
export const PROMA_PERMISSION_MODE_CONFIG = {
  bypassPermissions: {
    sdkMode: 'bypassPermissions',
    label: '完全自动',
    description: '所有工具调用自动允许',
  },
  plan: {
    sdkMode: 'plan',
    label: '计划模式',
    description: '仅规划不执行，查看工具使用计划',
  },
} as const satisfies Record<PromaPermissionMode, PromaPermissionModeConfig>

/** 权限模式定义顺序（用于循环切换） */
export const PROMA_PERMISSION_MODE_ORDER: readonly PromaPermissionMode[] = PROMA_PERMISSION_MODES

export function isPromaPermissionMode(mode: string): mode is PromaPermissionMode {
  return (PROMA_PERMISSION_MODES as readonly string[]).includes(mode)
}

/** 规范化权限模式：历史 auto 或其它非法值统一回到默认完全自动模式 */
export function migratePermissionMode(mode: string): PromaPermissionMode {
  if (isPromaPermissionMode(mode)) return mode
  return PROMA_DEFAULT_PERMISSION_MODE
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
  /** SDK 提供的原因分类，如 classifier / safetyCheck / rule */
  decisionReasonType?: string
  /** SDK auto safety check 是否允许交给 classifier 审批 */
  classifierApprovable?: boolean
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
  /** 获取会话 SDKMessage（Phase 4 新格式） */
  GET_SDK_MESSAGES: 'agent:get-sdk-messages',
  /** 更新会话标题 */
  UPDATE_TITLE: 'agent:update-title',
  /** 更新会话模型选择 */
  UPDATE_SESSION_MODEL: 'agent:update-session-model',
  /** 删除会话 */
  DELETE_SESSION: 'agent:delete-session',
  /** 迁移 Chat 对话记录到 Agent 会话 */
  MIGRATE_CHAT_TO_AGENT: 'agent:migrate-chat-to-agent',
  /** 切换会话置顶状态 */
  TOGGLE_PIN: 'agent:toggle-pin',
  /** 清除会话完成状态（兼容清除旧版 manualWorking）。channel 值保留旧名以兼容已缓存的 preload */
  CLEAR_COMPLETION_STATE: 'agent:confirm-working-done',
  /** 切换会话归档状态 */
  TOGGLE_ARCHIVE: 'agent:toggle-archive',
  /** 搜索会话消息内容 */
  SEARCH_MESSAGES: 'agent:search-messages',
  /** 搜索当前工作区可引用的 Agent 会话 */
  SEARCH_SESSION_REFERENCES: 'agent:search-session-references',
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
  /** 启用或关闭 Proma 内置 MCP */
  SET_BUILTIN_MCP_ENABLED: 'agent:set-builtin-mcp-enabled',
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
  /** 获取默认 Skills 的 slug 列表（来自 ~/.proma/default-skills/） */
  GET_DEFAULT_SKILL_SLUGS: 'agent:get-default-skill-slugs',
  /** 从其他工作区导入 Skill 到当前工作区 */
  IMPORT_SKILL_FROM_WORKSPACE: 'agent:import-skill-from-workspace',
  /** 从源工作区同步更新已导入的 Skill */
  UPDATE_SKILL_FROM_SOURCE: 'agent:update-skill-from-source',
  /** 读取 SKILL.md 全文内容 */
  READ_SKILL_CONTENT: 'agent:read-skill-content',
  /** 写入 SKILL.md 全文内容 */
  WRITE_SKILL_CONTENT: 'agent:write-skill-content',
  /** 列出 Skill 目录下的子文件树（不含 SKILL.md） */
  LIST_SKILL_FILES: 'agent:list-skill-files',
  /** 读取 Skill 目录下的子文件内容 */
  READ_SKILL_FILE: 'agent:read-skill-file',
  /** 写入 Skill 目录下的子文件内容 */
  WRITE_SKILL_FILE: 'agent:write-skill-file',
  /** 在 Skill 目录下创建文件或目录 */
  CREATE_SKILL_ENTRY: 'agent:create-skill-entry',
  /** 删除 Skill 目录下的文件或目录 */
  DELETE_SKILL_ENTRY: 'agent:delete-skill-entry',
  /** 重命名/移动 Skill 目录下的文件或目录 */
  RENAME_SKILL_ENTRY: 'agent:rename-skill-entry',
  /** 获取工作区记忆摘要 */
  GET_WORKSPACE_MEMORY_SUMMARY: 'agent:get-workspace-memory-summary',
  /** 读取工作区 CLAUDE.md */
  READ_WORKSPACE_CLAUDE_MD: 'agent:read-workspace-claude-md',
  /** 写入工作区 CLAUDE.md */
  WRITE_WORKSPACE_CLAUDE_MD: 'agent:write-workspace-claude-md',
  /** 列出工作区 auto memory 文件树 */
  LIST_WORKSPACE_AUTO_MEMORY_FILES: 'agent:list-workspace-auto-memory-files',
  /** 读取工作区 auto memory 文件 */
  READ_WORKSPACE_AUTO_MEMORY_FILE: 'agent:read-workspace-auto-memory-file',
  /** 写入工作区 auto memory 文件 */
  WRITE_WORKSPACE_AUTO_MEMORY_FILE: 'agent:write-workspace-auto-memory-file',

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
  /** 附加外部文件到 Agent 会话 */
  ATTACH_FILE: 'agent:attach-file',
  /** 移除会话的附加文件 */
  DETACH_FILE: 'agent:detach-file',
  /** 附加外部目录到工作区（所有会话共享） */
  ATTACH_WORKSPACE_DIRECTORY: 'agent:attach-workspace-directory',
  /** 移除工作区的附加目录 */
  DETACH_WORKSPACE_DIRECTORY: 'agent:detach-workspace-directory',
  /** 附加外部文件到工作区（所有会话共享） */
  ATTACH_WORKSPACE_FILE: 'agent:attach-workspace-file',
  /** 移除工作区的附加文件 */
  DETACH_WORKSPACE_FILE: 'agent:detach-workspace-file',
  /** 获取工作区附加目录列表 */
  GET_WORKSPACE_DIRECTORIES: 'agent:get-workspace-directories',
  /** 获取工作区附加文件列表 */
  GET_WORKSPACE_ATTACHED_FILES: 'agent:get-workspace-attached-files',
  /** 获取工作区 worktree 仓库配置列表 */
  GET_WORKTREE_REPOS: 'agent:get-worktree-repos',
  /** 添加 worktree 仓库到工作区配置 */
  ADD_WORKTREE_REPO: 'agent:add-worktree-repo',
  /** 从工作区配置移除 worktree 仓库 */
  REMOVE_WORKTREE_REPO: 'agent:remove-worktree-repo',

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
  /** 重命名文件/目录 */
  RENAME_FILE: 'agent:rename-file',
  /** 移动文件/目录到目标目录 */
  MOVE_FILE: 'agent:move-file',
  /** 列出附加目录内容（无工作区路径限制） */
  LIST_ATTACHED_DIRECTORY: 'agent:list-attached-directory',
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
  /** 将文本内容写入临时预览文件并返回绝对路径 */
  WRITE_CLIPBOARD_PREVIEW: 'agent:write-clipboard-preview',

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
  /** 热切换指定会话的权限模式（运行中生效，不广播到其他会话） */
  UPDATE_SESSION_PERMISSION_MODE: 'agent:update-session-permission-mode',
  /** 切换指定会话的 Agent runtime（下一轮生效，跨 runtime 时清空 SDK resume ID） */
  UPDATE_SESSION_AGENT_RUNTIME: 'agent:update-session-agent-runtime',
  /** 切换指定会话的 ChatGPT Codex Fast Mode（下一轮 Pi 请求生效） */
  UPDATE_SESSION_CODEX_FAST_MODE: 'agent:update-session-codex-fast-mode',
  /** 更新指定会话的 OpenAI 推理设置（下一轮 Pi 请求生效） */
  UPDATE_SESSION_OPENAI_REASONING: 'agent:update-session-openai-reasoning',

  // AskUserQuestion 交互式问答
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: 'agent:ask-user:respond',

  // ExitPlanMode 计划审批
  /** ExitPlanMode 响应（渲染进程 → 主进程） */
  EXIT_PLAN_MODE_RESPOND: 'agent:exit-plan-mode:respond',

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
