/**
 * 同步数据转换器
 *
 * 负责 Remote (MySQL API) ↔ Local (JSONL) 之间的数据格式转换。
 * 纯函数，无副作用。
 */

import type {
  ChatMessage,
  ConversationMeta,
  FileAttachment,
  ToolCallInfo,
  ToolCallSource,
  ToolCallResult,
} from '@proma/shared'
import type {
  RemoteConversation,
  RemoteMessage,
  RemoteAttachment,
  RemoteToolCall,
} from '@proma/shared'

// ===== Remote → Local 转换 =====

/**
 * 远端对话 → 本地对话元数据
 */
export function remoteConversationToLocal(remote: RemoteConversation): ConversationMeta {
  return {
    id: remote.id,
    title: remote.title,
    modelId: remote.modelId ?? undefined,
    contextDividers: remote.contextDividers ?? undefined,
    pinned: remote.isPinned || undefined,
    createdAt: new Date(remote.createdAt).getTime(),
    updatedAt: new Date(remote.updatedAt).getTime(),
    // 云端同步字段
    systemMessage: remote.systemMessage ?? undefined,
    promptId: remote.promptId ?? undefined,
    folderId: remote.folderId ?? undefined,
  }
}

/**
 * 远端消息 → 本地消息
 */
export function remoteMessageToLocal(remote: RemoteMessage): ChatMessage {
  const message: ChatMessage = {
    id: remote.id,
    role: remote.role,
    content: remote.content,
    createdAt: new Date(remote.createdAt).getTime(),
  }

  if (remote.model) message.model = remote.model
  if (remote.reasoning) message.reasoning = remote.reasoning
  if (remote.stopped) message.stopped = remote.stopped
  if (remote.inputTokens != null) message.inputTokens = remote.inputTokens
  if (remote.outputTokens != null) message.outputTokens = remote.outputTokens

  // 附件转换
  if (remote.attachments && remote.attachments.length > 0) {
    message.attachments = remote.attachments.map(remoteAttachmentToLocal)
  }

  // 工具调用转换
  if (remote.toolCalls && remote.toolCalls.length > 0) {
    message.toolCalls = remote.toolCalls.map(remoteToolCallToLocal)
  }

  return message
}

/**
 * 远端附件 → 本地附件
 *
 * 云端附件使用 URL 存储，localPath 留空字符串
 */
function remoteAttachmentToLocal(remote: RemoteAttachment): FileAttachment {
  return {
    id: remote.ossPath || remote.url,
    filename: remote.filename || extractFilenameFromUrl(remote.url),
    mediaType: remote.mediaType || remote.type,
    localPath: '',            // 云端附件无本地路径
    size: remote.size || 0,
    url: remote.url,          // 使用 URL 展示
  }
}

/**
 * 远端工具调用 → 本地工具调用
 */
function remoteToolCallToLocal(remote: RemoteToolCall): ToolCallInfo {
  // 判断 result 类型
  let result: ToolCallResult = { query: '', answer: '', sources: [] }

  if (remote.result && 'query' in remote.result) {
    const sources: ToolCallSource[] = (remote.result.sources || []).map((s) => ({
      url: s.url,
      title: s.title,
      content: s.content,
    }))
    result = {
      query: remote.result.query,
      answer: remote.result.answer || '',
      sources,
    }
  }

  return {
    id: remote.id,
    name: remote.name,
    result,
    status: remote.status === 'success' ? 'success' : 'error',
    arguments: remote.arguments as Record<string, string>,
  }
}

// ===== Local → Remote 转换 =====

/**
 * 本地消息 → 远端消息保存格式
 *
 * 用于 POST /conversations/{id}/messages
 */
export function localMessageToRemote(local: ChatMessage): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    id: local.id,
    role: local.role,
    content: local.content,
    createdAt: new Date(local.createdAt).toISOString(),
  }

  if (local.model) msg.model = local.model
  if (local.reasoning) msg.reasoning = local.reasoning
  if (local.inputTokens != null) msg.inputTokens = local.inputTokens
  if (local.outputTokens != null) msg.outputTokens = local.outputTokens
  if (local.stopped) msg.stopped = local.stopped

  // 附件：本地文件暂不推送，只推送 URL 附件
  if (local.attachments && local.attachments.length > 0) {
    msg.attachments = local.attachments
      .filter((att) => att.url)
      .map((att) => ({
        type: 'file',
        url: att.url,
        mediaType: att.mediaType,
        filename: att.filename,
        size: att.size,
      }))
  }

  // 工具调用
  if (local.toolCalls && local.toolCalls.length > 0) {
    msg.toolCalls = local.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: tc.status,
      result: tc.result,
    }))
  }

  return msg
}

/**
 * 本地对话元数据 → 远端更新格式
 *
 * 用于 PATCH /conversations/{id}
 */
export function localConversationToRemoteUpdate(local: ConversationMeta): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  if (local.title) update.title = local.title
  if (local.modelId) update.modelId = local.modelId
  if (local.systemMessage !== undefined) update.systemMessage = local.systemMessage
  if (local.contextDividers) update.contextDividers = local.contextDividers

  return update
}

// ===== 工具函数 =====

/**
 * 从 URL 中提取文件名
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const parts = pathname.split('/')
    return parts[parts.length - 1] || 'unknown'
  } catch {
    return 'unknown'
  }
}
