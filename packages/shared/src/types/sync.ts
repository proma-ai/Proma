/**
 * 数据同步相关类型定义
 *
 * 用于 Proma 本地 ↔ 云端 (MySQL) 之间的对话数据同步。
 * 核心原则：Local-first，本地 JSONL 为唯一真实数据源。
 */

import type { ChatMessage, ConversationMeta } from './chat'

// ===== 远端 API 数据格式（MySQL 侧） =====

/** 远端对话（MySQL API 返回格式） */
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
  createdAt: string   // ISO 8601 DATETIME
  updatedAt: string   // ISO 8601 DATETIME
}

/** 远端消息（MySQL API 返回格式） */
export interface RemoteMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning: string | null
  model: string | null
  attachments: RemoteAttachment[] | null
  toolCalls: RemoteToolCall[] | null
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string   // ISO 8601 DATETIME
}

/** 远端附件格式 */
export interface RemoteAttachment {
  url: string
  type: string
  name?: string
  size?: number
}

/** 远端工具调用格式 */
export interface RemoteToolCall {
  id: string
  name: string
  result: {
    query: string
    answer: string
    sources: Array<{
      url: string
      title: string
      content: string
    }>
  }
  status: string
  arguments: Record<string, string>
}

/** 远端分页响应 */
export interface RemotePaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

// ===== 同步状态追踪 =====

/** 单个对话的同步状态 */
export interface ConversationSyncInfo {
  /** 本地最后更新时间 */
  localUpdatedAt: number
  /** 远端最后更新时间 */
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

// ===== 数据转换工具类型 =====

/** 远端 → 本地 转换后的对话元数据 */
export type ConvertedConversationMeta = ConversationMeta

/** 远端 → 本地 转换后的消息 */
export type ConvertedChatMessage = ChatMessage

// ===== 同步 IPC 通道常量 =====

export const SYNC_IPC_CHANNELS = {
  /** 触发全量同步 */
  FULL_SYNC: 'sync:full',
  /** 触发增量同步 */
  INCREMENTAL_SYNC: 'sync:incremental',
  /** 获取同步状态 */
  GET_SYNC_STATE: 'sync:get-state',
  /** 同步进度推送（主进程 → 渲染进程） */
  SYNC_PROGRESS: 'sync:progress',
} as const
