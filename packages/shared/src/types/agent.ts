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

// ===== Agent 事件类型 =====

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
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 控制流
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'error'; message: string }
  // 重试机制
  | { type: 'retrying'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string }
  // Usage 更新
  | { type: 'usage_update'; usage: { inputTokens: number; contextWindow?: number } }
  // 上下文压缩
  | { type: 'compacting' }
  | { type: 'compact_complete' }

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

  // 工作区能力（MCP + Skill）
  /** 获取工作区能力摘要 */
  GET_CAPABILITIES: 'agent:get-capabilities',
  /** 获取工作区 MCP 配置 */
  GET_MCP_CONFIG: 'agent:get-mcp-config',
  /** 保存工作区 MCP 配置 */
  SAVE_MCP_CONFIG: 'agent:save-mcp-config',
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
} as const
