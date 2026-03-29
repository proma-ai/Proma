/**
 * Agent 会话管理器
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：~/.proma/agent-sessions.json（轻量元数据）
 * - 消息存储：~/.proma/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 照搬 conversation-manager.ts 的模式。
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, rmSync, renameSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentSessionWorkspacePath,
  getAgentWorkspacePath,
} from './config-paths'
import { getAgentWorkspace } from './agent-workspace-manager'
import type { AgentSessionMeta, AgentMessage, SDKMessage, ForkSessionInput, AgentMessageSearchResult } from '@proma/shared'
import { getConversationMessages } from './conversation-manager'
import { clearNanoBananaAgentHistory } from './chat-tools/nano-banana-mcp'

/**
 * 会话索引文件格式
 */
interface AgentSessionsIndex {
  /** 配置版本号 */
  version: number
  /** 会话元数据列表 */
  sessions: AgentSessionMeta[]
}

/** 当前索引版本 */
const INDEX_VERSION = 1

/**
 * 读取会话索引文件
 */
function readIndex(): AgentSessionsIndex {
  const indexPath = getAgentSessionsIndexPath()

  if (!existsSync(indexPath)) {
    return { version: INDEX_VERSION, sessions: [] }
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8')
    return JSON.parse(raw) as AgentSessionsIndex
  } catch (error) {
    console.error('[Agent 会话] 读取索引文件失败:', error)
    return { version: INDEX_VERSION, sessions: [] }
  }
}

/**
 * 写入会话索引文件
 */
function writeIndex(index: AgentSessionsIndex): void {
  const indexPath = getAgentSessionsIndexPath()

  try {
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Agent 会话] 写入索引文件失败:', error)
    throw new Error('写入 Agent 会话索引失败')
  }
}

/**
 * 获取所有会话（按 updatedAt 降序）
 */
export function listAgentSessions(): AgentSessionMeta[] {
  const index = readIndex()
  return index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 获取单个会话的元数据
 */
export function getAgentSessionMeta(id: string): AgentSessionMeta | undefined {
  const index = readIndex()
  return index.sessions.find((s) => s.id === id)
}

/**
 * 创建新会话
 */
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
): AgentSessionMeta {
  const index = readIndex()
  const now = Date.now()

  const meta: AgentSessionMeta = {
    id: randomUUID(),
    title: title || '新 Agent 会话',
    channelId,
    workspaceId,
    createdAt: now,
    updatedAt: now,
  }

  index.sessions.push(meta)
  writeIndex(index)

  // 确保消息目录存在
  getAgentSessionsDir()

  // 若有工作区，创建 session 级别子文件夹
  if (workspaceId) {
    const ws = getAgentWorkspace(workspaceId)
    if (ws) {
      getAgentSessionWorkspacePath(ws.slug, meta.id)
    }
  }

  console.log(`[Agent 会话] 已创建会话: ${meta.title} (${meta.id})`)
  return meta
}

/**
 * 读取会话的所有消息
 */
export function getAgentSessionMessages(id: string): AgentMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return lines.map((line) => JSON.parse(line) as AgentMessage)
  } catch (error) {
    console.error(`[Agent 会话] 读取消息失败 (${id}):`, error)
    return []
  }
}

/**
 * 追加一条消息到会话的 JSONL 文件
 */
export function appendAgentMessage(id: string, message: AgentMessage): void {
  const filePath = getAgentSessionMessagesPath(id)

  try {
    const line = JSON.stringify(message) + '\n'
    appendFileSync(filePath, line, 'utf-8')

    // 追加消息时更新 updatedAt，若已归档则自动恢复活跃
    const index = readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) {
      const session = index.sessions[idx]!
      session.updatedAt = Date.now()
      if (session.archived) session.archived = false
      writeIndex(index)
    }
  } catch (error) {
    console.error(`[Agent 会话] 追加消息失败 (${id}):`, error)
    throw new Error('追加 Agent 消息失败')
  }
}

/**
 * 追加 SDKMessage 到会话的 JSONL 文件（Phase 4 新持久化格式）
 *
 * 每条 SDKMessage 单独一行 JSON。读取时通过 `type` 字段区分新旧格式。
 */
export function appendSDKMessages(id: string, messages: SDKMessage[]): void {
  if (messages.length === 0) return

  const filePath = getAgentSessionMessagesPath(id)

  try {
    const lines = messages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    appendFileSync(filePath, lines, 'utf-8')
  } catch (error) {
    console.error(`[Agent 会话] 追加 SDKMessage 失败 (${id}):`, error)
    throw new Error('追加 SDKMessage 失败')
  }
}

