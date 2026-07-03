import { getAgentSessionMeta, getAgentSessionSDKMessages } from './agent-session-manager'
import { getBundledCliPath, getConfigDirName } from './config-paths'

/** 最大回填消息条数 */
export const MAX_CONTEXT_MESSAGES = 20

/** 单条工具摘要最大字符数 */
const MAX_TOOL_SUMMARY_LENGTH = 200

interface SessionPromptHint {
  agentCwd: string
  workspaceSlug?: string
}

function getSessionHistoryPath(sessionId: string): string {
  return `~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl`
}

function canUseSessionCleaner(): boolean {
  return !!getBundledCliPath()
}

function getSessionCleanerSkillName(workspaceSlug?: string): string {
  return workspaceSlug
    ? `proma-workspace-${workspaceSlug}:session-cleaner`
    : 'session-cleaner'
}

function getSessionCliCommandPrefix(): string {
  return getBundledCliPath() ? '"$PROMA_CLI"' : 'proma'
}

function buildSessionCliAccessGuide(sessionId: string, historyPath: string, workspaceSlug?: string): string {
  const cli = getSessionCliCommandPrefix()
  const skillName = getSessionCleanerSkillName(workspaceSlug)
  return [
    `优先使用 session-cleaner skill（${skillName}）读取当前会话历史；它是 Proma CLI 的薄封装，会把 Agent JSONL 清洗为干净对话。`,
    `可用 CLI 命令前缀: ${cli}`,
    `建议流程:`,
    `1. ${cli} session info ${sessionId}`,
    `2. ${cli} session outline ${sessionId}`,
    `3. 根据 outline/search 定位后，用 ${cli} session export ${sessionId} --turns A-B 或 ${cli} session export ${sessionId} --tail N 读取片段。`,
    `4. 只有会话很小或 CLI 护栏允许时，才用 ${cli} session export ${sessionId} 读取全量。`,
    `不要直接 Read 原始 .jsonl 历史文件；CLI / skill 不可用或读取失败时，才兜底读取: ${historyPath}`,
  ].join('\n')
}

function buildCurrentSessionHistoryInstruction(sessionId: string, workspaceSlug?: string): string {
  const historyPath = getSessionHistoryPath(sessionId)
  if (canUseSessionCleaner()) {
    return buildSessionCliAccessGuide(sessionId, historyPath, workspaceSlug)
  }

  return `请先读取上述完整历史文件以恢复上下文。会话历史文件（.jsonl）可能包含大量消息和 tool results，文件较大；如果完整读取风险较高，请优先使用 Grep 搜索关键词定位相关消息片段，再局部读取。History path: ${historyPath}`
}

function buildReferencedSessionsHistoryInstruction(workspaceSlug?: string): string {
  if (canUseSessionCleaner()) {
    const skillName = getSessionCleanerSkillName(workspaceSlug)
    return `需要这些会话的上下文时，优先使用 session-cleaner skill（${skillName}）或 Proma CLI 读取清洗后的会话历史。按 info → outline/search → export 的顺序渐进式读取；不要假设会话内容，也不要直接 Read 原始 .jsonl 历史文件。`
  }

  return `不要假设这些会话的内容；需要上下文时，请先读取对应的 History path，再基于读取结果继续完成任务。\n\n重要提示：会话历史文件（.jsonl）可能包含大量消息和 tool results，文件较大。请优先使用 Grep 搜索关键词定位相关消息片段，再局部读取。避免一次性 Read 整个大文件。`
}

/**
 * 从 SDKMessage assistant 消息的 content 中提取工具活动摘要
 *
 * 扫描 tool_use 块，提取工具名称和关键参数，帮助新 SDK 会话理解之前做过什么。
 */
function extractSDKToolSummary(content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>): string {
  const summaries: string[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && block.name) {
      const input = block.input ?? {}
      const keyParam = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      const paramStr = keyParam ? `: ${String(keyParam).slice(0, 100)}` : ''
      summaries.push(`[tool: ${block.name}${paramStr}]`)
    }
  }
  if (summaries.length === 0) return ''
  const joined = summaries.join(' ')
  return joined.length > MAX_TOOL_SUMMARY_LENGTH
    ? joined.slice(0, MAX_TOOL_SUMMARY_LENGTH) + '...'
    : joined
}

/**
 * 构建带历史上下文的 prompt
 *
 * 当 resume 不可用时，将最近消息拼接为上下文注入 prompt，
 * 让新 SDK 会话保留对话记忆。包含文本内容和工具活动摘要。
 */
