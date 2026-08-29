/**
 * Agent 会话管理器
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：~/.proma/agent-sessions.json（轻量元数据）
 * - 消息存储：~/.proma/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 照搬 conversation-manager.ts 的模式。
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, createReadStream, createWriteStream, statSync, type WriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { writeJsonFileAtomic, writeTextFileAtomic, readJsonFileSafe } from './safe-file'
import { randomUUID } from 'node:crypto'
import { rmSyncWithRetry, renameWithRetry } from './fs-retry'
import { isAbsolute, join } from 'node:path'
import {
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentSessionWorkspacePath,
  getAgentWorkspacePath,
  getSdkConfigDir,
} from './config-paths'
import {
  getAgentWorkspace,
  getProjectFilesPath,
  listAgentWorkspaces,
} from './agent-workspace-manager'
import { resolvePiThinkingLevel } from './agent-thinking-level'
import { getSettings } from './settings-service'
import type {
  AgentSessionMeta,
  AgentMessage,
  SDKMessage,
  SDKUserMessage,
  SkillActivation,
  AgentWorkspace,
  ForkSessionInput,
  AgentMessageSearchResult,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  AgentCwdMode,
  AgentActiveWorktree,
  SessionWorkbenchLayout,
} from '@proma/shared'
import { migratePermissionMode, mergeSkillActivations, findBestSearchMatch, insertTopSearchResult } from '@proma/shared'
import { getConversationMessages } from './conversation-manager'
// 旧格式 → SDKMessage 的转换逻辑下沉到 @proma/session-core 作为唯一真源，避免主进程与渲染层各存一份。
import { convertLegacyMessage } from '@proma/session-core'
import { clearNanoBananaAgentHistory } from './chat-tools/nano-banana-mcp'
import { assertEnabledModelForChannel } from './agent-model-selection'
import { copyForkWorkspaceFiles } from './agent-fork-workspace-copy'

/**
 * 会话索引文件格式
 */
interface AgentSessionsIndex {
  /** 配置版本号 */
  version: number
  /** 会话元数据列表 */
  sessions: AgentSessionMeta[]
  /** 是否已将旧版默认关闭的 OpenAI 推理会话升级为默认开启。 */
  openAIThinkingDefaultEnabledMigrationCompleted?: boolean
}

/** 当前索引版本：v2 将 Claude runtime 退役为 Pi-only。 */
const INDEX_VERSION = 2

/**
 * 会话引用最大返回数。
 *
 * 无搜索词时只返回索引中的轻量元数据，200 条可以显著扩大可选范围，
 * 同时避免极端会话数量下向渲染进程传输过大列表。
 */
const MAX_SESSION_REFERENCE_LIMIT = 200

/** 全局 Agent 会话正文搜索的结果预算。 */
const MAX_SEARCH_SESSIONS = 100
const MAX_SEARCH_HITS_PER_SESSION = 2

/**
 * 会话引用的正文搜索是输入框补全路径，必须有独立 I/O 预算。
 * 标题检索仍覆盖全部会话；仅正文 JSONL 检索优先服务最近会话。
 */
const MAX_SESSION_REFERENCE_BODY_SCANS = 50
const MAX_SESSION_REFERENCE_BODY_BYTES_PER_FILE = 256 * 1024

interface JsonlParseError {
  lineNumber: number
  message: string
}

/**
 * 逐行解析 JSONL，调用方按业务场景决定容错或严格失败。
 */
function parseJsonlLines<T>(lines: string[]): { records: T[]; errors: JsonlParseError[] } {
  const records: T[] = []
  const errors: JsonlParseError[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]!) as T)
    } catch (err) {
      errors.push({
        lineNumber: i + 1,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { records, errors }
}

/**
 * 展示/检索类读取：跳过损坏行，保留其它可读消息。
 */
function parseJsonlLenient<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  for (const error of errors) {
    console.warn(`[Agent 会话] ${context} — JSONL 第 ${error.lineNumber} 行解析失败，已跳过:`, error.message)
  }
  return records
}

/**
 * 回退/文件恢复类读取：任何损坏行都可能破坏消息顺序或快照完整性，必须停止。
 */
function parseJsonlStrict<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new Error(`${context} 失败：JSONL 第 ${first.lineNumber} 行解析失败: ${first.message}`)
  }
  return records
}

function normalizePersistedSDKMessage(parsed: unknown): SDKMessage {
  // 旧格式检测：AgentMessage 有 `role` 字段，SDKMessage 有 `type` 字段
  if (parsed && typeof parsed === 'object' && 'role' in parsed && !('type' in parsed)) {
    return convertLegacyMessage(parsed as AgentMessage)
  }
  return parsed as SDKMessage
}

function migrateLegacyPermissionMode(index: AgentSessionsIndex): boolean {
  let changed = false
  for (const session of index.sessions) {
    const rawMode = session.permissionMode as string | undefined
    if (!rawMode) continue
    const nextMode = migratePermissionMode(rawMode)
    if (nextMode !== rawMode) {
      session.permissionMode = nextMode
      changed = true
    }
  }
  return changed
}

/**
 * 在此版本前，所有新建 OpenAI Agent 会话都会写入 off，无法与用户主动关闭区分。
 * 因此仅执行一次历史升级；之后用户手动关闭会保留 off。
 */
function migrateLegacyOpenAIThinkingDefault(index: AgentSessionsIndex): boolean {
  if (index.openAIThinkingDefaultEnabledMigrationCompleted) return false

  for (const session of index.sessions) {
    if (session.openAIThinkingLevel === 'off') {
      session.openAIThinkingLevel = 'high'
    }
  }
  index.openAIThinkingDefaultEnabledMigrationCompleted = true
  return true
}

/**
 * Claude runtime 已退役。历史 transcript 仍由 Proma JSONL 展示，但 Claude session
 * artifact 不能交给 Pi SessionManager 恢复，否则会被误识别为 Pi JSONL。
 */
function migrateRetiredClaudeRuntime(index: AgentSessionsIndex): boolean {
  let changed = false
  const treatMissingRuntimeAsLegacy = index.version < INDEX_VERSION
  for (const session of index.sessions) {
    const raw = session as AgentSessionMeta & { agentRuntime?: unknown }
    const runtime = raw.agentRuntime

    // Pi records written by the previous dual-runtime version keep their artifact.
    if (runtime === 'pi') {
      delete raw.agentRuntime
      changed = true
      continue
    }
    if (session.legacyTranscript?.sourceRuntime === 'claude') continue
    // New Pi-only records intentionally have no runtime field. Only pre-v2 absence means
    // legacy Claude, whose artifacts are not interoperable with Pi.
    if (runtime === undefined && !treatMissingRuntimeAsLegacy) continue

    session.legacyTranscript = { sourceRuntime: 'claude', continuationRequired: true }
    delete raw.agentRuntime
    session.sdkSessionId = undefined
    session.piSessionFile = undefined
    session.piEntryBindings = undefined
    delete (raw as { forkSourceSdkSessionId?: unknown }).forkSourceSdkSessionId
    delete (raw as { resumeAtMessageUuid?: unknown }).resumeAtMessageUuid
    changed = true
  }
  return changed
}

