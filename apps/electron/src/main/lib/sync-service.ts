/**
 * 数据同步服务
 *
 * 负责 Proma 本地 (JSONL) ↔ 云端 (MySQL API) 的对话数据同步。
 *
 * 核心原则：
 * - Local-first：所有操作先写本地，异步同步到云端
 * - 消息级去重：基于消息 ID（string）天然去重
 * - 乐观写入：不等待云端确认
 * - 按需拉取：每次最多拉最近 N 个对话，用户需要更多时再拉
 * - 仅推送远端已有：纯本地对话不推送，避免 ID 不匹配的 404
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSyncStatePath } from './config-paths'
import {
  listConversations,
  getConversationMessages,
  saveConversationMessages,
} from './conversation-manager'
import {
  remoteConversationToLocal,
  remoteMessageToLocal,
  localMessageToRemote,
  localConversationToRemoteUpdate,
} from './sync-converter'

import type { WebContents } from 'electron'
import type { CloudApiClient } from '@proma/cloud'
import type { ConversationMeta, ChatMessage } from '@proma/shared'
import type {
  SyncState,
  SyncResult,
  SyncProgressEvent,
  RemoteConversationListResponse,
  RemoteConversation,
  RemoteMessagesResponse,
} from '@proma/shared'
import { SYNC_IPC_CHANNELS } from '@proma/shared'

/** 每次拉取的最大对话数 */
const PULL_BATCH_SIZE = 5

// ===== 同步状态持久化 =====

function createDefaultSyncState(): SyncState {
  return {
    lastFullSyncAt: null,
    lastPullAt: null,
    lastDownloadAllAt: null,
    conversations: {},
  }
}

function readSyncState(): SyncState {
  const path = getSyncStatePath()
  if (!existsSync(path)) return createDefaultSyncState()

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SyncState
  } catch {
    console.error('[同步] 读取同步状态失败，使用默认值')
    return createDefaultSyncState()
  }
}

