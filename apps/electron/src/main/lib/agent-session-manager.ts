/**
 * Agent 会话管理器
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：~/.proma/agent-sessions.json（轻量元数据）
 * - 消息存储：~/.proma/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 照搬 conversation-manager.ts 的模式。
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, rmSync, renameSync } from 'node:fs'
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
import type { AgentSessionMeta, AgentMessage } from '@proma/shared'
import { getConversationMessages } from './conversation-manager'

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
  } catch (error) {
    console.error(`[Agent 会话] 追加消息失败 (${id}):`, error)
    throw new Error('追加 Agent 消息失败')
  }
}

/**
 * 更新会话元数据
 */
export function updateAgentSessionMeta(
  id: string,
  updates: Partial<Pick<AgentSessionMeta, 'title' | 'channelId' | 'sdkSessionId' | 'workspaceId' | 'pinned' | 'attachedDirectories'>>,
): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const existing = index.sessions[idx]!
  const updated: AgentSessionMeta = {
    ...existing,
    ...updates,
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