/**
 * 会话索引的内存缓存。
 *
 * 重度使用后索引可达数 MB（实测 3600 个会话约 6.4MB），单次 JSON.parse 约 11ms。
 * 一轮 Agent 会多次读写索引，累计上百毫秒全部同步阻塞主进程，而键盘事件需要经主进程
 * IPC 转发到 renderer，因此表现为“renderer 内无长任务但输入延迟尖尖”。
 * 用 mtime+size 校验缓存：既避免重复解析，也允许测试与外部直接改写索引文件后被正确感知。
 */
let indexCache: { data: AgentSessionsIndex; mtimeMs: number; size: number } | null = null

/** 按当前索引文件状态记录缓存；stat 失败时丢弃缓存而不是保留可疑数据。 */
function cacheIndex(data: AgentSessionsIndex): void {
  try {
    const stat = statSync(getAgentSessionsIndexPath())
    indexCache = { data, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    indexCache = null
  }
}

/**
 * 读取会话索引文件
 */
function readIndex(): AgentSessionsIndex {
  const indexPath = getAgentSessionsIndexPath()

  if (indexCache) {
    try {
      const stat = statSync(indexPath)
      if (indexCache.mtimeMs === stat.mtimeMs && indexCache.size === stat.size) {
        return indexCache.data
      }
    } catch {
      indexCache = null
    }
  }

  const data = readJsonFileSafe<AgentSessionsIndex>(indexPath)
  if (data) {
    const permissionModeMigrated = migrateLegacyPermissionMode(data)
    const thinkingDefaultMigrated = migrateLegacyOpenAIThinkingDefault(data)
    const retiredClaudeRuntimeMigrated = migrateRetiredClaudeRuntime(data)
    if (permissionModeMigrated || thinkingDefaultMigrated || retiredClaudeRuntimeMigrated || data.version < INDEX_VERSION) {
      data.version = INDEX_VERSION
      // writeIndex 会按写入后的文件状态刷新缓存。
      writeIndex(data)
      if (permissionModeMigrated) {
        console.log('[Agent 会话] 已迁移历史权限模式 auto → bypassPermissions')
      }
      if (thinkingDefaultMigrated) {
        console.log('[Agent 会话] 已将历史 OpenAI 会话的思考深度默认值升级为高')
      }
      if (retiredClaudeRuntimeMigrated) {
        console.log('[Agent 会话] 已将历史 Claude 会话迁移为 Pi transcript-only 会话')
      }
    } else {
      cacheIndex(data)
    }
    return data
  }
  return {
    version: INDEX_VERSION,
    sessions: [],
    openAIThinkingDefaultEnabledMigrationCompleted: true,
  }
}

/**
 * 写入会话索引文件
 */
function writeIndex(index: AgentSessionsIndex): void {
  const indexPath = getAgentSessionsIndexPath()

  try {
    writeJsonFileAtomic(indexPath, index)
    cacheIndex(index)
  } catch (error) {
    console.error('[Agent 会话] 写入索引文件失败:', error)
    throw new Error('写入 Agent 会话索引失败')
  }
}

/** 按最近更新时间排序会话副本，避免修改索引数组本身。 */
function sortSessionsByUpdatedAtDesc(sessions: AgentSessionMeta[]): AgentSessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 获取所有会话（按 updatedAt 降序） */
export function listAgentSessions(): AgentSessionMeta[] {
  const index = readIndex()
  return sortSessionsByUpdatedAtDesc(index.sessions)
}

/** 获取未归档会话，供侧栏 active 视图按需读取。 */
export function listActiveAgentSessions(): AgentSessionMeta[] {
  const index = readIndex()
  return sortSessionsByUpdatedAtDesc(index.sessions.filter((session) => !session.archived))
}

/** 获取归档会话，只有用户进入归档视图时才调用。 */
export function listArchivedAgentSessions(): AgentSessionMeta[] {
  const index = readIndex()
  return sortSessionsByUpdatedAtDesc(index.sessions.filter((session) => session.archived && !session.isDraft))
}

/** 获取归档数量，不把归档会话元数据传到 renderer。 */
export function countArchivedAgentSessions(): number {
  const index = readIndex()
  return index.sessions.reduce((count, session) => count + (session.archived && !session.isDraft ? 1 : 0), 0)
}

/**
 * 获取单个会话的元数据
 */
export function getAgentSessionMeta(id: string): AgentSessionMeta | undefined {
  const index = readIndex()
  return index.sessions.find((s) => s.id === id)
}

/** 缺少标记的存量会话必须保持升级前的私有 workbench cwd。 */
export function getAgentCwdMode(meta?: Pick<AgentSessionMeta, 'agentCwdMode'>): AgentCwdMode {
  return meta?.agentCwdMode ?? 'session'
}

/** 只接受仍存在的绝对目录；Git 归属校验由调用主进程在启动 Agent 前完成。 */
export function getActiveWorktreePath(
  meta?: Pick<AgentSessionMeta, 'activeWorktree'>,
): string | undefined {
  const activeWorktree = meta?.activeWorktree
  if (!activeWorktree?.path || !isAbsolute(activeWorktree.path)) return undefined
  try {
    return statSync(activeWorktree.path).isDirectory() ? activeWorktree.path : undefined
  } catch {
    return undefined
  }
}

/** 缺少标记的历史会话继续使用 `.context/`，避免失效的计划和工具历史路径。 */
export function getSessionWorkbenchLayout(
  meta?: Pick<AgentSessionMeta, 'sessionWorkbenchLayout'>,
): SessionWorkbenchLayout {
  return meta?.sessionWorkbenchLayout ?? 'legacy-context'
}

/** 会话私有资料目录；新布局直接使用 workbench 根，旧布局保留 `.context/`。 */
export function resolveSessionWorkbenchContextDir(
  workspace: Pick<AgentWorkspace, 'slug'> | undefined,
  sessionId: string,
  layout?: SessionWorkbenchLayout,
): string | undefined {
  if (!workspace) return undefined
  const sessionDir = getAgentSessionWorkspacePath(workspace.slug, sessionId)
  return layout === 'root' ? sessionDir : join(sessionDir, '.context')
}

/** Agent 运行 cwd 与 Proma 会话 sidecar 工作台目录解析。 */
export function resolveAgentCwd(
  workspace: Pick<AgentWorkspace, 'slug'> | undefined,
  sessionId: string,
  agentCwdMode?: AgentCwdMode,
  activeWorktree?: AgentActiveWorktree,
): string | undefined {
  if (!workspace) return undefined
  const activeWorktreePath = getActiveWorktreePath({ activeWorktree })
  if (activeWorktreePath) return activeWorktreePath
  return getAgentCwdMode({ agentCwdMode }) === 'project'
    ? getProjectFilesPath(workspace.slug)
    : getAgentSessionWorkspacePath(workspace.slug, sessionId)
}

export function resolveAgentWorkbenchDir(
  workspace: Pick<AgentWorkspace, 'slug' | 'projectRootPath'> | undefined,
  sessionId: string,
): string | undefined {
  if (!workspace) return undefined
  return getAgentSessionWorkspacePath(workspace.slug, sessionId)
}

/**
 * 创建新会话
 */
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
  modelId?: string,
  agentCwdMode?: AgentCwdMode,
  sessionWorkbenchLayout?: SessionWorkbenchLayout,
  isDraft?: boolean,
): AgentSessionMeta {
  const index = readIndex()
  const now = Date.now()

  const settings = getSettings()
  const defaultThinkingLevel = settings.defaultOpenAIThinkingLevel
    ?? resolvePiThinkingLevel(settings, undefined, 'openai-codex')
  const meta: AgentSessionMeta = {
    id: randomUUID(),
    title: title || '新 Agent 会话',
    channelId,
    modelId,
    workspaceId,
    agentCwdMode: workspaceId ? agentCwdMode ?? 'project' : undefined,
    sessionWorkbenchLayout: workspaceId ? sessionWorkbenchLayout ?? 'root' : undefined,
    // 仅由会话入口显式创建的临时输入会话设置；必须跨重启保留。
    isDraft: isDraft || undefined,
    // 新会话继承已持久化的全局思考偏好，之后仍可按会话单独调整。
    reasoningLevel: defaultThinkingLevel,
    createdAt: now,
    updatedAt: now,
  }

  index.sessions.push(meta)
  writeIndex(index)

  // 确保消息目录存在
  getAgentSessionsDir()

  // 若有工作区，创建 session 级别子文件夹和 Proma 工作台目录。
  if (workspaceId) {
    const ws = getAgentWorkspace(workspaceId)
    if (ws) {
      // sessionDir 已由 getAgentSessionWorkspacePath 创建。新会话将私有资料直接
      // 放在 workbench 根；计划和附件目录按需创建，避免每个会话都有空 `.context/`。
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
    return parseJsonlLenient<AgentMessage>(lines, `读取会话消息 (${id})`)
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

/** 单条 SDKMessage 序列化后最大长度（UTF-16 code units，超出则截断内容） */
const MAX_SDK_MESSAGE_LENGTH = 256 * 1024 // ~256K chars
/** 截断后保留的预览文本长度 */
const TRUNCATED_PREVIEW_LENGTH = 2000

/**
 * 追加 SDKMessage 到会话的 JSONL 文件（Phase 4 新持久化格式）
 *
 * 每条 SDKMessage 单独一行 JSON。读取时通过 `type` 字段区分新旧格式。
 * 超过 256K chars 的消息会被自动截断以防止存储膨胀。
 */
export function appendSDKMessages(id: string, messages: SDKMessage[]): void {
  if (messages.length === 0) return

  const filePath = getAgentSessionMessagesPath(id)

  try {
    // 整批只做一次同步追写：逐条 appendFileSync 会为每条消息各做一次 open/write/close，
    // 一轮输出常见几十条消息，在多 Agent 并发下会持续阶段性阻塞主进程，
    // 进而延迟键盘事件的 IPC 转发（表现为 renderer 内无长任务但输入延迟高）。
    let payload = ''
    for (const message of messages) {
      payload += serializeSDKMessageForStorage(message) + '\n'
    }
    appendFileSync(filePath, payload, 'utf-8')
  } catch (error) {
    console.error(`[Agent 会话] 追加 SDKMessage 失败 (${id}):`, error)
    throw new Error('追加 SDKMessage 失败')
  }
}

/**
 * 截断超大 SDKMessage 的内容，保留元数据结构。
 * 处理三类膨胀源：超长 text block、超大 tool_result、内嵌 base64 图片。
 */
function sanitizeOversizedMessage(msg: SDKMessage, originalLength: number): SDKMessage {
  const truncationNote = `\n[内容已截断: 原始 ${(originalLength / 1024).toFixed(0)}K chars 超出存储限制]`
  const truncationThreshold = MAX_SDK_MESSAGE_LENGTH / 2

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone: any = JSON.parse(JSON.stringify(msg))
  const content = clone.message?.content
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const block = content[i]
      if (!block || typeof block !== 'object') continue

      // 截断超长 text block
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > truncationThreshold) {
        block.text = block.text.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
      }

      // 截断超大 tool_result
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string' && block.content.length > truncationThreshold) {
          block.content = block.content.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
        }
        // 剥离 base64 图片数据
        if (Array.isArray(block.content)) {
          block.content = block.content.map((item: Record<string, unknown>) => {
            if (item?.type === 'image' && (item.source as Record<string, unknown>)?.data) {
              const dataLen = String((item.source as Record<string, unknown>).data).length
              return { type: 'image', _truncated: true, _originalLength: dataLen }
            }
            return item
          })
        }
      }
    }
  }

  // 截断 error.message
  if (clone.error && typeof clone.error === 'object' && typeof clone.error.message === 'string' && clone.error.message.length > truncationThreshold) {
    clone.error.message = clone.error.message.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
  }

  return clone as SDKMessage
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
    return parseJsonlLenient<unknown>(lines, `读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  } catch (error) {
    console.error(`[Agent 会话] 读取 SDKMessage 失败 (${id}):`, error)
    return []
  }
}

/**
 * convertLegacyMessage 已迁移至 @proma/session-core（本文件从该包 import 使用）。
 */

/**
 * 更新会话元数据
 */
export function updateAgentSessionMeta(
  id: string,
  updates: Partial<Pick<AgentSessionMeta, 'title' | 'channelId' | 'modelId' | 'sdkSessionId' | 'piSessionFile' | 'piEntryBindings' | 'codexFastMode' | 'reasoningLevel' | 'openAIThinkingLevel' | 'workspaceId' | 'activeWorktree' | 'pinned' | 'starred' | 'archived' | 'isDraft' | 'attachedDirectories' | 'attachedFiles' | 'forkSourceDir' | 'explorationParentSessionId' | 'explorationSourceMessageId' | 'explorationSourceLabel' | 'explorationTitleInitializedAt' | 'stoppedByUser' | 'permissionMode' | 'completedButUnconfirmed' | 'sourceAutomationId' | 'automationGraduated' | 'parentSessionId' | 'rootSessionId' | 'sourceDelegationId' | 'delegationRole' | 'delegationStatus' | 'delegationDepth' | 'delegationGoal'>>,
): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const existing = index.sessions[idx]!
  const updateKeys = Object.keys(updates)
  // 星标只是侧栏的视觉标记，不应改变会话的新鲜度或归档状态。
  const isStarredOnly = updateKeys.every((key) => key === 'starred')
  // 非手动归档操作时，若会话已归档则自动恢复为活跃（仅更新 stoppedByUser 或 starred 不触发解归档）
  const isStoppedByUserOnly = updateKeys.every((key) => key === 'stoppedByUser')
  const autoUnarchive = existing.archived && !('archived' in updates) && !isStoppedByUserOnly && !isStarredOnly
  const updated: AgentSessionMeta = {
    ...existing,
    ...updates,
    ...(autoUnarchive ? { archived: false } : {}),
    updatedAt: isStarredOnly ? existing.updatedAt : Date.now(),
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
    console.warn(`[Agent 会话] 会话不存在，跳过删除: ${id}`)
    return
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
          rmSyncWithRetry(sessionDir, { recursive: true, force: true })
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
 * 收集会话及其全部委派子会话。
 */
function collectSessionTreeIds(sessions: AgentSessionMeta[], sessionId: string): Set<string> {
  const ids = new Set<string>([sessionId])
  let changed = true

  while (changed) {
    changed = false
    for (const session of sessions) {
      if (ids.has(session.id)) continue
      // 仅收集协作委派子会话。parent/root 负责维护树结构，sourceDelegationId 负责限定来源。
      if (!session.sourceDelegationId) continue
      if (session.parentSessionId && ids.has(session.parentSessionId)) {
        ids.add(session.id)
        changed = true
        continue
      }
      if (session.rootSessionId === sessionId) {
        ids.add(session.id)
        changed = true
      }
    }
  }

  return ids
}

function moveSessionWorkspaceDir(session: AgentSessionMeta, targetWorkspaceSlug: string): void {
  if (!session.workspaceId) return

  const sourceWs = getAgentWorkspace(session.workspaceId)
  if (!sourceWs || sourceWs.slug === targetWorkspaceSlug) return

  const srcDir = join(getAgentWorkspacePath(sourceWs.slug), session.id)
  if (!existsSync(srcDir)) return

  const destDir = join(getAgentWorkspacePath(targetWorkspaceSlug), session.id)
  // 清理已存在的目标目录，防止 renameSync 抛出 ENOTEMPTY/EEXIST。
  if (existsSync(destDir)) {
    try {
      const contents = readdirSync(destDir)
      rmSyncWithRetry(destDir, { recursive: true, force: true })
      const reason = contents.length === 0 ? '空目标目录' : '非空目标目录（以源目录为准）'
      console.log(`[Agent 会话] 已清理${reason}: ${destDir}`)
    } catch (cleanupError) {
      console.warn('[Agent 会话] 清理目标目录失败，跳过目录迁移:', cleanupError)
      throw cleanupError
    }
  }

  // renameWithRetry：优先 renameSync（原子），跨设备或句柄占用时自动降级 cpSync + rmSyncWithRetry。
  renameWithRetry(srcDir, destDir)
  console.log(`[Agent 会话] 已移动工作目录: ${srcDir} → ${destDir}`)
}

/**
 * 迁移 Agent 会话到另一个工作区
 *
 * 操作步骤：
 * 1. 验证会话和目标工作区存在
 * 2. 收集目标会话及其委派子会话
 * 3. 移动会话工作目录到目标工作区
 * 4. 更新元数据，并清空与旧 cwd 绑定的 Pi artifact / entry bindings
 * 5. JSONL 消息文件保持原位（全局目录）
 */
export function moveSessionToWorkspace(sessionId: string, targetWorkspaceId: string): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${sessionId}`)
  }

  const session = index.sessions[idx]!

  const targetWs = getAgentWorkspace(targetWorkspaceId)
  if (!targetWs) {
    throw new Error(`目标项目不存在: ${targetWorkspaceId}`)
  }

  const sessionTreeIds = collectSessionTreeIds(index.sessions, sessionId)
  const sessionsToMove = index.sessions.filter((item) => sessionTreeIds.has(item.id) && item.workspaceId !== targetWorkspaceId)
  if (sessionsToMove.length === 0) return session

  const now = Date.now()
  let updatedRoot = session
  let movedCount = 0

  for (let i = 0; i < index.sessions.length; i++) {
    const current = index.sessions[i]!
    if (!sessionTreeIds.has(current.id) || current.workspaceId === targetWorkspaceId) continue

    moveSessionWorkspaceDir(current, targetWs.slug)
    // 确保目标工作区下有 session 目录。
    getAgentSessionWorkspacePath(targetWs.slug, current.id)

    const updated: AgentSessionMeta = {
      ...current,
      workspaceId: targetWorkspaceId,
      // Pi artifact 与 entry bindings 都以原 cwd 为根；跨工作区复用会造成错误 resume/fork/rewind。
      sdkSessionId: undefined,
      piSessionFile: undefined,
      piEntryBindings: undefined,
      // 已切换到另一项目，不能沿用旧项目授权下选择的 worktree。
      activeWorktree: undefined,
      updatedAt: now,
    }
    index.sessions[i] = updated
    writeIndex(index)
    movedCount++
    if (current.id === sessionId) {
      updatedRoot = updated
    }
  }

  console.log(`[Agent 会话] 已迁移会话及子会话到工作区: ${updatedRoot.title}（${movedCount} 个）→ ${targetWs.name}`)
  return updatedRoot
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
 * 分叉 Pi Agent 会话。
 *
 * 退役 Claude transcript 仅可阅读，不能映射为 Pi session artifact 后续执行。
 */