/**
 * 读取会话的所有 SDKMessage（兼容旧 AgentMessage 格式）
 *
 * 旧格式（有 `role` 字段）会被转换为近似的 SDKMessage。
 * 新格式（有 `type` 字段）直接返回。
 */
export function getAgentSessionSDKMessages(id: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return lines.map((line) => {
      const parsed = JSON.parse(line)
      // 旧格式检测：AgentMessage 有 `role` 字段，SDKMessage 有 `type` 字段
      if ('role' in parsed && !('type' in parsed)) {
        return convertLegacyMessage(parsed as AgentMessage)
      }
      return parsed as SDKMessage
    })
  } catch (error) {
    console.error(`[Agent 会话] 读取 SDKMessage 失败 (${id}):`, error)
    return []
  }
}

/**
 * 将旧的 AgentMessage 转换为近似的 SDKMessage（向后兼容）
 *
 * 不需要完美还原，只需在 UI 中可读即可。
 */
function convertLegacyMessage(legacy: AgentMessage): SDKMessage {
  if (legacy.role === 'user') {
    return {
      type: 'user',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      // 附加元数据供渲染器使用
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'assistant') {
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
        model: legacy.model,
      },
      parent_tool_use_id: null,
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'status') {
    // 错误消息转换为 assistant error 格式
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      error: { message: legacy.content, errorType: legacy.errorCode },
      _legacy: true,
      _createdAt: legacy.createdAt,
      _errorCode: legacy.errorCode,
      _errorTitle: legacy.errorTitle,
      _errorDetails: legacy.errorDetails,
      _errorCanRetry: legacy.errorCanRetry,
      _errorActions: legacy.errorActions,
    } as unknown as SDKMessage
  }

  // 其他类型，作为 system 消息返回
  return {
    type: 'system',
    subtype: 'init',
    _legacy: true,
    _createdAt: legacy.createdAt,
  } as unknown as SDKMessage
}

/**
 * 更新会话元数据
 */
export function updateAgentSessionMeta(
  id: string,
  updates: Partial<Pick<AgentSessionMeta, 'title' | 'channelId' | 'sdkSessionId' | 'workspaceId' | 'pinned' | 'archived' | 'attachedDirectories' | 'forkedFromSdkSessionId' | 'forkAtMessageUuid' | 'forkSourceDir'>>,
): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const existing = index.sessions[idx]!
  // 非手动归档操作时，若会话已归档则自动恢复为活跃
  const autoUnarchive = existing.archived && !('archived' in updates)
  const updated: AgentSessionMeta = {
    ...existing,
    ...updates,
    ...(autoUnarchive ? { archived: false } : {}),
    updatedAt: Date.now(),
  }

  index.sessions[idx] = updated
  writeIndex(index)

  console.log(`[Agent 会话] 已更新会话: ${updated.title} (${updated.id})`)
  return updated
}

/**
 * 删除会话
 */
export function deleteAgentSession(id: string): void {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const removed = index.sessions.splice(idx, 1)[0]!
  writeIndex(index)

  // 删除消息文件
  const filePath = getAgentSessionMessagesPath(id)
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch (error) {
      console.warn(`[Agent 会话] 删除消息文件失败 (${id}):`, error)
    }
  }

  // 清理 session 工作目录
  if (removed.workspaceId) {
    const ws = getAgentWorkspace(removed.workspaceId)
    if (ws) {
      try {
        const sessionDir = getAgentSessionWorkspacePath(ws.slug, id)
        if (existsSync(sessionDir)) {
          rmSync(sessionDir, { recursive: true, force: true })
          console.log(`[Agent 会话] 已清理 session 工作目录: ${sessionDir}`)
        }
      } catch (error) {
        console.warn(`[Agent 会话] 清理 session 工作目录失败 (${id}):`, error)
      }
    }
  }

  console.log(`[Agent 会话] 已删除会话: ${removed.title} (${removed.id})`)

  // 清理 Nano Banana 生图历史
  clearNanoBananaAgentHistory(id)
}

/**
 * 迁移 Agent 会话到另一个工作区
 *
 * 操作步骤：
 * 1. 验证会话和目标工作区存在
 * 2. 源 == 目标 → no-op
 * 3. 移动会话工作目录到目标工作区
 * 4. 更新元数据（workspaceId + 清空 sdkSessionId）
 * 5. JSONL 消息文件保持原位（全局目录）
 */
