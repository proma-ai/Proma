/**
 * Flow 旧系统数据迁移
 *
 * 将 proma-frontend 的 Flow Agent 数据转换为新 Proma Agent 格式。
 *
 * 旧格式：
 * - ~/.proma/flow-projects.json — 项目索引
 * - ~/.proma/sessions/{projectId}/{sessionId}.json — 单个 JSON 文件，内含 FlowMessage[]
 *
 * 新格式：
 * - ~/.proma/agent-sessions.json — 会话索引（AgentSessionMeta[]）
 * - ~/.proma/agent-sessions/{sessionId}.jsonl — JSONL 每行一条 AgentMessage
 * - ~/.proma/agent-workspaces.json — 工作区索引
 *
 * 迁移策略：
 * - 创建一个"旧系统迁移"工作区，所有旧 session 归入
 * - FlowMessage → AgentMessage：blocks 中的 tool_call 转为 events
 * - 完成后 flow-projects.json → .bak，sessions/ → sessions.bak/
 */

import { readFileSync, readdirSync, renameSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfigDir, getAgentSessionsDir, getAgentSessionMessagesPath } from './config-paths'
import { createAgentWorkspace } from './agent-workspace-manager'
import type { AgentSessionMeta, AgentEvent } from '@proma/shared'

// ===== 旧格式类型定义 =====

interface FlowProject {
  id: string
  name: string
  workingDirectory: string
  systemPrompt?: string
  isPinned?: boolean
  createdAt: string
  updatedAt: string
}

interface ToolCallRecord {
  id: string
  toolName: string
  input: unknown
  output?: unknown
  status: 'pending' | 'running' | 'success' | 'error'
}

interface TextBlock {
  type: 'text'
  id: string
  content: string
}

interface ToolCallBlock {
  type: 'tool_call'
  toolCall: ToolCallRecord
}

interface ThinkingBlock {
  type: 'thinking'
  id: string
  content: string
}

type MessageBlock = TextBlock | ToolCallBlock | ThinkingBlock

interface FlowMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCallRecord[]
  blocks?: MessageBlock[]
  createdAt: string
}

interface FlowSession {
  id: string
  projectId: string
  messages: FlowMessage[]
  toolCalls: ToolCallRecord[]
  status: 'idle' | 'running' | 'completed' | 'error'
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
}

interface ProjectsFile {
  projects: FlowProject[]
}

// ===== 新格式 =====

interface AgentSessionsIndex {
  version: number
  sessions: AgentSessionMeta[]
}

interface NewAgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  events?: AgentEvent[]
}

// ===== 转换逻辑 =====

/**
 * 将 FlowMessage 的 blocks 中的 tool_call 转为 AgentEvent[]
 */
function convertBlocksToEvents(blocks: MessageBlock[]): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const block of blocks) {
    if (block.type === 'tool_call') {
      const tc = block.toolCall

      // tool_start
      events.push({
        type: 'tool_start',
        toolName: tc.toolName,
        toolUseId: tc.id,
        input: (tc.input as Record<string, unknown>) ?? {},
      })

      // tool_result
      if (tc.status === 'success' || tc.status === 'error') {
        events.push({
          type: 'tool_result',
          toolUseId: tc.id,
          toolName: tc.toolName,
          result: typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? ''),
          isError: tc.status === 'error',
        })
      }
    }
  }

  return events
}

/**
 * 将 FlowMessage 转为 NewAgentMessage
 */
function convertMessage(msg: FlowMessage): NewAgentMessage {
  const createdAt = new Date(msg.createdAt).getTime() || Date.now()

  // 构建 content：thinking 内容合并到正文前
  let content = msg.content || ''
  if (msg.thinking) {
    content = `<thinking>\n${msg.thinking}\n</thinking>\n\n${content}`
  }

  // 转换工具调用 events
  let events: AgentEvent[] | undefined
  if (msg.role === 'assistant' && msg.blocks && msg.blocks.length > 0) {
    const converted = convertBlocksToEvents(msg.blocks)
    if (converted.length > 0) {
      events = converted
    }
  }

  return {
    id: msg.id,
    role: msg.role,
    content,
    createdAt,
    events,
  }
}

/**
 * 生成会话标题
 *
 * 优先使用项目名 + 首条用户消息前 30 字符
 */
function generateTitle(projectName: string, messages: FlowMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  const preview = firstUserMsg?.content?.slice(0, 30)?.replace(/\n/g, ' ') || ''
  if (preview) {
    return `${projectName}: ${preview}${firstUserMsg!.content.length > 30 ? '...' : ''}`
  }
  return `${projectName}: 旧会话`
}

// ===== 主迁移函数 =====

/**
 * 执行 Flow 旧数据迁移
 *
 * 检测 ~/.proma/flow-projects.json 是否存在（且 .bak 不存在），
 * 存在则执行一次性迁移，完成后将原始文件重命名为 .bak。
 */