export async function forkAgentSession(input: ForkSessionInput): Promise<AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) throw new Error(`源 Agent 会话不存在: ${input.sessionId}`)
  if (sourceMeta.legacyTranscript) {
    throw new Error('历史 Claude transcript 为只读，不能分叉；请新建 Pi 会话继续')
  }
  return forkPiAgentSession(sourceMeta, input)
}

/**
 * Pi 的 session 是 append-only tree。分叉必须由 SessionManager 导出目标 branch，
 * 不能只复制 Proma 的展示 JSONL，否则下一轮 resume 仍会看到被截断的上下文。
 */
async function forkPiAgentSession(sourceMeta: AgentSessionMeta, input: ForkSessionInput): Promise<AgentSessionMeta> {
  const targetUuid = input.upToMessageUuid
  if (!targetUuid) throw new Error('Pi 分叉需要指定一条已完成的 assistant 消息')
  const entryId = sourceMeta.piEntryBindings?.[targetUuid]
  if (!entryId) throw new Error('该 Pi 历史消息尚无 entry ID 映射，无法安全分叉；请在新版 Proma 中继续一次对话后再试')
  if (!sourceMeta.piSessionFile || !existsSync(sourceMeta.piSessionFile)) {
    throw new Error('未找到 Pi session artifact，无法安全分叉')
  }

  const forkModelId = input.modelId !== undefined
    ? assertEnabledModelForChannel({ channelId: sourceMeta.channelId, modelId: input.modelId, purpose: '分叉 Pi Agent 会话' })
    : sourceMeta.modelId
  const workspace = sourceMeta.workspaceId ? getAgentWorkspace(sourceMeta.workspaceId) : undefined
  const sourceCwdMode = getAgentCwdMode(sourceMeta)
  const sourceWorkbenchLayout = getSessionWorkbenchLayout(sourceMeta)
  const sourceActiveWorktree = getActiveWorktreePath(sourceMeta) ? sourceMeta.activeWorktree : undefined
  const sourceDir = resolveAgentCwd(workspace, sourceMeta.id, sourceCwdMode, sourceActiveWorktree)
  const sourceWorkbenchDir = resolveAgentWorkbenchDir(workspace, sourceMeta.id)
  const newMeta = createAgentSession(
    `${sourceMeta.title} (fork)`,
    sourceMeta.channelId,
    sourceMeta.workspaceId,
    forkModelId,
    sourceCwdMode,
    sourceWorkbenchLayout,
  )
  const destDir = resolveAgentCwd(workspace, newMeta.id, newMeta.agentCwdMode, sourceActiveWorktree)
  const destWorkbenchDir = resolveAgentWorkbenchDir(workspace, newMeta.id)

  try {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const sessionDir = join(getSdkConfigDir(), 'sessions')
    const sourceManager = sdk.SessionManager.open(sourceMeta.piSessionFile, sessionDir, sourceDir)
    const branchFile = sourceManager.createBranchedSession(entryId)
    if (!branchFile || !existsSync(branchFile)) {
      throw new Error('Pi 未能生成分叉 session artifact')
    }
    const forkedManager = sdk.SessionManager.forkFrom(branchFile, destDir ?? sourceDir ?? process.cwd(), sessionDir)
    const piSessionFile = forkedManager.getSessionFile()
    if (!piSessionFile || !existsSync(piSessionFile)) throw new Error('Pi 分叉 artifact 校验失败')
    // 新 branch 只包含分叉点之前的 entry；不能把源树后续 turn 的映射带入 metadata。
    const branchBindings = Object.fromEntries(
      Object.entries(sourceMeta.piEntryBindings ?? {})
        .filter(([, mappedEntryId]) => Boolean(forkedManager.getEntry(mappedEntryId))),
    )

    const explorationMeta = input.explorationSourceLabel ? {
      explorationParentSessionId: sourceMeta.id,
      explorationSourceMessageId: targetUuid,
      explorationSourceLabel: input.explorationSourceLabel,
    } : {}
    updateAgentSessionMeta(newMeta.id, {
      sdkSessionId: forkedManager.getSessionId(),
      piSessionFile,
      piEntryBindings: branchBindings,
      activeWorktree: sourceActiveWorktree,
      forkSourceDir: sourceDir,
      ...explorationMeta,
    })
    newMeta.sdkSessionId = forkedManager.getSessionId()
    newMeta.piSessionFile = piSessionFile
    newMeta.piEntryBindings = branchBindings
    newMeta.activeWorktree = sourceActiveWorktree
    Object.assign(newMeta, explorationMeta)

    if (sourceWorkbenchDir && destWorkbenchDir) copyForkWorkspaceFiles(sourceWorkbenchDir, destWorkbenchDir)
    await copyForkStoredSDKMessages({
      sourceSessionId: sourceMeta.id,
      destSessionId: newMeta.id,
      upToMessageUuid: targetUuid,
      sourceDir,
      destDir,
    })
    return newMeta
  } catch (error) {
    // 尚未对外返回的新 session 可安全清理，避免留下会被侧栏打开的半成品。
    try { deleteAgentSession(newMeta.id) } catch { /* 保留原始错误 */ }
    throw error
  }
}

