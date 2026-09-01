/**
 * Chat 相关类型定义
 *
 * 包含消息、对话、流式事件等核心类型，
 * 以及 Chat 模块的 IPC 通道常量。
 */

import type { ProviderType } from './channel'

// ===== 附件相关 =====

/** 附件文件大小上限：100MB */
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024

/** 文件附件 */
export interface FileAttachment {
  /** 附件唯一标识 */
  id: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 相对路径: {conversationId}/{uuid}.ext */
  localPath: string
  /** 文件大小（字节） */
  size: number
}

/** 保存附件输入 */
export interface AttachmentSaveInput {
  /** 对话 ID */
  conversationId: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** base64 编码的文件数据 */
  data: string
}

/** 保存附件结果 */
export interface AttachmentSaveResult {
  /** 保存后的附件信息 */
  attachment: FileAttachment
}

/** 文件选择对话框结果 */
export interface FileDialogResult {
  /** 已读取为 base64 的小文件列表 */
  files: FileDialogFile[]
  /** 超过内存导入上限的大文件，仅返回路径，供 Agent 作为附加文件引用 */
  largeFiles?: FileDialogLargeFile[]
  /** 无法读取或无法识别的文件 */
  skippedFiles?: FileDialogSkippedFile[]
}

export interface FileDialogFile {
  filename: string
  mediaType: string
  data: string
  size: number
}

export interface FileDialogLargeFile {
  filename: string
  mediaType: string
  size: number
  path: string
}

export interface FileDialogSkippedFile {
  filename: string
  mediaType?: string
  size?: number
  path?: string
  reason: 'unreadable'
  message?: string
}

/** Agent Composer 混合选择器中返回的目录；目录只授权访问，不作为消息附件复制。 */
export interface FileDialogDirectory {
  name: string
  path: string
}

/** 支持同时选择文件与文件夹的 Agent Composer 选择结果。 */
export interface FileOrFolderDialogResult extends FileDialogResult {
  directories: FileDialogDirectory[]
}

// ===== 消息相关 =====

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string
  /** 发送者角色 */
  role: MessageRole
  /** 消息内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** 使用的模型 ID（assistant 消息） */
  model?: string
  /** 推理内容（如果模型支持） */
  reasoning?: string
  /** 是否被用户中止 */
  stopped?: boolean
  /** 流式生成时遇到的错误信息 */
  error?: string
  /** 文件附件列表 */
  attachments?: FileAttachment[]
  /** 工具活动记录（assistant 消息，工具调用历史） */
  toolActivities?: ChatToolActivity[]
}

// ===== 对话相关 =====

/**
 * 对话（包含消息列表，仅用于运行时）
 */
