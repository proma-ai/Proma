/**
 * 对话管理器
 *
 * 负责对话的 CRUD 操作和消息持久化。
 * - 对话索引：~/.proma/conversations.json（轻量元数据）
 * - 消息存储：~/.proma/conversations/{id}.jsonl（JSONL 格式，逐行追加）
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  getConversationsIndexPath,
  getConversationsDir,
  getConversationMessagesPath,
} from './config-paths'
import { deleteConversationAttachments, deleteAttachment } from './attachment-service'
import type { ConversationMeta, ChatMessage, RecentMessagesResult } from '@proma/shared'

/**
 * 对话索引文件格式
 */
interface ConversationsIndex {
  /** 配置版本号 */
  version: number
  /** 对话元数据列表 */
  conversations: ConversationMeta[]
}

/** 当前索引版本 */
const INDEX_VERSION = 1

/**
 * 读取对话索引文件
 */
function readIndex(): ConversationsIndex {
  const indexPath = getConversationsIndexPath()

  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, conversations: [] }
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8')
    return JSON.parse(raw) as ConversationsIndex
  } catch (error) {
    console.error('[对话管理] 读取索引文件失败:', error)
    return { version: INDEX_VERSION, conversations: [] }
  }
}

/**
 * 写入对话索引文件
 */
function writeIndex(index: ConversationsIndex): void {
  const indexPath = getConversationsIndexPath()

  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (error) {
    console.error('[对话管理] 写入索引文件失败:', error)
    throw new Error('写入对话索引失败')
  }
}

/**
 * 获取所有对话（按 updatedAt 降序）
 */
export function listConversations(): ConversationMeta[] {
  const index = readIndex()
  return index.conversations.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 创建新对话
 *
 * @param title 对话标题（默认"新对话"）
 * @param modelId 默认模型 ID
 * @param channelId 使用的渠道 ID
 * @returns 创建的对话元数据
 */
export function createConversation(
  title?: string,
  modelId?: string,
  channelId?: string,
): ConversationMeta {
  const index = readIndex()
  const now = Date.now()

  const meta: ConversationMeta = {
    id: randomUUID(),
    title: title || '新对话',
    modelId,
    channelId,
    createdAt: now,
    updatedAt: now,
  }

  index.conversations.push(meta)
  writeIndex(index)

  // 确保消息目录存在
  getConversationsDir()

  console.log(`[对话管理] 已创建对话: ${meta.title} (${meta.id})`)
  return meta
}

/**
 * 读取对话的所有消息
 *
 * 逐行读取 JSONL 文件，解析每行为 ChatMessage。
 *
 * @param id 对话 ID
 * @returns 消息列表
 */
export function getConversationMessages(id: string): ChatMessage[] {
  const filePath = getConversationMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())

    return lines.map((line) => JSON.parse(line) as ChatMessage)
  } catch (error) {
    console.error(`[对话管理] 读取消息失败 (${id}):`, error)
    return []
  }
}

/**
 * 读取对话的最近 N 条消息（从尾部读取）
 *
 * 用于分页加载：首次打开对话时只加载尾部少量消息，
 * 用户向上滚动时再加载全部历史。
 *
 * @param id 对话 ID
 * @param limit 返回的最大消息数
 * @returns 最近的消息列表 + 总数 + 是否还有更多
 */
export function getRecentMessages(id: string, limit: number): RecentMessagesResult {
  const filePath = getConversationMessagesPath(id)

  if (!existsSync(filePath)) {
    return { messages: [], total: 0, hasMore: false }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    const total = lines.length

    // 如果总数不超过 limit，直接返回全部
    if (total <= limit) {
      const messages = lines.map((line) => JSON.parse(line) as ChatMessage)
      return { messages, total, hasMore: false }
    }

    // 只解析尾部 limit 行
    const recentLines = lines.slice(-limit)
    const messages = recentLines.map((line) => JSON.parse(line) as ChatMessage)
    return { messages, total, hasMore: true }
  } catch (error) {
    console.error(`[对话管理] 读取最近消息失败 (${id}):`, error)
    return { messages: [], total: 0, hasMore: false }
  }
}

/**
 * 追加一条消息到对话的 JSONL 文件
 *
 * 使用 appendFile，无需读取整个文件。
 *
 * @param id 对话 ID
 * @param message 消息对象
 */
export function appendMessage(id: string, message: ChatMessage): void {
  const filePath = getConversationMessagesPath(id)

  try {
    const line = JSON.stringify(message) + '\n'
    appendFileSync(filePath, line, 'utf-8')
  } catch (error) {
    console.error(`[对话管理] 追加消息失败 (${id}):`, error)
    throw new Error('追加消息失败')
  }
}

/**
 * 全量覆写对话消息
 *
 * 用于编辑、删除消息等需要修改历史的场景。
 *
 * @param id 对话 ID
 * @param messages 完整消息列表
 */