/**
 * 将当前 Pi 会话切换到指定 assistant turn 的新 branch artifact（持久化回退）。
 *
 * Proma JSONL 和 Pi branch artifact 是两个事实源：先完整校验 JSONL，再创建 branch；
 * JSONL 写入成功后才提交 metadata。metadata 写入失败时会恢复原 JSONL，避免两边分叉。
 */
export async function rewindPiAgentSession(sessionId: string, assistantMessageUuid: string): Promise<number> {
  const meta = getAgentSessionMeta(sessionId)
  if (!meta) throw new Error('Agent 会话不存在')
  if (meta.legacyTranscript) throw new Error('历史 Claude transcript 为只读，不能回退；请新建 Pi 会话继续')
  const entryId = meta.piEntryBindings?.[assistantMessageUuid]
  if (!entryId) throw new Error('该 Pi 历史消息尚无 entry ID 映射，无法安全回退')
  if (!meta.piSessionFile || !existsSync(meta.piSessionFile)) throw new Error('未找到 Pi session artifact，无法安全回退')

  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) throw new Error(`[Agent 会话] 截断失败: 会话消息文件不存在, sessionId=${sessionId}`)
  const originalContent = readFileSync(filePath, 'utf-8')
  const originalMessages = parseJsonlStrict<unknown>(originalContent.split('\n').filter((line) => line.trim()), `截断读取 SDKMessage (${sessionId})`).map(normalizePersistedSDKMessage)
  const cutIndex = originalMessages.findIndex((message) => 'uuid' in message && (message as { uuid?: string }).uuid === assistantMessageUuid)
  if (cutIndex < 0) throw new Error(`[Agent 会话] 截断失败: 未找到 uuid=${assistantMessageUuid}, sessionId=${sessionId}`)
  const kept = originalMessages.slice(0, cutIndex + 1)
  const truncatedContent = kept.map((message) => JSON.stringify(message)).join('\n') + (kept.length > 0 ? '\n' : '')

  const workspace = meta.workspaceId ? getAgentWorkspace(meta.workspaceId) : undefined
  const cwd = resolveAgentCwd(workspace, meta.id, meta.agentCwdMode, meta.activeWorktree) ?? process.cwd()
  const sdk = await import('@earendil-works/pi-coding-agent')
  const manager = sdk.SessionManager.open(meta.piSessionFile, join(getSdkConfigDir(), 'sessions'), cwd)
  const branchFile = manager.createBranchedSession(entryId)
  if (!branchFile || !existsSync(branchFile)) throw new Error('Pi 未能生成回退 session artifact')
  const rewindManager = sdk.SessionManager.open(branchFile, join(getSdkConfigDir(), 'sessions'), cwd)
  const retainedAssistantUuids = new Set(
    kept.flatMap((message) => {
      const candidate = message as { uuid?: unknown; type?: unknown }
      return candidate.type === 'assistant' && typeof candidate.uuid === 'string' ? [candidate.uuid] : []
    }),
  )
  const retainedBindings = Object.fromEntries(
    Object.entries(meta.piEntryBindings ?? {}).filter(([messageUuid, mappedEntryId]) =>
      retainedAssistantUuids.has(messageUuid) && Boolean(rewindManager.getEntry(mappedEntryId))),
  )

  writeTextFileAtomic(filePath, truncatedContent)
  try {
    updateAgentSessionMeta(sessionId, {
      sdkSessionId: rewindManager.getSessionId(),
      piSessionFile: branchFile,
      piEntryBindings: retainedBindings,
    })
  } catch (error) {
    try { writeTextFileAtomic(filePath, originalContent) } catch { /* 保留原始 metadata 错误 */ }
    throw error
  }

  console.log(`[Agent 会话] Pi 会话已回退: sessionId=${sessionId}, 保留 ${kept.length}/${originalMessages.length} 条`)
  return kept.length
}