export function moveSessionToWorkspace(sessionId: string, targetWorkspaceId: string): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${sessionId}`)
  }

  const session = index.sessions[idx]!

  // 源 == 目标 → 直接返回
  if (session.workspaceId === targetWorkspaceId) return session

  const targetWs = getAgentWorkspace(targetWorkspaceId)
  if (!targetWs) {
    throw new Error(`目标工作区不存在: ${targetWorkspaceId}`)
  }

  // 移动工作目录（如果源工作区存在）
  if (session.workspaceId) {
    const sourceWs = getAgentWorkspace(session.workspaceId)
    if (sourceWs) {
      const srcDir = join(getAgentWorkspacePath(sourceWs.slug), sessionId)
      if (existsSync(srcDir)) {
        const destDir = join(getAgentWorkspacePath(targetWs.slug), sessionId)
        // 清理已存在的空目标目录，防止 renameSync 抛出 ENOTEMPTY/EEXIST
        if (existsSync(destDir)) {
          try {
            const contents = readdirSync(destDir)
            if (contents.length === 0) {
              rmSync(destDir, { recursive: true })
              console.log(`[Agent 会话] 已清理空目标目录: ${destDir}`)
            } else {
              // 目标目录非空，合并：先移除目标，再移动源
              rmSync(destDir, { recursive: true })
              console.log(`[Agent 会话] 已清理非空目标目录（以源目录为准）: ${destDir}`)
            }
          } catch (cleanupError) {
            console.warn(`[Agent 会话] 清理目标目录失败，跳过目录迁移:`, cleanupError)
          }
        }
        renameSync(srcDir, destDir)
        console.log(`[Agent 会话] 已移动工作目录: ${srcDir} → ${destDir}`)
      }
    }
  }

  // 确保目标工作区下有 session 目录
  getAgentSessionWorkspacePath(targetWs.slug, sessionId)

  // 更新元数据
  const updated: AgentSessionMeta = {
    ...session,
    workspaceId: targetWorkspaceId,
    sdkSessionId: undefined, // SDK 上下文与工作区 cwd 绑定，必须清空
    updatedAt: Date.now(),
  }
  index.sessions[idx] = updated
  writeIndex(index)

  console.log(`[Agent 会话] 已迁移会话到工作区: ${updated.title} → ${targetWs.name}`)
  return updated
}

/**
 * 迁移 Chat 对话记录到 Agent 会话
 *
 * 读取 Chat 对话的消息，转换为 AgentMessage 格式，
 * 追加到目标 Agent 会话的 JSONL 文件中。
 *
 * 仅迁移 user 和 assistant 角色的消息文本内容，
 * 工具活动、推理、附件等 Chat 特有字段不迁移。
 */
export function migrateChatToAgentSession(conversationId: string, agentSessionId: string): void {
  const chatMessages = getConversationMessages(conversationId)

  if (chatMessages.length === 0) {
    console.log(`[Agent 会话] Chat 对话无消息，跳过迁移 (${conversationId})`)
    return
  }

  let count = 0
  for (const cm of chatMessages) {
    // 仅迁移 user 和 assistant 消息
    if (cm.role !== 'user' && cm.role !== 'assistant') continue
    if (!cm.content.trim()) continue

    const agentMsg: AgentMessage = {
      id: randomUUID(),
      role: cm.role,
      content: cm.content,
      createdAt: cm.createdAt,
      model: cm.role === 'assistant' ? cm.model : undefined,
    }

    appendAgentMessage(agentSessionId, agentMsg)
    count++
  }

  console.log(`[Agent 会话] 已迁移 ${count} 条消息到 Agent 会话 (${conversationId} → ${agentSessionId})`)
}

/**
 * 分叉 Agent 会话（延迟 fork 模式）
 *
 * 不直接调用 SDK forkSession()，而是创建一个带有 fork 元数据的新会话。
 * 首次发消息时，orchestrator 检测到 fork 元数据，会使用
 * `resume + forkSession: true + resumeSessionAt` 让 SDK 在正确的项目目录下
 * 创建分叉 session 文件。
 *
 * @returns 新创建的会话元数据
 */
export function forkAgentSession(input: ForkSessionInput): AgentSessionMeta {
  const { sessionId, upToMessageUuid } = input

  // 1. 获取源会话元数据
  const sourceMeta = getAgentSessionMeta(sessionId)
  if (!sourceMeta) {
    throw new Error(`源 Agent 会话不存在: ${sessionId}`)
  }

  if (!sourceMeta.sdkSessionId) {
    throw new Error('该会话没有 SDK session，无法分叉')
  }

  // 2. 确定源会话的工作目录（fork 时 SDK 需要从此目录的项目空间读取 session 文件）
  let sourceDir: string | undefined
  if (sourceMeta.workspaceId) {
    const ws = getAgentWorkspace(sourceMeta.workspaceId)
    if (ws) {
      sourceDir = getAgentSessionWorkspacePath(ws.slug, sessionId)
    }
  }

  // 3. 创建 Proma 新会话，携带 fork 元数据
  const forkTitle = `${sourceMeta.title} (fork)`
  const newMeta = createAgentSession(
    forkTitle,
    sourceMeta.channelId,
    sourceMeta.workspaceId,
  )

  // 4. 写入 fork 元数据（orchestrator 首次发消息时消费）
  updateAgentSessionMeta(newMeta.id, {
    forkedFromSdkSessionId: sourceMeta.sdkSessionId,
    forkAtMessageUuid: upToMessageUuid,
    forkSourceDir: sourceDir,
  })
  newMeta.forkedFromSdkSessionId = sourceMeta.sdkSessionId
  newMeta.forkAtMessageUuid = upToMessageUuid
  newMeta.forkSourceDir = sourceDir

  // 5. 复制截断后的 SDKMessages 到新会话的 JSONL（用于 UI 展示历史）
  const sourceMessages = getAgentSessionSDKMessages(sessionId)
  let messagesToCopy: SDKMessage[]

  if (upToMessageUuid) {
    const cutIndex = sourceMessages.findIndex(
      (m) => 'uuid' in m && (m as { uuid?: string }).uuid === upToMessageUuid,
    )
    messagesToCopy = cutIndex >= 0 ? sourceMessages.slice(0, cutIndex + 1) : sourceMessages
  } else {
    messagesToCopy = sourceMessages
  }

  if (messagesToCopy.length > 0) {
    appendSDKMessages(newMeta.id, messagesToCopy)
  }

  console.log(`[Agent 会话] 分叉会话已创建（延迟 fork）: ${sourceMeta.title} → ${forkTitle} (${messagesToCopy.length} 条消息)`)
  return newMeta
}

/**
 * 自动归档超过指定天数未更新的 Agent 会话
 *
 * 置顶会话不会被归档。
 *
 * @param daysThreshold 天数阈值
 * @returns 本次归档的会话数量
 */
export function autoArchiveAgentSessions(daysThreshold: number): number {
  const index = readIndex()
  const threshold = Date.now() - daysThreshold * 86_400_000
  let count = 0

  for (const session of index.sessions) {
    if (!session.pinned && !session.archived && session.updatedAt < threshold) {
      session.archived = true
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 自动归档 ${count} 个会话（阈值: ${daysThreshold} 天）`)
  }

  return count
}