export interface Conversation {
  /** 对话唯一标识 */
  id: string
  /** 对话标题 */
  title: string
  /** 消息列表 */
  messages: ChatMessage[]
  /** 默认使用的模型 ID */
  modelId?: string
  /** 系统提示词 */
  systemMessage?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/**
 * 对话轻量索引项
 *
 * 存储在 ~/.proma/conversations.json 中，
 * 不包含消息列表，用于快速加载对话列表。
 */
export interface ConversationMeta {
  /** 对话唯一标识 */
  id: string
  /** 对话标题 */
  title: string
  /** 默认使用的模型 ID */
  modelId?: string
  /** 使用的渠道 ID */
  channelId?: string
  /** 上下文分隔线对应的消息 ID 列表 */
  contextDividers?: string[]
  /** 上下文长度（轮数），'infinite' 表示全部包含 */
  contextLength?: number | 'infinite'
  /** 是否置顶 */
  pinned?: boolean
  /** 是否已归档 */
  archived?: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

// ===== 消息搜索 =====

/**
 * 消息搜索结果
 */
export interface SessionMessageSearchResult {
  /** 消息 ID */
  messageId: string
  /** 消息角色 */
  role: MessageRole
  /** 匹配上下文片段，完整保留命中的查询文本 */
  snippet: string
  /** snippet 内匹配起始位置 */
  matchStart: number
  /** 匹配长度 */
  matchLength: number
}

export interface SessionMessageSearchResponse {
  /** 当前查询返回的最佳命中 */
  results: SessionMessageSearchResult[]
  /** 为防止主进程资源耗尽，是否只检索了当前会话的可索引前缀 */
  truncated: boolean
  /** 查询文本过长，已拒绝模糊匹配以保护事件循环 */
  queryTooLong: boolean
}

export interface MessageSearchResult extends SessionMessageSearchResult {
  /** 对话 ID */
  conversationId: string
  /** 对话标题 */
  conversationTitle: string
  /** 是否已归档 */
  archived?: boolean
}

// ===== 消息发送 =====

/**
 * 发送消息的输入参数
 */
export interface ChatSendInput {
  /** 对话 ID */
  conversationId: string
  /** 用户消息内容 */
  userMessage: string
  /** 消息历史（用于上下文） */
  messageHistory: ChatMessage[]
  /** 渠道 ID */
  channelId: string
  /** 模型 ID */
  modelId: string
  /** 系统提示词（可选） */
  systemMessage?: string
  /** 上下文长度（轮数），'infinite' 表示全部包含 */
  contextLength?: number | 'infinite'
  /** 上下文分隔线对应的消息 ID 列表 */
  contextDividers?: string[]
  /** 文件附件列表 */
  attachments?: FileAttachment[]
  /** 是否启用思考模式 */
  thinkingEnabled?: boolean
  /** 本次请求启用的工具 ID 列表（由前端工具选择器决定） */
  enabledToolIds?: string[]
}

// ===== 标题生成 =====

/**
 * 生成对话标题的输入参数
 */
export interface GenerateTitleInput {
  /** 用户消息内容（用于生成标题） */
  userMessage: string
  /** 渠道 ID */
  channelId: string
  /** 模型 ID */
  modelId: string
}

// ===== 流式事件载荷 =====

/**
 * 流式内容片段事件
 */
export interface StreamChunkEvent {
  /** 对话 ID */
  conversationId: string
  /** 内容增量 */
  delta: string
}

/**
 * 流式推理片段事件
 */
export interface StreamReasoningEvent {
  /** 对话 ID */
  conversationId: string
  /** 推理增量 */
  delta: string
}

/**
 * 流式完成事件
 */
export interface StreamCompleteEvent {
  /** 对话 ID */
  conversationId: string
  /** 使用的模型 */
  model: string
  /** 助手消息 ID */
  messageId: string
}

/**
 * 流式错误事件
 */
export interface StreamErrorEvent {
  /** 对话 ID */
  conversationId: string
  /** 错误信息 */
  error: string
}

/**
 * Chat 工具活动（记忆工具调用状态）
 */
export interface ChatToolActivity {
  /** 工具调用 ID */
  toolCallId: string
  /** 工具名称 */
  toolName: string
  /** 活动类型：开始 / 结果 */
  type: 'start' | 'result'
  /** 执行结果（仅 result 时存在） */
  result?: string
  /** 是否遇到错误 */
  isError?: boolean
  /** 工具调用参数（result 事件中携带，用于语义化短语和结构化结果渲染） */
  input?: Record<string, unknown>
}

/**
 * 流式工具活动事件
 */
export interface StreamToolActivityEvent {
  /** 对话 ID */
  conversationId: string
  /** 工具活动详情 */
  activity: ChatToolActivity
}

// ===== 模型选项 =====

/**
 * 模型选项（扁平化的渠道+模型组合）
 *
 * 用于渲染进程的模型选择器下拉列表
 */
export interface ModelOption {
  /** 渠道 ID */
  channelId: string
  /** 渠道名称 */
  channelName: string
  /** 模型 ID */
  modelId: string
  /** 模型显示名称 */
  modelName: string
  /** AI 供应商类型 */
  provider: ProviderType
}

// ===== 分页加载相关 =====

/**
 * 最近消息加载结果
 *
 * 用于分页加载：首次仅加载尾部 N 条消息，
 * 向上滚动时再加载全部。
 */
export interface RecentMessagesResult {
  /** 本次返回的消息列表（按时间正序） */
  messages: ChatMessage[]
  /** 对话中的总消息数 */
  total: number
  /** 是否还有更多历史消息 */
  hasMore: boolean
}

// ===== IPC 通道常量 =====

/**
 * Chat 相关 IPC 通道常量
 */
export const CHAT_IPC_CHANNELS = {
  // 对话管理
  /** 获取对话列表 */
  LIST_CONVERSATIONS: 'chat:list-conversations',
  /** 创建对话 */
  CREATE_CONVERSATION: 'chat:create-conversation',
  /** 获取对话消息（全部） */
  GET_MESSAGES: 'chat:get-messages',
  /** 获取对话最近 N 条消息（分页加载） */
  GET_RECENT_MESSAGES: 'chat:get-recent-messages',
  /** 获取指定消息附近的小窗口，供搜索定位避免回传完整历史 */
  GET_MESSAGES_AROUND: 'chat:get-messages-around',
  /** 更新对话标题 */
  UPDATE_TITLE: 'chat:update-title',
  /** 删除对话 */
  DELETE_CONVERSATION: 'chat:delete-conversation',
  /** 更新对话使用的模型/渠道 */
  UPDATE_MODEL: 'chat:update-conversation-model',

  // 消息发送
  /** 发送消息（触发 AI 流式响应） */
  SEND_MESSAGE: 'chat:send-message',
  /** 中止生成 */
  STOP_GENERATION: 'chat:stop-generation',
  /** 删除消息 */
  DELETE_MESSAGE: 'chat:delete-message',
  /** 从指定消息开始截断后续消息（包含该消息） */
  TRUNCATE_MESSAGES_FROM: 'chat:truncate-messages-from',
  /** 更新上下文分隔线 */
  UPDATE_CONTEXT_DIVIDERS: 'chat:update-context-dividers',
  /** 生成对话标题 */
  GENERATE_TITLE: 'chat:generate-title',

  // 附件管理
  /** 保存附件到本地 */
  SAVE_ATTACHMENT: 'chat:save-attachment',
  /** 读取附件（返回 base64） */
  READ_ATTACHMENT: 'chat:read-attachment',
  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  SAVE_IMAGE_AS: 'chat:save-image-as',
  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  SAVE_RESOURCE_FILE_AS: 'chat:save-resource-file-as',
  /** 删除附件 */
  DELETE_ATTACHMENT: 'chat:delete-attachment',
  /** 打开文件选择对话框 */
  OPEN_FILE_DIALOG: 'chat:open-file-dialog',
  /** 提取附件文档的文本内容 */
  EXTRACT_ATTACHMENT_TEXT: 'chat:extract-attachment-text',

  // 置顶管理
  /** 切换对话置顶状态 */
  TOGGLE_PIN: 'chat:toggle-pin',
  /** 切换对话归档状态 */
  TOGGLE_ARCHIVE: 'chat:toggle-archive',
  /** 搜索所有对话消息内容 */
  SEARCH_MESSAGES: 'chat:search-messages',
  /** 搜索当前对话的完整消息历史（仅返回命中元数据） */
  SEARCH_SESSION_MESSAGES: 'chat:search-session-messages',

  // 教程
  /** 获取教程内容 */
  GET_TUTORIAL_CONTENT: 'chat:get-tutorial-content',
  /** 创建欢迎对话（含教程附件） */
  CREATE_WELCOME_CONVERSATION: 'chat:create-welcome-conversation',

  // 流式事件（主进程 → 渲染进程推送）
  /** 内容片段 */
  STREAM_CHUNK: 'chat:stream:chunk',
  /** 推理片段 */
  STREAM_REASONING: 'chat:stream:reasoning',
  /** 流式完成 */
  STREAM_COMPLETE: 'chat:stream:complete',
  /** 流式错误 */
  STREAM_ERROR: 'chat:stream:error',
  /** 工具活动事件（记忆工具调用/结果指示） */
  STREAM_TOOL_ACTIVITY: 'chat:stream:tool-activity',
} as const