interface CopyForkStoredSDKMessagesInput {
  sourceSessionId: string
  destSessionId: string
  upToMessageUuid?: string
  sourceDir?: string
  destDir?: string
}

async function copyForkStoredSDKMessages({
  sourceSessionId,
  destSessionId,
  upToMessageUuid,
  sourceDir,
  destDir,
}: CopyForkStoredSDKMessagesInput): Promise<number> {
  const sourcePath = getAgentSessionMessagesPath(sourceSessionId)
  if (!existsSync(sourcePath)) return 0

  const destPath = getAgentSessionMessagesPath(destSessionId)
  const out = createWriteStream(destPath, { flags: 'a', encoding: 'utf-8' })
  let copiedCount = 0

  try {
    for await (const msg of readStoredSDKMessages(sourcePath)) {
      await writeJsonlLine(out, serializeSDKMessageForStorage(msg, sourceDir, destDir))
      copiedCount += 1

      if (upToMessageUuid && getStoredMessageUuid(msg) === upToMessageUuid) {
        break
      }
    }
    await endWriteStream(out)
  } catch (err) {
    out.destroy()
    throw err
  }

  return copiedCount
}

async function* readStoredSDKMessages(filePath: string): AsyncGenerator<SDKMessage> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if ('role' in parsed && !('type' in parsed)) {
        yield convertLegacyMessage(parsed as AgentMessage)
      } else {
        yield parsed as SDKMessage
      }
    } catch (err) {
      console.warn(`[Agent 会话] 跳过无法解析的 SDKMessage 行 (${filePath}):`, err)
    }
  }
}