export async function migrateFlowSessions(): Promise<void> {
  const configDir = getConfigDir()
  const projectsPath = join(configDir, 'flow-projects.json')
  const projectsBakPath = join(configDir, 'flow-projects.json.bak')
  const sessionsDir = join(configDir, 'sessions')
  const sessionsBakDir = join(configDir, 'sessions.bak')

  // 已迁移或无数据，跳过
  if (!existsSync(projectsPath) || existsSync(projectsBakPath)) {
    return
  }

  console.log('[迁移] 检测到旧 Flow 数据，开始迁移...')

  try {
    // 1. 读取旧项目索引
    const raw = readFileSync(projectsPath, 'utf-8')
    const projectsFile = JSON.parse(raw) as ProjectsFile
    const projects = projectsFile.projects || []

    if (projects.length === 0) {
      console.log('[迁移] 无旧项目，标记为已迁移')
      renameSync(projectsPath, projectsBakPath)
      return
    }

    // 2. 创建"旧系统迁移"工作区
    const workspace = await createAgentWorkspace('旧系统迁移')
    console.log(`[迁移] 已创建工作区: ${workspace.name} (${workspace.id})`)

    // 3. 读取现有 agent-sessions 索引
    const indexPath = join(configDir, 'agent-sessions.json')
    let sessionsIndex: AgentSessionsIndex
    if (existsSync(indexPath)) {
      sessionsIndex = JSON.parse(readFileSync(indexPath, 'utf-8')) as AgentSessionsIndex
    } else {
      sessionsIndex = { version: 1, sessions: [] }
    }

    // 确保 agent-sessions 目录存在
    getAgentSessionsDir()

    // 建立 projectId → projectName 映射
    const projectNameMap = new Map<string, string>()
    for (const project of projects) {
      projectNameMap.set(project.id, project.name)
    }

    // 4. 遍历所有旧 session 文件
    let migratedCount = 0
    let skippedCount = 0

    if (existsSync(sessionsDir)) {
      const projectDirs = readdirSync(sessionsDir, { withFileTypes: true })

      for (const dirEntry of projectDirs) {
        if (!dirEntry.isDirectory()) continue

        const projectId = dirEntry.name
        const projectName = projectNameMap.get(projectId) || '未知项目'
        const projectSessionsDir = join(sessionsDir, projectId)

        let sessionFiles: string[]
        try {
          sessionFiles = readdirSync(projectSessionsDir)
            .filter((f) => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.migrated'))
        } catch {
          continue
        }

        for (const file of sessionFiles) {
          try {
            const filePath = join(projectSessionsDir, file)
            const sessionRaw = readFileSync(filePath, 'utf-8')
            const oldSession = JSON.parse(sessionRaw) as FlowSession

            // 跳过空会话
            if (!oldSession.messages || oldSession.messages.length === 0) {
              skippedCount++
              continue
            }

            // 生成新会话元数据
            const sessionId = oldSession.id
            const title = generateTitle(projectName, oldSession.messages)
            const createdAt = new Date(oldSession.createdAt).getTime() || Date.now()
            const updatedAt = new Date(oldSession.updatedAt).getTime() || Date.now()

            const meta: AgentSessionMeta = {
              id: sessionId,
              title,
              workspaceId: workspace.id,
              createdAt,
              updatedAt,
            }

            // 写入 JSONL 消息文件
            const jsonlPath = getAgentSessionMessagesPath(sessionId)
            for (const msg of oldSession.messages) {
              const converted = convertMessage(msg)
              appendFileSync(jsonlPath, JSON.stringify(converted) + '\n', 'utf-8')
            }

            // 添加到索引
            sessionsIndex.sessions.push(meta)
            migratedCount++
          } catch (error) {
            console.warn(`[迁移] 跳过无法解析的 session 文件: ${file}`, error)
            skippedCount++
          }
        }
      }
    }

    // 5. 写入更新后的索引
    writeFileSync(indexPath, JSON.stringify(sessionsIndex, null, 2), 'utf-8')

    // 6. 备份旧数据
    renameSync(projectsPath, projectsBakPath)
    console.log('[迁移] flow-projects.json → flow-projects.json.bak')

    if (existsSync(sessionsDir) && !existsSync(sessionsBakDir)) {
      renameSync(sessionsDir, sessionsBakDir)
      console.log('[迁移] sessions/ → sessions.bak/')
    }

    console.log(`[迁移] 完成！已迁移 ${migratedCount} 个会话，跳过 ${skippedCount} 个空会话`)
  } catch (error) {
    console.error('[迁移] 迁移过程出错，旧数据保持不变:', error)
    // 迁移失败不影响正常启动
  }
}