function writeSyncState(state: SyncState): void {
  try {
    writeFileSync(getSyncStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    console.error('[同步] 写入同步状态失败:', error)
  }
}

/** 获取本地索引文件路径 */
function getConversationsIndexPath(): string {
  return getSyncStatePath().replace('sync-state.json', 'conversations.json')
}

/** 读取本地对话索引 */
function readLocalIndex(): { version: number; conversations: ConversationMeta[] } {
  try {
    return JSON.parse(readFileSync(getConversationsIndexPath(), 'utf-8'))
  } catch {
    return { version: 1, conversations: listConversations() }
  }
}

/** 写入本地对话索引 */
function writeLocalIndex(index: { version: number; conversations: ConversationMeta[] }): void {
  writeFileSync(getConversationsIndexPath(), JSON.stringify(index, null, 2), 'utf-8')
}

// ===== API 调用封装 =====

function buildPath(base: string, params: Record<string, string | number | undefined>): string {
  const pairs: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return pairs.length > 0 ? `${base}?${pairs.join('&')}` : base
}

/**
 * 拉取最近 N 个对话（按 updatedAt 降序，API 默认排序）
 *
 * @param limit 最多拉取的对话数
 * @returns 对话详情列表（已按远端 updatedAt 降序排列）
 */
async function fetchRecentConversations(
  client: CloudApiClient,
  limit: number,
): Promise<RemoteConversation[]> {
  const result: RemoteConversation[] = []
  let cursor: string | undefined
  let remaining = limit

  while (remaining > 0) {
    const batchSize = Math.min(remaining, 20)
    const path = buildPath('/conversations', { cursor, limit: batchSize })
    const res = await client.get<RemoteConversationListResponse>(path)
    const items = res.data.conversations

    if (items.length === 0) break

    for (const item of items) {
      if (remaining <= 0) break
      try {
        const detail = await client.get<RemoteConversation>(`/conversations/${item.id}`)
        result.push(detail.data)
        remaining--
      } catch (error) {
        console.warn(`[同步] 拉取对话详情失败 (${item.id}):`, error)
      }
    }

    if (!res.data.nextCursor || remaining <= 0) break
    cursor = res.data.nextCursor
  }

  return result
}

/**
 * 分页拉取对话的所有消息
 */
async function fetchAllMessages(
  client: CloudApiClient,
  conversationId: string,
): Promise<RemoteMessagesResponse['messages']> {
  const allMessages: RemoteMessagesResponse['messages'] = []
  let cursor: string | undefined

  while (true) {
    const path = buildPath(`/conversations/${conversationId}/messages`, { cursor, limit: 100 })
    const res = await client.get<RemoteMessagesResponse>(path)

    allMessages.push(...res.data.messages)

    if (!res.data.nextCursor) break
    cursor = res.data.nextCursor
  }

  return allMessages
}

// ===== 进度通知 =====

function notifyProgress(
  webContents: WebContents | null,
  event: SyncProgressEvent,
): void {
  if (!webContents || webContents.isDestroyed()) return
  webContents.send(SYNC_IPC_CHANNELS.SYNC_PROGRESS, event)
}

// ===== 对话写入本地（共用逻辑） =====

/**
 * 将远端对话+消息写入本地存储
 *
 * 如果本地已有同 ID 的对话，按消息 ID 去重合并。
 * @returns 新增的消息数
 */
function mergeRemoteConversationToLocal(
  remoteConv: RemoteConversation,
  remoteMessages: RemoteMessagesResponse['messages'],
  localIndex: { version: number; conversations: ConversationMeta[] },
  localConvMap: Map<string, ConversationMeta>,
): number {
  const localMeta = remoteConversationToLocal(remoteConv)
  const convertedMessages = remoteMessages.map(remoteMessageToLocal)
  let newMessageCount = 0

  if (localConvMap.has(remoteConv.id)) {
    const existingMessages = getConversationMessages(remoteConv.id)
    const mergedMessages = mergeMessages(existingMessages, convertedMessages)
    newMessageCount = mergedMessages.length - existingMessages.length

    if (newMessageCount > 0) {
      saveConversationMessages(remoteConv.id, mergedMessages)
    }

    // 更新元数据（保留本地独有字段：channelId、contextLength）
    const existingMeta = localConvMap.get(remoteConv.id)!
    const updatedMeta: ConversationMeta = {
      ...existingMeta,
      title: localMeta.title,
      modelId: localMeta.modelId || existingMeta.modelId,
      contextDividers: localMeta.contextDividers || existingMeta.contextDividers,
      pinned: localMeta.pinned || existingMeta.pinned,
      systemMessage: localMeta.systemMessage,
      promptId: localMeta.promptId,
      folderId: localMeta.folderId,
      updatedAt: Math.max(localMeta.updatedAt, existingMeta.updatedAt),
    }

    const idx = localIndex.conversations.findIndex((c) => c.id === remoteConv.id)
    if (idx !== -1) {
      localIndex.conversations[idx] = updatedMeta
    }
  } else {
    // 新对话：直接写入
    saveConversationMessages(remoteConv.id, convertedMessages)
    localIndex.conversations.push(localMeta)
    newMessageCount = convertedMessages.length
  }

  return newMessageCount
}

// ===== 核心同步逻辑 =====

/**
 * 全量同步（首次使用）
 *
 * 拉取最近 PULL_BATCH_SIZE 个对话写入本地。
 * 不一次性拉取全部，避免首次使用时下载量过大。
 */
export async function fullSync(
  client: CloudApiClient,
  webContents: WebContents | null,
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    pulledConversations: 0,
    pulledMessages: 0,
    pushedConversations: 0,
    pushedMessages: 0,
  }

  try {
    notifyProgress(webContents, {
      phase: 'pulling',
      progress: 0,
      message: `正在获取最近 ${PULL_BATCH_SIZE} 个云端对话...`,
    })

    const remoteConversations = await fetchRecentConversations(client, PULL_BATCH_SIZE)
    const total = remoteConversations.length

    console.log(`[同步] 首次同步: 获取到 ${total} 个远端对话`)

    if (total === 0) {
      const syncState = readSyncState()
      syncState.lastFullSyncAt = Date.now()
      syncState.lastPullAt = Date.now()
      writeSyncState(syncState)

      notifyProgress(webContents, { phase: 'done', progress: 100, message: '云端没有对话需要同步' })
      result.success = true
      return result
    }

    const localIndex = readLocalIndex()
    const localConvMap = new Map(localIndex.conversations.map((c) => [c.id, c]))
    const syncState = readSyncState()
    const now = Date.now()

    for (let i = 0; i < remoteConversations.length; i++) {
      const remoteConv = remoteConversations[i]
      const progress = Math.round(((i + 1) / total) * 90)

      notifyProgress(webContents, {
        phase: 'pulling',
        progress,
        message: `正在同步对话 (${i + 1}/${total}): ${remoteConv.title}`,
      })

      try {
        const remoteMessages = await fetchAllMessages(client, remoteConv.id)
        const newMsgs = mergeRemoteConversationToLocal(remoteConv, remoteMessages, localIndex, localConvMap)

        result.pulledConversations++
        result.pulledMessages += newMsgs

        syncState.conversations[remoteConv.id] = {
          localUpdatedAt: new Date(remoteConv.updatedAt).getTime(),
          remoteUpdatedAt: new Date(remoteConv.updatedAt).getTime(),
          lastSyncedAt: now,
          syncStatus: 'synced',
        }
      } catch (error) {
        console.error(`[同步] 同步对话失败 (${remoteConv.id}):`, error)
      }
    }

    writeLocalIndex(localIndex)
    syncState.lastFullSyncAt = now
    syncState.lastPullAt = now
    writeSyncState(syncState)

    result.success = true

    notifyProgress(webContents, {
      phase: 'done',
      progress: 100,
      message: `同步完成：${result.pulledConversations} 个对话，${result.pulledMessages} 条消息`,
    })

    console.log(`[同步] 首次同步完成: ${result.pulledConversations} 对话, ${result.pulledMessages} 消息`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    result.error = errorMsg
    notifyProgress(webContents, { phase: 'error', progress: 0, message: '同步失败', error: errorMsg })
    console.error('[同步] 首次同步失败:', error)
  }

  return result
}

/**
 * 增量同步
 *
 * 拉取最近 PULL_BATCH_SIZE 个远端对话中有变化的，
 * 推送本地对「远端已有」对话的增量消息。
 */
export async function incrementalSync(
  client: CloudApiClient,
  webContents: WebContents | null,
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    pulledConversations: 0,
    pulledMessages: 0,
    pushedConversations: 0,
    pushedMessages: 0,
  }

  const syncState = readSyncState()

  if (!syncState.lastFullSyncAt) {
    console.log('[同步] 未执行过首次同步，自动触发')
    return fullSync(client, webContents)
  }

  try {
    notifyProgress(webContents, { phase: 'pulling', progress: 10, message: '正在检查云端更新...' })

    // 1. 拉取最近 N 个远端对话（不是全部）
    const pullResult = await pullRecentChanges(client, syncState, PULL_BATCH_SIZE)
    result.pulledConversations = pullResult.conversations
    result.pulledMessages = pullResult.messages

    syncState.lastPullAt = Date.now()
    writeSyncState(syncState)

    result.success = true

    notifyProgress(webContents, {
      phase: 'done',
      progress: 100,
      message: `同步完成：拉取 ${result.pulledConversations} 个对话`,
    })

    console.log(`[同步] 增量同步完成: 拉取 ${result.pulledConversations} 对话/${result.pulledMessages} 消息`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    result.error = errorMsg
    notifyProgress(webContents, { phase: 'error', progress: 0, message: '增量同步失败', error: errorMsg })
    console.error('[同步] 增量同步失败:', error)
  }

  return result
}

/**
 * 拉取更多历史对话（用户触发）
 *
 * 跳过已同步的对话，拉取下一批 PULL_BATCH_SIZE 个。
 */
export async function pullMoreConversations(
  client: CloudApiClient,
  webContents: WebContents | null,
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    pulledConversations: 0,
    pulledMessages: 0,
    pushedConversations: 0,
    pushedMessages: 0,
  }

  try {
    const syncState = readSyncState()
    const syncedIds = new Set(Object.keys(syncState.conversations))

    notifyProgress(webContents, { phase: 'pulling', progress: 10, message: '正在加载更多历史对话...' })

    // 拉取比已有更多的对话（跳过已同步的）
    const localIndex = readLocalIndex()
    const localConvMap = new Map(localIndex.conversations.map((c) => [c.id, c]))

    // 用翻页方式找到还没同步过的对话
    let cursor: string | undefined
    let found = 0
    const now = Date.now()

    outer:
    while (found < PULL_BATCH_SIZE) {
      const batchSize = Math.min(20, PULL_BATCH_SIZE * 3) // 多拉一些列表项，因为很多可能已同步
      const path = buildPath('/conversations', { cursor, limit: batchSize })
      const res = await client.get<RemoteConversationListResponse>(path)
      const items = res.data.conversations

      if (items.length === 0) break

      for (const item of items) {
        if (found >= PULL_BATCH_SIZE) break outer

        // 跳过已同步的
        if (syncedIds.has(item.id)) continue

        try {
          const detail = await client.get<RemoteConversation>(`/conversations/${item.id}`)
          const remoteMessages = await fetchAllMessages(client, item.id)
          const newMsgs = mergeRemoteConversationToLocal(detail.data, remoteMessages, localIndex, localConvMap)

          result.pulledConversations++
          result.pulledMessages += newMsgs
          found++

          syncState.conversations[item.id] = {
            localUpdatedAt: new Date(detail.data.updatedAt).getTime(),
            remoteUpdatedAt: new Date(detail.data.updatedAt).getTime(),
            lastSyncedAt: now,
            syncStatus: 'synced',
          }

          notifyProgress(webContents, {
            phase: 'pulling',
            progress: Math.round((found / PULL_BATCH_SIZE) * 90),
            message: `正在加载历史对话 (${found}/${PULL_BATCH_SIZE}): ${detail.data.title}`,
          })
        } catch (error) {
          console.warn(`[同步] 拉取历史对话失败 (${item.id}):`, error)
        }
      }

      if (!res.data.nextCursor) break
      cursor = res.data.nextCursor
    }

    if (result.pulledConversations > 0) {
      writeLocalIndex(localIndex)
      writeSyncState(syncState)
    }

    result.success = true

    const message = found > 0
      ? `已加载 ${result.pulledConversations} 个历史对话，${result.pulledMessages} 条消息`
      : '没有更多历史对话了'

    notifyProgress(webContents, { phase: 'done', progress: 100, message })
    console.log(`[同步] 加载更多: ${result.pulledConversations} 对话, ${result.pulledMessages} 消息`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    result.error = errorMsg
    notifyProgress(webContents, { phase: 'error', progress: 0, message: '加载历史对话失败', error: errorMsg })
    console.error('[同步] 加载更多失败:', error)
  }

  return result
}

/**
 * 从云端下载全部对话（用户手动触发）
 *
 * 分页遍历所有远端对话，跳过本地已存在的对话（按 ID 匹配），
 * 将新对话的详情和消息写入本地。
 */
export async function downloadAllConversations(
  client: CloudApiClient,
  webContents: WebContents | null,
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    pulledConversations: 0,
    pulledMessages: 0,
    pushedConversations: 0,
    pushedMessages: 0,
  }

  try {
    notifyProgress(webContents, { phase: 'pulling', progress: 0, message: '正在获取云端对话列表...' })

    const localIndex = readLocalIndex()
    const localIds = new Set(localIndex.conversations.map((c) => c.id))
    const syncState = readSyncState()
    const now = Date.now()

    // 分页遍历所有远端对话
    let cursor: string | undefined
    let totalProcessed = 0

    while (true) {
      const path = buildPath('/conversations', { cursor, limit: 20 })
      const res = await client.get<RemoteConversationListResponse>(path)
      const items = res.data.conversations

      if (items.length === 0) break

      for (const item of items) {
        totalProcessed++

        // 跳过本地已存在的对话
        if (localIds.has(item.id)) continue

        try {
          notifyProgress(webContents, {
            phase: 'pulling',
            progress: Math.min(90, totalProcessed * 2),
            message: `正在下载对话: ${item.title}`,
          })

          const detail = await client.get<RemoteConversation>(`/conversations/${item.id}`)
          const remoteMessages = await fetchAllMessages(client, item.id)

          // 转换并写入本地
          const localMeta = remoteConversationToLocal(detail.data)
          const convertedMessages = remoteMessages.map(remoteMessageToLocal)

          saveConversationMessages(item.id, convertedMessages)
          localIndex.conversations.push(localMeta)
          localIds.add(item.id)

          result.pulledConversations++
          result.pulledMessages += convertedMessages.length

          syncState.conversations[item.id] = {
            localUpdatedAt: new Date(detail.data.updatedAt).getTime(),
            remoteUpdatedAt: new Date(detail.data.updatedAt).getTime(),
            lastSyncedAt: now,
            syncStatus: 'synced',
          }
        } catch (error) {
          console.warn(`[同步] 下载对话失败 (${item.id}):`, error)
        }
      }

      if (!res.data.nextCursor) break
      cursor = res.data.nextCursor
    }

    if (result.pulledConversations > 0) {
      writeLocalIndex(localIndex)
    }
    syncState.lastDownloadAllAt = Date.now()
    writeSyncState(syncState)

    result.success = true

    const message = result.pulledConversations > 0
      ? `下载完成：${result.pulledConversations} 个对话，${result.pulledMessages} 条消息`
      : '所有云端对话已在本地，无需下载'

    notifyProgress(webContents, { phase: 'done', progress: 100, message })
    console.log(`[同步] 下载全部: ${result.pulledConversations} 对话, ${result.pulledMessages} 消息`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    result.error = errorMsg
    notifyProgress(webContents, { phase: 'error', progress: 0, message: '下载全部对话失败', error: errorMsg })
    console.error('[同步] 下载全部失败:', error)
  }

  return result
}

// ===== 内部拉取/推送逻辑 =====

/**
 * 拉取最近 N 个远端对话中有更新的
 */
async function pullRecentChanges(
  client: CloudApiClient,
  syncState: SyncState,
  limit: number,
): Promise<{ conversations: number; messages: number }> {
  let conversations = 0
  let messages = 0

  const remoteConversations = await fetchRecentConversations(client, limit)
  const localIndex = readLocalIndex()
  const localConvMap = new Map(localIndex.conversations.map((c) => [c.id, c]))
  const now = Date.now()

  for (const remoteConv of remoteConversations) {
    const remoteUpdatedAt = new Date(remoteConv.updatedAt).getTime()
    const syncInfo = syncState.conversations[remoteConv.id]

    // 只拉取：新对话 或 远端更新时间晚于上次同步
    const needPull = !syncInfo || remoteUpdatedAt > syncInfo.lastSyncedAt
    if (!needPull) continue

    try {
      const remoteMessages = await fetchAllMessages(client, remoteConv.id)
      const newMsgs = mergeRemoteConversationToLocal(remoteConv, remoteMessages, localIndex, localConvMap)

      conversations++
      messages += newMsgs

      syncState.conversations[remoteConv.id] = {
        localUpdatedAt: new Date(remoteConv.updatedAt).getTime(),
        remoteUpdatedAt,
        lastSyncedAt: now,
        syncStatus: 'synced',
      }
    } catch (error) {
      console.warn(`[同步] 拉取对话变更失败 (${remoteConv.id}):`, error)
    }
  }

  if (conversations > 0) {
    writeLocalIndex(localIndex)
  }

  return { conversations, messages }
}

/**
 * 推送本地变更到远端
 *
 * 关键：只推送「远端已存在」的对话（remoteUpdatedAt > 0）。
 * 纯本地创建的对话不推送，因为远端没有对应 ID 会 404。
 */
async function pushLocalChanges(
  client: CloudApiClient,
  syncState: SyncState,
): Promise<{ conversations: number; messages: number }> {
  let conversations = 0
  let messages = 0

  const localConversations = listConversations()

  for (const localConv of localConversations) {
    const syncInfo = syncState.conversations[localConv.id]

    // 跳过纯本地对话（从未从远端同步过的）
    if (!syncInfo || syncInfo.remoteUpdatedAt === 0) continue

    // 跳过没有变更的对话
    if (localConv.updatedAt <= syncInfo.lastSyncedAt) continue

    try {
      // 推送增量消息（createdAt 晚于上次同步的消息）
      const localMessages = getConversationMessages(localConv.id)
      const newMessages = localMessages.filter(
        (msg) => msg.createdAt > syncInfo.lastSyncedAt,
      )

      if (newMessages.length > 0) {
        const remoteMsgs = newMessages.map(localMessageToRemote)
        const batchSize = 50
        for (let i = 0; i < remoteMsgs.length; i += batchSize) {
          const batch = remoteMsgs.slice(i, i + batchSize)
          await client.post(`/conversations/${localConv.id}/messages`, { messages: batch })
        }
        messages += newMessages.length
      }

      // 推送元数据更新
      const updateData = localConversationToRemoteUpdate(localConv)
      if (Object.keys(updateData).length > 0) {
        await client.put(`/conversations/${localConv.id}`, updateData)
      }

      conversations++

      syncState.conversations[localConv.id] = {
        ...syncInfo,
        localUpdatedAt: localConv.updatedAt,
        remoteUpdatedAt: localConv.updatedAt,
        lastSyncedAt: Date.now(),
        syncStatus: 'synced',
      }
    } catch (error) {
      console.warn(`[同步] 推送对话失败 (${localConv.id}):`, error)
      syncInfo.syncStatus = 'pending_push'
    }
  }

  return { conversations, messages }
}

// ===== 消息合并 =====

function mergeMessages(local: ChatMessage[], remote: ChatMessage[]): ChatMessage[] {
  const messageMap = new Map<string, ChatMessage>()

  // 本地优先
  for (const msg of local) {
    messageMap.set(msg.id, msg)
  }

  // 远端补充（不覆盖本地已有）
  for (const msg of remote) {
    if (!messageMap.has(msg.id)) {
      messageMap.set(msg.id, msg)
    }
  }

  return Array.from(messageMap.values()).sort((a, b) => a.createdAt - b.createdAt)
}

// ===== 公共 API =====

export function getSyncState(): SyncState {
  return readSyncState()
}

/**
 * 标记对话为待推送
 *
 * 仅对已同步过的对话（remoteUpdatedAt > 0）生效。
 * 纯本地对话不标记，避免后续推送时 404。
 */
export function markConversationDirty(conversationId: string): void {
  const state = readSyncState()

  if (!state.lastFullSyncAt) return

  const existing = state.conversations[conversationId]
  // 仅标记远端已有的对话
  if (existing && existing.remoteUpdatedAt > 0) {
    existing.localUpdatedAt = Date.now()
    existing.syncStatus = 'pending_push'
    writeSyncState(state)
  }
}

// ===== 启动时自动同步 =====

const AUTO_SYNC_DELAY = 3_000

/**
 * 启动时自动同步
 *
 * 窗口就绪后延迟执行，不阻塞 UI。
 */
export function scheduleAutoSync(window: import('electron').BrowserWindow): void {
  setTimeout(async () => {
    try {
      const { getAuthState } = await import('./cloud-auth-service')
      const { getApiClient } = await import('./cloud-auth-service')

      const authState = getAuthState()
      if (!authState.isAuthenticated) {
        console.log('[自动同步] 用户未登录，跳过')
        return
      }

      const client = getApiClient()
      const webContents = window.isDestroyed() ? null : window.webContents

      console.log('[自动同步] 开始增量同步...')
      const result = await incrementalSync(client, webContents)

      if (result.success) {
        console.log(`[自动同步] 完成: 拉取 ${result.pulledConversations} 对话/${result.pulledMessages} 消息`)
      } else {
        console.warn('[自动同步] 失败:', result.error)
      }
    } catch (error) {
      console.warn('[自动同步] 异常:', error instanceof Error ? error.message : error)
    }
  }, AUTO_SYNC_DELAY)
}