function getStoredMessageUuid(msg: SDKMessage): string | undefined {
  return 'uuid' in msg ? (msg as { uuid?: string }).uuid : undefined
}

function serializeSDKMessageForStorage(
  msg: SDKMessage,
  sourceDir?: string,
  destDir?: string,
): string {
  let serialized = JSON.stringify(msg)
  if (sourceDir && destDir) {
    serialized = rewriteSourceToDest(serialized, sourceDir, destDir)
  }
  if (serialized.length <= MAX_SDK_MESSAGE_LENGTH) return serialized

  let sanitized = JSON.stringify(sanitizeOversizedMessage(msg, serialized.length))
  if (sourceDir && destDir) {
    sanitized = rewriteSourceToDest(sanitized, sourceDir, destDir)
  }
  if (sanitized.length > MAX_SDK_MESSAGE_LENGTH) {
    console.warn(`[Agent 会话] 消息截断后仍超限 (${(sanitized.length / 1024).toFixed(0)}K chars)`)
  }
  return sanitized
}

async function writeJsonlLine(stream: WriteStream, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(line + '\n', (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function endWriteStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

/**
 * 将一段字符串中所有出现的 sourceDir 替换为 destDir。
 *
 * 用于 fork 会话时把历史中嵌入的源会话绝对路径迁移到新会话目录。
 * 处理 JSON 字符串中可能出现的两种编码形式：
 * 1. 原始路径（如 /Users/a/b）
 * 2. JSON 字符串编码后的形式（路径中的 `/` JSON 标准下不会转义，所以通常与 1 一致；
 *    但保留对反斜杠的处理以兼容 Windows 路径）
 *
 * sourceDir 和 destDir 都会规范化去除末尾斜杠，避免不同形式导致漏替换。
 */
function rewriteSourceToDest(content: string, sourceDir: string, destDir: string): string {
  const normalizedSource = sourceDir.replace(/[\\/]+$/, '')
  const normalizedDest = destDir.replace(/[\\/]+$/, '')
  if (!normalizedSource || normalizedSource === normalizedDest) return content
  let rewritten = content.split(normalizedSource).join(normalizedDest)
  // Windows 路径在 JSON 中会被转义为双反斜杠，单独处理一次
  if (normalizedSource.includes('\\')) {
    const sourceEscaped = normalizedSource.replace(/\\/g, '\\\\')
    const destEscaped = normalizedDest.replace(/\\/g, '\\\\')
    rewritten = rewritten.split(sourceEscaped).join(destEscaped)
  }
  return rewritten
}

/**
 * 截断 Agent 会话的 SDK 消息到指定 UUID（inclusive）
 *
 * 保留 uuid 匹配消息及之前的所有消息，删除之后的消息。
 * 通过原子替换全量重写 JSONL 文件。
 *
 * @returns 截断后保留的消息列表
 */
export function truncateSDKMessages(id: string, upToUuidInclusive: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) {
    throw new Error(`[Agent 会话] 截断失败: 会话消息文件不存在, sessionId=${id}`)
  }

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `截断读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  const cutIndex = messages.findIndex(
    (m) => 'uuid' in m && (m as { uuid?: string }).uuid === upToUuidInclusive,
  )
  if (cutIndex < 0) {
    throw new Error(`[Agent 会话] 截断失败: 未找到 uuid=${upToUuidInclusive}, sessionId=${id}`)
  }
  const kept = messages.slice(0, cutIndex + 1)

  const content = kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)

  console.log(`[Agent 会话] 消息已截断: sessionId=${id}, 保留 ${kept.length}/${messages.length} 条`)
  return kept
}

/**
 * 删除指定 UUID 的持久化错误消息。
 *
 * 仅删除 assistant error，避免调用方误删普通回复；找不到时保持幂等。
 */
export function removeSDKErrorMessage(id: string, errorUuid: string): boolean {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return false

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `删除错误消息 (${id})`).map(normalizePersistedSDKMessage)
  const targetIndex = messages.findIndex((message) =>
    message.type === 'assistant'
      && (message as { uuid?: string }).uuid === errorUuid
      && Boolean((message as { error?: unknown }).error),
  )
  if (targetIndex < 0) return false

  const kept = messages.filter((_, index) => index !== targetIndex)
  const content = kept.map((message) => JSON.stringify(message)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)
  console.log(`[Agent 会话] 已删除重试前错误: sessionId=${id}, uuid=${errorUuid}`)
  return true
}

/**
 * Persist successful Skill loading on the human input that Pi actually consumed.
 * This is intentionally a targeted JSONL rewrite: native Pi queues can produce
 * several logical user turns before a single terminal result arrives.
 */
export function updateSDKUserMessageSkillActivations(
  id: string,
  userMessageUuid: string,
  activations: SkillActivation[],
): boolean {
  if (activations.length === 0) return false
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return false

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `更新用户 Skill metadata (${id})`)
    .map(normalizePersistedSDKMessage)
  const targetIndex = messages.findIndex((message) => (
    message.type === 'user'
    && (message as SDKUserMessage).uuid === userMessageUuid
  ))
  if (targetIndex < 0) return false

  const target = messages[targetIndex] as SDKUserMessage
  const merged = mergeSkillActivations(target.skill_activations ?? [], activations)
  if (JSON.stringify(merged) === JSON.stringify(target.skill_activations ?? [])) return true

  messages[targetIndex] = { ...target, skill_activations: merged }
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + '\n'
  writeTextFileAtomic(filePath, content)
  return true
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
    // 草稿没有侧栏入口；自动归档后无法由 Welcome 恢复，会变成不可达记录。
    if (!session.isDraft && !session.pinned && !session.archived && session.updatedAt < threshold) {
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
 * 启动时收敛遗留的委派子会话状态
 *
 * 委派子会话的运行态只在主进程内存中维护，应用退出后无法续跑。
 * 若上次退出时仍有 delegationStatus 为 'running' 的子会话，本次启动需要
 * 把它们标记为 'interrupted'，避免状态永久卡在 running、父会话也无法收敛。
 *
 * @returns 被标记为中断的子会话数量
 */
export function markRunningDelegationsAsInterrupted(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    if (session.sourceDelegationId && session.delegationStatus === 'running') {
      session.delegationStatus = 'interrupted'
      session.updatedAt = Date.now()
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 启动收敛 ${count} 个遗留的运行中委派子会话为 interrupted`)
  }

  return count
}