/**
 * 搜索 Agent 会话消息内容
 *
 * 遍历所有会话的 JSONL 文件，逐行搜索 content 字段。
 * 每个会话最多返回 1 条最佳匹配，总计最多 30 条结果。
 *
 * @param query 搜索关键词
 * @returns 匹配结果列表
 */
export function searchAgentSessionMessages(query: string): AgentMessageSearchResult[] {
  if (!query || query.length < 2) return []

  const index = readIndex()
  const results: AgentMessageSearchResult[] = []
  const queryLower = query.toLowerCase()
  const maxResults = 30

  for (const session of index.sessions) {
    if (results.length >= maxResults) break

    const filePath = getAgentSessionMessagesPath(session.id)
    if (!existsSync(filePath)) continue

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const lines = raw.split('\n').filter((line) => line.trim())

      for (const line of lines) {
        const parsed = JSON.parse(line)
        // 兼容旧 AgentMessage 和新 SDKMessage 格式
        const content = parsed.content ?? ''
        const role = parsed.role ?? 'assistant'
        const messageId = parsed.id ?? parsed.uuid ?? ''
        if (!content) continue

        const contentLower = (typeof content === 'string' ? content : '').toLowerCase()
        const matchIndex = contentLower.indexOf(queryLower)
        if (matchIndex === -1) continue

        // 提取匹配上下文 snippet
        const textContent = typeof content === 'string' ? content : ''
        const snippetStart = Math.max(0, matchIndex - 40)
        const snippetEnd = Math.min(textContent.length, matchIndex + query.length + 40)
        const snippet = (snippetStart > 0 ? '...' : '') +
          textContent.slice(snippetStart, snippetEnd) +
          (snippetEnd < textContent.length ? '...' : '')
        const matchStart = matchIndex - snippetStart + (snippetStart > 0 ? 3 : 0)

        results.push({
          sessionId: session.id,
          sessionTitle: session.title,
          messageId,
          role,
          snippet,
          matchStart,
          matchLength: query.length,
          archived: session.archived,
        })

        // 每个会话只取 1 条匹配
        break
      }
    } catch {
      // 跳过读取失败的文件
    }
  }

  return results
}