export function buildContextPrompt(sessionId: string, currentUserMessage: string, sessionHint?: SessionPromptHint): string {
  const allMessages = getAgentSessionSDKMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  // 排除最后一条（当前用户消息，刚刚才 append 的）
  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.type === 'user' || m.type === 'assistant'))
    .map((m) => {
      // 从 SDKMessage 的 message.content 中提取文本
      const content = (m as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } }).message?.content
      if (!Array.isArray(content)) return null

      const textParts = content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
      const text = textParts.join('\n')
      if (!text) return null

      let line = `[${m.type}]: ${text}`
      // assistant 消息附带工具活动摘要
      if (m.type === 'assistant') {
        const toolSummary = extractSDKToolSummary(content)
        if (toolSummary) {
          line += `\n  工具活动: ${toolSummary}`
        }
      }
      return line
    })
    .filter(Boolean)

  if (lines.length === 0) return currentUserMessage

  // 注入 session 元信息 + 强指令：兜底场景（resume 指针丢失）下，仅靠最近
  // MAX_CONTEXT_MESSAGES 条摘要不足以让长任务无缝接续，必须引导模型读取完整历史，
  // 避免「从零重新执行整个任务」（#903）。
  const sessionInfoBlock = sessionHint
    ? `\n<session_info>\nSession ID: ${sessionId}\nSession CWD: ${sessionHint.agentCwd}\n` +
      `History path: ${getSessionHistoryPath(sessionId)}\n` +
      `重要：上方仅为最近 ${MAX_CONTEXT_MESSAGES} 条对话摘要，可能不完整。在继续之前，` +
      `${buildCurrentSessionHistoryInstruction(sessionId, sessionHint.workspaceSlug)}\n` +
      `恢复时先确认「已经完成了哪些工作、进行到哪一步」，然后从中断处继续，切勿重复执行已完成的步骤。\n</session_info>\n`
    : ''

  console.log(`[Agent 编排] buildContextPrompt: 读取 ${allMessages.length} 条消息，注入 ${lines.length} 条历史${sessionHint ? '（含 session 元信息）' : ''}`)
  return `<conversation_history>${sessionInfoBlock}\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}

/**
 * 构建 Session 恢复 prompt
 *
 * 当 SDK resume 失败（session 过期、thinking signature 不兼容等）时，
 * 注入 <session_recovery> 标签指向当前会话，并优先让 Agent 通过 session-cleaner
 * 读取干净会话历史后无缝继续工作。
 */
export function buildRecoveryPrompt(
  sessionId: string,
  currentUserMessage: string,
  sessionHint: SessionPromptHint,
): string {
  const meta = getAgentSessionMeta(sessionId)
  const title = meta ? escapeContextAttr(meta.title) : sessionId
  const historyPath = getSessionHistoryPath(sessionId)

  const recoveryBlock =
    `<session_recovery>\n` +
    `你正在接续一个已有的 Agent 会话（因模型切换等原因需要重新建立连接）。\n` +
    `当前会话的完整历史记录在下方会话信息中，请先恢复上下文，然后继续处理用户的最新请求。\n` +
    `<session id="${sessionId}" title="${title}" cwd="${sessionHint.agentCwd}">\n` +
    `History path: ${historyPath}\n` +
    `</session>\n` +
    `${buildCurrentSessionHistoryInstruction(sessionId, sessionHint.workspaceSlug)}\n` +
    `</session_recovery>`

  console.log(`[Agent 编排] buildRecoveryPrompt: 注入 session 自引用 → ${historyPath}`)
  return `${recoveryBlock}\n\n${currentUserMessage}`
}

function escapeContextAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildReferencedSessionsPrompt(
  currentSessionId: string,
  mentionedSessionIds?: string[],
  workspaceId?: string,
  workspaceSlug?: string,
): string {
  const uniqueIds = [...new Set((mentionedSessionIds ?? []).filter(Boolean))]
  if (uniqueIds.length === 0) return ''

  const currentWorkspaceId = workspaceId ?? getAgentSessionMeta(currentSessionId)?.workspaceId
  const sessionBlocks: string[] = []

  for (const referencedSessionId of uniqueIds) {
    if (referencedSessionId === currentSessionId) continue

    const meta = getAgentSessionMeta(referencedSessionId)
    if (!meta || meta.archived) continue
    if (currentWorkspaceId && meta.workspaceId !== currentWorkspaceId) continue

    const title = escapeContextAttr(meta.title)
    const historyPath = getSessionHistoryPath(referencedSessionId)
    sessionBlocks.push(
      `<session id="${referencedSessionId}" title="${title}" updatedAt="${meta.updatedAt}">\n` +
      `CLI target: ${referencedSessionId}\n` +
      `History path: ${historyPath}\n` +
      '</session>',
    )
  }

  if (sessionBlocks.length === 0) return ''

  return `<referenced_sessions>\n用户在消息中明确引用了以下同工作区 Agent 会话。${buildReferencedSessionsHistoryInstruction(workspaceSlug)}\n${sessionBlocks.join('\n\n')}\n</referenced_sessions>`
}