/**
 * 清理所有会话中不存在的附加目录和附加文件
 * @returns 清理的条目总数
 */
export function cleanupStaleAttachedPaths(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    let changed = false

    if (session.attachedDirectories?.length) {
      const valid = session.attachedDirectories.filter((d) => existsSync(d))
      if (valid.length < session.attachedDirectories.length) {
        count += session.attachedDirectories.length - valid.length
        session.attachedDirectories = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (session.attachedFiles?.length) {
      const valid = session.attachedFiles.filter((f) => existsSync(f))
      if (valid.length < session.attachedFiles.length) {
        count += session.attachedFiles.length - valid.length
        session.attachedFiles = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (changed) {
      session.updatedAt = Date.now()
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 清理了 ${count} 个不存在的附加路径`)
  }

  return count
}

/**
 * 搜索 Agent 会话正文。
 * 每个会话最多返回 2 个用户/助手正文命中，最多返回 100 个命中会话。
 */
export async function searchAgentSessionMessages(query: string): Promise<AgentMessageSearchResult[]> {
  if (!query || query.length < 2) return []

  const index = readIndex()
  const results: AgentMessageSearchResult[] = []
  let matchedSessionCount = 0

  const sortedSessions = [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of sortedSessions) {
    if (matchedSessionCount >= MAX_SEARCH_SESSIONS) break

    const filePath = getAgentSessionMessagesPath(session.id)
    if (!existsSync(filePath)) continue

    const hits = await findMatchesInAgentJsonl(filePath, query)
    if (hits.length === 0) continue
    matchedSessionCount++

    for (const hit of hits.slice(0, MAX_SEARCH_HITS_PER_SESSION)) {
      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        messageId: hit.messageId,
        role: hit.role,
        snippet: hit.snippet,
        matchStart: hit.matchStart,
        matchLength: hit.matchLength,
        archived: session.archived,
      })
    }
  }

  return results
}

interface AgentSearchHit {
  messageId: string
  role: Extract<AgentMessageSearchResult['role'], 'user' | 'assistant'>
  snippet: string
  matchStart: number
  matchLength: number
  score: number
}

/** 在单个 Agent JSONL 中收集用户文本和助手 text block 的命中。 */
async function findMatchesInAgentJsonl(
  filePath: string,
  query: string,
): Promise<AgentSearchHit[]> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const hitsByMessageId = new Map<string, AgentSearchHit>()
  const anonymousHits: AgentSearchHit[] = []

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: {
        role?: string
        id?: string
        uuid?: string
        content?: unknown
        type?: string
        message?: {
          role?: string
          id?: string
          content?: Array<{ type: string; text?: string }>
        }
      }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      let role: AgentSearchHit['role'] | null = null
      let messageId = parsed.id ?? parsed.uuid ?? parsed.message?.id ?? ''
      let textContent = ''

      // 兼容旧 AgentMessage：只接受 user/assistant 的顶层 content。
      if (!parsed.type && typeof parsed.content === 'string') {
        if (parsed.role !== 'user' && parsed.role !== 'assistant') continue
        role = parsed.role
        textContent = parsed.content
      } else if (parsed.type === 'user' || parsed.type === 'assistant') {
        role = parsed.type
        if (Array.isArray(parsed.message?.content)) {
          textContent = parsed.message.content
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text!)
            .join('\n')
        }
      }

      if (!role || !textContent) continue
      const match = findBestSearchMatch(textContent, query)
      if (!match) continue

      const snippetStart = Math.max(0, match.matchStart - 40)
      const snippetEnd = Math.min(textContent.length, match.matchStart + match.matchLength + 40)
      const snippet = (snippetStart > 0 ? '...' : '') +
        textContent.slice(snippetStart, snippetEnd) +
        (snippetEnd < textContent.length ? '...' : '')
      const matchStart = match.matchStart - snippetStart + (snippetStart > 0 ? 3 : 0)
      const hit = { messageId, role, snippet, matchStart, matchLength: match.matchLength, score: match.score }
      if (messageId) {
        const existingHit = hitsByMessageId.get(messageId)
        if (!existingHit) {
          hitsByMessageId.set(messageId, hit)
        } else {
          const bestHit = [existingHit]
          insertTopSearchResult(bestHit, hit, 1)
          hitsByMessageId.set(messageId, bestHit[0]!)
        }
      } else {
        insertTopSearchResult(anonymousHits, hit, MAX_SEARCH_HITS_PER_SESSION)
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  const hits: AgentSearchHit[] = []
  for (const hit of hitsByMessageId.values()) {
    insertTopSearchResult(hits, hit, MAX_SEARCH_HITS_PER_SESSION)
  }
  for (const hit of anonymousHits) {
    insertTopSearchResult(hits, hit, MAX_SEARCH_HITS_PER_SESSION)
  }
  return hits
}

/**
 * 在单个 Agent 会话 JSONL 中按行流式查找第一条匹配。
 *
 * Agent 消息存在两种历史格式（旧 AgentMessage 与新 SDKMessage），都要兼容。
 */
async function findFirstMatchInAgentJsonl(
  filePath: string,
  queryLower: string,
  queryLength: number,
  maxBytes?: number,
): Promise<{ messageId: string; role: AgentMessageSearchResult['role']; snippet: string; matchStart: number } | null> {
  const stream = createReadStream(filePath, {
    encoding: 'utf-8',
    ...(maxBytes ? { end: maxBytes - 1 } : {}),
  })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: {
        role?: string
        id?: string
        uuid?: string
        content?: unknown
        message?: { role?: string; id?: string; content?: Array<{ type: string; text?: string }> }
      }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const rawRole = parsed.role ?? parsed.message?.role ?? 'assistant'
      // 收窄到 AgentMessageSearchResult.role 允许的联合类型；不在白名单的退化为 assistant
      const role: AgentMessageSearchResult['role'] =
        rawRole === 'user' || rawRole === 'assistant' || rawRole === 'tool' || rawRole === 'status'
          ? rawRole
          : 'assistant'
      const messageId = parsed.id ?? parsed.uuid ?? parsed.message?.id ?? ''

      let textContent = ''
      if (typeof parsed.content === 'string') {
        textContent = parsed.content
      } else if (Array.isArray(parsed.message?.content)) {
        textContent = parsed.message.content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('\n')
      }
      if (!textContent) continue

      const contentLower = textContent.toLowerCase()
      const matchIndex = contentLower.indexOf(queryLower)
      if (matchIndex === -1) continue

      const snippetStart = Math.max(0, matchIndex - 40)
      const snippetEnd = Math.min(textContent.length, matchIndex + queryLength + 40)
      const snippet = (snippetStart > 0 ? '...' : '') +
        textContent.slice(snippetStart, snippetEnd) +
        (snippetEnd < textContent.length ? '...' : '')
      const matchStart = matchIndex - snippetStart + (snippetStart > 0 ? 3 : 0)

      return { messageId, role, snippet, matchStart }
    }
    return null
  } finally {
    rl.close()
    stream.destroy()
  }
}

async function findSessionMessageSnippet(
  sessionId: string,
  query: string,
  maxBytes?: number,
): Promise<string | undefined> {
  if (!query || query.length < 2) return undefined

  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) return undefined

  try {
    const hit = await findFirstMatchInAgentJsonl(filePath, query.toLowerCase(), query.length, maxBytes)
    return hit?.snippet
  } catch {
    return undefined
  }
}

function createSessionReferenceSearchResult(
  session: AgentSessionMeta,
  workspacesById: ReadonlyMap<string, { name: string; slug: string }>,
  fields: Pick<AgentSessionReferenceSearchResult, 'matchSource' | 'snippet'>,
): AgentSessionReferenceSearchResult {
  const workspace = session.workspaceId ? workspacesById.get(session.workspaceId) : undefined

  return {
    sessionId: session.id,
    title: session.title,
    ...(workspace ? {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
    } : {}),
    updatedAt: session.updatedAt,
    ...fields,
  }
}

/**
 * 搜索可引用的 Agent 会话。
 *
 * 指定工作区时仅返回该工作区；省略工作区时跨工作区搜索。两种模式都排除已归档和当前会话；无关键词时返回最近更新的会话。
 */
export async function searchAgentSessionReferences(input: AgentSessionReferenceSearchInput): Promise<AgentSessionReferenceSearchResult[]> {
  const workspaceId = input?.workspaceId?.trim()

  const query = (input?.query ?? '').trim()
  const queryLower = query.toLowerCase()
  const requestedLimit = Number.isFinite(input?.limit) ? input.limit! : 20
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_SESSION_REFERENCE_LIMIT)
  const workspacesById = new Map(
    listAgentWorkspaces().map((workspace) => [workspace.id, workspace]),
  )

  const candidates = listAgentSessions()
    .filter((session) => !workspaceId || session.workspaceId === workspaceId)
    .filter((session) => !session.archived)
    .filter((session) => session.id !== input?.excludeSessionId)

  const results: AgentSessionReferenceSearchResult[] = []
  let bodyScanCount = 0

  for (const session of candidates) {
    if (results.length >= limit) break

    if (!queryLower) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        matchSource: 'recent',
      }))
      continue
    }

    if (session.title.toLowerCase().includes(queryLower)) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        matchSource: 'title',
      }))
      continue
    }

    // 即使正文预算耗尽，仍继续遍历，确保较旧但标题命中的会话不会漏掉。
    if (bodyScanCount >= MAX_SESSION_REFERENCE_BODY_SCANS) continue
    bodyScanCount += 1

    const snippet = await findSessionMessageSnippet(
      session.id,
      query,
      MAX_SESSION_REFERENCE_BODY_BYTES_PER_FILE,
    )
    if (snippet) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        snippet,
        matchSource: 'message',
      }))
    }
  }

  return results
}
