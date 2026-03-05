/**
 * Agent Team Reader — 读取 Agent Teams 文件系统数据
 *
 * 职责：
 * - 扫描 ~/.claude/teams/ 查找 team 配置
 * - 读取 ~/.claude/tasks/ 中的任务列表
 * - 读取 agent 收件箱消息
 * - 轮询 inbox 带重试（用于 auto-resume）
 * - 格式化 resume prompt
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type {
  TeamConfig,
  TaskItem,
  ParsedMailboxMessage,
  AgentTeamData,
} from '@proma/shared'

const TEAMS_DIR = join(homedir(), '.claude', 'teams')
const TASKS_DIR = join(homedir(), '.claude', 'tasks')

// ===== 收件箱消息类型 =====

interface InboxMessage {
  from: string
  text: string
  summary?: string
  timestamp?: string
  read?: boolean
}

// ===== Inbox 重试配置 =====

interface InboxRetryConfig {
  maxAttempts: number
  delayMs: number
}

export const INBOX_RETRY_CONFIG: InboxRetryConfig = {
  maxAttempts: 5,
  delayMs: 2000,
}

// ===== 核心函数 =====

/**
 * 通过 SDK sessionId 查找对应的 team 名称和 inbox 路径
 */
export async function findTeamLeadInboxPath(
  sdkSessionId: string,
): Promise<{ teamName: string; inboxPath: string } | null> {
  let teamEntries: string[]
  try {
    teamEntries = await readdir(TEAMS_DIR)
  } catch {
    return null
  }

  for (const teamName of teamEntries) {
    const configPath = join(TEAMS_DIR, teamName, 'config.json')
    try {
      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as { leadSessionId?: string }
      if (config.leadSessionId === sdkSessionId) {
        const inboxPath = join(TEAMS_DIR, teamName, 'inboxes', 'team-lead.json')
        return { teamName, inboxPath }
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * 读取 team-lead 收件箱中未读的消息（排除系统类型）
 */
async function readUnreadTeamLeadMessages(inboxPath: string): Promise<InboxMessage[]> {
  try {
    const raw = await readFile(inboxPath, 'utf-8')
    const messages: InboxMessage[] = JSON.parse(raw)
    return messages.filter((m) => {
      if (m.read) return false
      // 跳过纯系统通知
      try {
        const parsed = JSON.parse(m.text) as Record<string, unknown>
        const t = parsed.type
        if (
          t === 'idle_notification' ||
          t === 'shutdown_request' ||
          t === 'shutdown_approved' ||
          t === 'permission_request'
        ) {
          return false
        }
      } catch {
        // 不是 JSON，保留
      }
      return true
    })
  } catch {
    return []
  }
}

/**
 * 将收件箱中所有消息标记为已读
 */
export async function markInboxAsRead(inboxPath: string): Promise<void> {
  try {
    const raw = await readFile(inboxPath, 'utf-8')
    const messages: InboxMessage[] = JSON.parse(raw)
    const updated = messages.map((m) => ({ ...m, read: true }))
    await writeFile(inboxPath, JSON.stringify(updated, null, 2), 'utf-8')
  } catch {
    // 忽略错误
  }
}

/**
 * 带重试的 inbox 轮询
 *
 * Workers 写入 inbox 有时序延迟，需要多次尝试。
 */
export async function pollInboxWithRetry(
  inboxPath: string,
  config: InboxRetryConfig,
): Promise<InboxMessage[]> {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const messages = await readUnreadTeamLeadMessages(inboxPath)
    if (messages.length > 0) {
      console.log(`[Team Reader] Inbox 轮询 ${attempt}/${config.maxAttempts}: 找到 ${messages.length} 条消息`)
      return messages
    }
    if (attempt < config.maxAttempts) {
      console.log(`[Team Reader] Inbox 轮询 ${attempt}/${config.maxAttempts}: 空，${config.delayMs}ms 后重试`)
      await new Promise<void>((resolve) => setTimeout(resolve, config.delayMs))
    }
  }
  console.log(`[Team Reader] Inbox 轮询: ${config.maxAttempts} 次尝试用尽，仍为空`)
  return []
}

/**
 * 格式化未读收件箱消息，作为 auto-resume 的 prompt
 */
export function formatInboxPrompt(messages: InboxMessage[]): string {
  const sections = messages.map((m) => {
    const header = `**来自 ${m.from}**${m.summary ? `（${m.summary}）` : ''}:`
    let body = m.text
    try {
      const parsed = JSON.parse(m.text) as Record<string, unknown>
      if (typeof parsed.content === 'string') body = parsed.content
    } catch { /* 非 JSON */ }
    return `${header}\n${body}`
  })
  return (
    `[系统通知] 你的工作者 Agent 已完成任务，以下是他们发送的完整工作结果：\n\n` +
    sections.join('\n\n---\n\n') +
    `\n\n请基于以上工作结果，向用户提供完整、详尽的最终回复。`
  )
}

/** task_notification 收集的摘要（用作 inbox 为空时的 fallback） */
export interface TaskNotificationSummary {
  taskId: string
  status: string
  summary: string
  outputFile?: string
}

/**
 * 用 task_notification 的 summaries 构造 fallback resume prompt
 */
export function formatSummaryFallbackPrompt(summaries: TaskNotificationSummary[]): string {
  const sections = summaries.map((s) => {
    const statusLabel = s.status === 'completed' ? '已完成' : s.status
    return `- **Task ${s.taskId}** (${statusLabel}): ${s.summary}`
  })
  return (
    `[系统通知] 你的工作者 Agent 已完成任务。以下是各任务的完成摘要：\n\n` +
    sections.join('\n') +
    `\n\n请基于以上任务摘要，向用户提供完整、详尽的最终回复。`
  )
}

/**
 * 检测所有工作者 Agent 是否已进入 idle 状态
 *
 * 用于 Watchdog 死锁检测：Task 工具仍在等待但 Workers 已停止工作。
 */
export async function areAllWorkersIdle(
  sdkSessionId: string,
  startedCount: number,
): Promise<boolean> {
  if (startedCount === 0) return false
  const inboxInfo = await findTeamLeadInboxPath(sdkSessionId)
  if (!inboxInfo) return false
  try {
    const raw = await readFile(inboxInfo.inboxPath, 'utf-8')
    const messages: InboxMessage[] = JSON.parse(raw)
    const idleWorkers = new Set<string>()
    for (const msg of messages) {
      try {
        const parsed = JSON.parse(msg.text) as Record<string, unknown>
        if (parsed.type === 'idle_notification') {
          idleWorkers.add(msg.from)
        }
      } catch { /* 非 JSON */ }
    }
    return idleWorkers.size >= startedCount
  } catch {
    return false
  }
}

// ===== Team 数据聚合（IPC 用） =====

/**
 * 通过 SDK sessionId 获取 Team 聚合数据
 *
 * 供 IPC handler 调用，返回完整的团队信息 + 任务列表 + 收件箱消息。
 */
export async function getAgentTeamData(sdkSessionId: string): Promise<AgentTeamData | null> {
  let teamEntries: string[]
  try {
    teamEntries = await readdir(TEAMS_DIR)
  } catch {
    return null
  }

  for (const teamName of teamEntries) {
    const configPath = join(TEAMS_DIR, teamName, 'config.json')
    try {
      const raw = await readFile(configPath, 'utf-8')
      const config: TeamConfig = JSON.parse(raw)
      if (config.leadSessionId === sdkSessionId) {
        const tasks = await readTasksForTeam(teamName)
        const inboxes = await readInboxesForTeam(teamName)
        return { teamName, team: config, tasks, inboxes }
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * 读取指定 team 的任务列表
 */
async function readTasksForTeam(teamName: string): Promise<TaskItem[]> {
  const tasksDir = join(TASKS_DIR, teamName)
  let files: string[]
  try {
    files = await readdir(tasksDir)
  } catch {
    return []
  }

  const jsonFiles = files
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .sort((a, b) => {
      const na = parseInt(a, 10)
      const nb = parseInt(b, 10)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })

  const tasks: TaskItem[] = []
  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(tasksDir, file), 'utf-8')
      const task: TaskItem = JSON.parse(raw)
      tasks.push(task)
    } catch {
      continue
    }
  }

  return tasks
}

/**
 * 读取指定 team 的所有 agent 收件箱消息
 */
async function readInboxesForTeam(teamName: string): Promise<Record<string, ParsedMailboxMessage[]>> {
  const inboxesDir = join(TEAMS_DIR, teamName, 'inboxes')
  let files: string[]
  try {
    files = await readdir(inboxesDir)
  } catch {
    return {}
  }

  const result: Record<string, ParsedMailboxMessage[]> = {}

  for (const file of files) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue
    const agentName = file.replace(/\.json$/, '')
    try {
      const raw = await readFile(join(inboxesDir, file), 'utf-8')
      const messages: InboxMessage[] = JSON.parse(raw)
      result[agentName] = messages.map(parseMailboxMessage)
    } catch {
      continue
    }
  }

  return result
}

/**
 * 解析收件箱消息类型
 */
function parseMailboxMessage(msg: InboxMessage): ParsedMailboxMessage {
  try {
    const parsed = JSON.parse(msg.text) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      const msgType = parsed.type
      if (msgType === 'idle_notification') return { ...msg, parsedType: 'idle_notification' }
      if (msgType === 'shutdown_request') return { ...msg, parsedType: 'shutdown_request' }
      if (msgType === 'shutdown_approved') return { ...msg, parsedType: 'shutdown_approved' }
      if (msgType === 'task_assignment') return { ...msg, parsedType: 'task_assignment' }
    }
  } catch {
    // 不是 JSON
  }
  return { ...msg, parsedType: 'text' }
}

/**
 * 读取 Teammate 输出文件内容
 *
 * 安全性：仅允许读取 ~/.claude/ 目录下的文件。
 */
export async function readAgentOutputFile(filePath: string): Promise<string> {
  const claudeDir = join(homedir(), '.claude')
  if (!filePath.startsWith(claudeDir)) {
    throw new Error('不允许读取 ~/.claude/ 目录之外的文件')
  }
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}