export function saveConversationMessages(id: string, messages: ChatMessage[]): void {
  const filePath = getConversationMessagesPath(id)

  try {
    const content = messages.map((msg) => JSON.stringify(msg)).join('\n') + (messages.length > 0 ? '\n' : '')
    writeFileSync(filePath, content, 'utf-8')
  } catch (error) {
    console.error(`[对话管理] 保存消息失败 (${id}):`, error)
    throw new Error('保存消息失败')
  }
}

/**
 * 更新对话元数据
 *
 * @param id 对话 ID
 * @param updates 需要更新的字段
 * @returns 更新后的对话元数据
 */
export function updateConversationMeta(
  id: string,
  updates: Partial<Pick<ConversationMeta, 'title' | 'modelId' | 'channelId' | 'contextDividers' | 'contextLength' | 'pinned'>>,
): ConversationMeta {
  const index = readIndex()
  const idx = index.conversations.findIndex((c) => c.id === id)

  if (idx === -1) {
    throw new Error(`对话不存在: ${id}`)
  }

  const existing = index.conversations[idx]
  const updated: ConversationMeta = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  }

  index.conversations[idx] = updated
  writeIndex(index)

  console.log(`[对话管理] 已更新对话: ${updated.title} (${updated.id})`)
  return updated
}

/**
 * 删除对话
 *
 * 同时删除索引条目和消息文件。
 *
 * @param id 对话 ID
 */
export function deleteConversation(id: string): void {
  const index = readIndex()
  const idx = index.conversations.findIndex((c) => c.id === id)

  if (idx === -1) {
    throw new Error(`对话不存在: ${id}`)
  }

  const removed = index.conversations.splice(idx, 1)[0]
  writeIndex(index)

  // 删除消息文件
  const filePath = getConversationMessagesPath(id)
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch (error) {
      console.warn(`[对话管理] 删除消息文件失败 (${id}):`, error)
    }
  }

  console.log(`[对话管理] 已删除对话: ${removed.title} (${removed.id})`)

  // 删除对话附件目录
  deleteConversationAttachments(id)
}

/**
 * 删除指定消息
 *
 * 读取 JSONL → 过滤掉目标消息 → 覆写文件 → 返回更新后消息列表。
 *
 * @param conversationId 对话 ID
 * @param messageId 要删除的消息 ID
 * @returns 更新后的消息列表
 */
export function deleteMessage(conversationId: string, messageId: string): ChatMessage[] {
  const messages = getConversationMessages(conversationId)
  const targetMessage = messages.find((msg) => msg.id === messageId)
  const filtered = messages.filter((msg) => msg.id !== messageId)

  if (filtered.length === messages.length) {
    console.warn(`[对话管理] 消息不存在: ${messageId}`)
    return messages
  }

  // 删除消息关联的附件文件
  if (targetMessage?.attachments) {
    for (const attachment of targetMessage.attachments) {
      deleteAttachment(attachment.localPath)
    }
  }

  saveConversationMessages(conversationId, filtered)
  console.log(`[对话管理] 已删除消息: ${messageId} (对话 ${conversationId})`)
  return filtered
}

/**
 * 从指定消息开始截断对话（包含该消息）
 *
 * 常用于“重新发送”场景：删除目标消息及其后的所有消息，
 * 让对话从该点重新分叉。
 *
 * @param conversationId 对话 ID
 * @param messageId 截断起点消息 ID（包含）
 * @param preserveFirstMessageAttachments 是否保留起点消息的附件文件
 * @returns 截断后的消息列表（起点之前的消息）
 */
export function truncateMessagesFrom(
  conversationId: string,
  messageId: string,
  preserveFirstMessageAttachments = false,
): ChatMessage[] {
  const messages = getConversationMessages(conversationId)
  const startIndex = messages.findIndex((msg) => msg.id === messageId)

  if (startIndex === -1) {
    console.warn(`[对话管理] 截断起点消息不存在: ${messageId}`)
    return messages
  }

  const kept = messages.slice(0, startIndex)
  const removed = messages.slice(startIndex)

  // 删除被截断消息关联的附件文件
  removed.forEach((msg, idx) => {
    if (!msg.attachments || msg.attachments.length === 0) return
    // 允许保留起点消息的附件（用于“重发”复用）
    if (idx === 0 && preserveFirstMessageAttachments) return

    msg.attachments.forEach((attachment) => {
      deleteAttachment(attachment.localPath)
    })
  })

  saveConversationMessages(conversationId, kept)
  console.log(`[对话管理] 已从消息截断: ${messageId} (对话 ${conversationId})`)
  return kept
}

/**
 * 更新对话的上下文分隔线
 *
 * @param conversationId 对话 ID
 * @param dividers 新的分隔线消息 ID 列表
 * @returns 更新后的对话元数据
 */
export function updateContextDividers(conversationId: string, dividers: string[]): ConversationMeta {
  return updateConversationMeta(conversationId, { contextDividers: dividers })
}
