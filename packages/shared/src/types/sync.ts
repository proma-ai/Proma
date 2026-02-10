/**
 * 数据同步相关类型定义
 *
 * 用于 Proma 本地 ↔ 云端 (MySQL) 之间的对话数据同步。
 * 核心原则：Local-first，本地 JSONL 为唯一真实数据源。
 */

// ===== 远端 API 数据格式（proma-api MySQL 侧） =====

/**
 * 远端对话（GET /conversations 列表项）
 *
 * 对应 proma-frontend 的 ConversationListItem
 */
export interface RemoteConversationListItem {
  id: string
  title: string
  modelId: string | null
  updatedAt: string           // ISO 8601
  messageCount?: number
}

/**
 * 远端对话详情（GET /conversations/{id}）
 *
 * 对应 proma-frontend 的 Conversation
 */
export interface RemoteConversation {
  id: string
  title: string
  modelId: string | null
  systemMessage: string | null
  promptId: string | null
  contextDividers: string[] | null
  isPinned: boolean
  pinnedAt: string | null
  folderId: string | null
  createdAt: string           // ISO 8601
  updatedAt: string           // ISO 8601
}

/**
 * 远端消息（GET /conversations/{id}/messages）
 *
 * 对应 proma-frontend 的 ChatMessage
 */
export interface RemoteMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string           // ISO 8601
  model: string | null
  reasoning: string | null
  attachments: RemoteAttachment[] | null
  toolCalls: RemoteToolCall[] | null
  inputTokens: number | null
  outputTokens: number | null
  stopped?: boolean
}

/**
 * 远端附件格式（OSS URL 方式）
 *
 * 对应 proma-frontend 的 OSSFileUIPart
 */
export interface RemoteAttachment {
  type: string                // MIME 类型或 "file"
  url: string                 // 签名 URL 或 CDN URL
  mediaType: string
  filename?: string
  ossPath?: string            // OSS 对象路径，用于动态签名
  size?: number
}

/**
 * 远端工具调用搜索来源
 *
 * 对应 proma-frontend 的 SearchSource
 */
export interface RemoteSearchSource {
  title: string
  url: string
  content: string
}

/**
 * 远端工具调用信息
 *
 * 对应 proma-frontend 的 ToolCallInfo
 * 目前主要是 tavily_search，但保持通用结构
 */
export interface RemoteToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'executing' | 'success' | 'error'
  result?: {
    query: string
    answer?: string
    sources: RemoteSearchSource[]
  } | {
    error: string
  }
}

// ===== 远端 API 响应格式 =====

/** 对话列表响应 */
export interface RemoteConversationListResponse {
  conversations: RemoteConversationListItem[]
  nextCursor: string | null
}

/** 消息列表响应 */
export interface RemoteMessagesResponse {
  messages: RemoteMessage[]
  nextCursor: string | null
}

// ===== 同步状态追踪 =====

/** 单个对话的同步状态 */
export interface ConversationSyncInfo {
  /** 本地最后更新时间 */
  localUpdatedAt: number
  /** 远端最后更新时间（ISO 字符串转为 timestamp） */
  remoteUpdatedAt: number
  /** 上次成功同步时间 */
  lastSyncedAt: number
  /** 同步状态 */
  syncStatus: 'synced' | 'pending_push' | 'pending_pull' | 'conflict'
}

/**
 * 全局同步状态
 *
 * 持久化在 ~/.proma/sync-state.json
 */
export interface SyncState {
  /** 上次全量同步完成时间（null = 从未同步） */
  lastFullSyncAt: number | null
  /** 上次增量拉取时间 */
  lastPullAt: number | null
  /** 上次"下载全部对话"完成时间（null = 从未执行） */
  lastDownloadAllAt: number | null
  /** 每个对话的同步信息 */
  conversations: Record<string, ConversationSyncInfo>
}

// ===== 同步操作相关 =====

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgressEvent {
  /** 同步阶段 */
  phase: 'pulling' | 'pushing' | 'merging' | 'done' | 'error'
  /** 当前进度（0-100） */
  progress: number
  /** 进度描述 */
  message: string
  /** 错误信息（phase 为 error 时） */
  error?: string
}

/** 同步结果 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean
  /** 拉取的对话数 */
  pulledConversations: number
  /** 拉取的消息数 */
  pulledMessages: number
  /** 推送的对话数 */
  pushedConversations: number
  /** 推送的消息数 */
  pushedMessages: number
  /** 错误信息 */
  error?: string
}

// ===== 同步 IPC 通道常量 =====

export const SYNC_IPC_CHANNELS = {
  /** 触发全量同步 */
  FULL_SYNC: 'sync:full',
  /** 触发增量同步 */
  INCREMENTAL_SYNC: 'sync:incremental',
  /** 获取同步状态 */
  GET_SYNC_STATE: 'sync:get-state',
  /** 加载更多历史对话 */
  PULL_MORE: 'sync:pull-more',
  /** 从云端下载全部对话 */
  DOWNLOAD_ALL_CONVERSATIONS: 'sync:download-all-conversations',
  /** 同步进度推送（主进程 → 渲染进程） */
  SYNC_PROGRESS: 'sync:progress',
} as const
