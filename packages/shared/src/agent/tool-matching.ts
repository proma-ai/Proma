/**
 * 无状态工具匹配模块
 *
 * 将 SDK 消息转换为 AgentEvent 的工具事件提取。
 *
 * 核心原则：所有输出仅来自当前消息 + 追加式工具索引。
 * 无可变队列、栈或顺序依赖的状态。
 */

import type { AgentEvent } from '../types/agent'

// ============================================================================
// Tool Index — 追加式、顺序无关的查找表
// ============================================================================

export interface ToolEntry {
  name: string
  input: Record<string, unknown>
}

/**
 * 工具元数据的追加式索引，从 tool_start 事件构建。
 * 顺序无关：先插入 A 再插入 B = 先插入 B 再插入 A。
 * 用于处理 tool_result 块时查找工具名称/输入。
 */
export class ToolIndex {
  private entries = new Map<string, ToolEntry>()

  /** 注册工具（幂等 — 相同 ID 总映射到相同条目） */
  register(toolUseId: string, name: string, input: Record<string, unknown>): void {
    const existing = this.entries.get(toolUseId)
    if (existing && Object.keys(existing.input).length === 0 && Object.keys(input).length > 0) {
      this.entries.set(toolUseId, { name, input })
    } else if (!existing) {
      this.entries.set(toolUseId, { name, input })
    }
  }

  getName(toolUseId: string): string | undefined {
    return this.entries.get(toolUseId)?.name
  }

  getInput(toolUseId: string): Record<string, unknown> | undefined {
    return this.entries.get(toolUseId)?.input
  }

  getEntry(toolUseId: string): ToolEntry | undefined {
    return this.entries.get(toolUseId)
  }

  has(toolUseId: string): boolean {
    return this.entries.has(toolUseId)
  }

  get size(): number {
    return this.entries.size
  }
}

// ============================================================================
// 内容块类型（Anthropic SDK 类型子集）
// ============================================================================

/** assistant 消息中的 tool_use 内容块 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** user 消息中的 tool_result 内容块 */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

/** 文本内容块 */
export interface TextBlock {
  type: 'text'
  text: string
}

/** 处理的内容块联合类型 */
export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string }

// ============================================================================
// 纯提取函数
// ============================================================================

/**
 * 从 assistant 消息内容块中提取 tool_start 事件。
 */
export function extractToolStarts(
  contentBlocks: ContentBlock[],
  sdkParentToolUseId: string | null,
  toolIndex: ToolIndex,
  emittedToolStartIds: Set<string>,
  turnId?: string,
  activeParentTools?: Set<string>,
): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue
    const toolBlock = block as ToolUseBlock

    toolIndex.register(toolBlock.id, toolBlock.name, toolBlock.input)

    // 确定父级：SDK 的 parent_tool_use_id 是权威来源
    // 推断仅适用于非 Task 工具 — 并行 Task 是同级关系，不应互相嵌套
    let parentToolUseId: string | undefined
    if (sdkParentToolUseId) {
      parentToolUseId = sdkParentToolUseId
    } else if (toolBlock.name !== 'Task' && activeParentTools && activeParentTools.size === 1) {
      const [singleActiveParent] = activeParentTools
      if (toolBlock.id !== singleActiveParent) {
        parentToolUseId = singleActiveParent
      }
    }

    // 去重：stream_event 在 assistant message 之前到达
    if (emittedToolStartIds.has(toolBlock.id)) {
      const hasNewInput = Object.keys(toolBlock.input).length > 0
      if (hasNewInput) {
        const intent = extractIntent(toolBlock)
        const displayName = toolBlock.input._displayName as string | undefined
        events.push({
          type: 'tool_start',
          toolName: toolBlock.name,
          toolUseId: toolBlock.id,
          input: toolBlock.input,
          intent,
          displayName,
          turnId,
          parentToolUseId,
        })
      }
      continue
    }

    emittedToolStartIds.add(toolBlock.id)

    const intent = extractIntent(toolBlock)
    const displayName = toolBlock.input._displayName as string | undefined

    events.push({
      type: 'tool_start',
      toolName: toolBlock.name,
      toolUseId: toolBlock.id,
      input: toolBlock.input,
      intent,
      displayName,
      turnId,
      parentToolUseId,
    })
  }

  return events
}

/**
 * 从 user 消息内容块中提取 tool_result 事件。
 */
export function extractToolResults(
  contentBlocks: ContentBlock[],
  sdkParentToolUseId: string | null,
  toolUseResultValue: unknown,
  toolIndex: ToolIndex,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = []

  const toolResultBlocks = contentBlocks.filter(
    (b): b is ToolResultBlock => b.type === 'tool_result'
  )

  if (toolResultBlocks.length > 0) {
    for (const block of toolResultBlocks) {
      const toolUseId = block.tool_use_id
      const entry = toolIndex.getEntry(toolUseId)

      const resultStr = serializeResult(block.content)
      const isError = block.is_error ?? isToolResultError(block.content)

      events.push({
        type: 'tool_result',
        toolUseId,
        toolName: entry?.name,
        result: resultStr,
        isError,
        input: entry?.input,
        turnId,
        parentToolUseId: sdkParentToolUseId ?? undefined,
      })

      if (entry) {
        const bgEvents = detectBackgroundEvents(toolUseId, entry, resultStr, isError, turnId)
        events.push(...bgEvents)
      }
    }
  } else if (toolUseResultValue !== undefined) {
    const toolUseId = sdkParentToolUseId ?? `fallback-${turnId ?? 'unknown'}`
    const entry = toolIndex.getEntry(toolUseId)

    const resultStr = serializeResult(toolUseResultValue)
    const isError = isToolResultError(toolUseResultValue)

    events.push({
      type: 'tool_result',
      toolUseId,
      toolName: entry?.name,
      result: resultStr,
      isError,
      input: entry?.input,
      turnId,
      parentToolUseId: undefined,
    })

    if (entry) {
      const bgEvents = detectBackgroundEvents(toolUseId, entry, resultStr, isError, turnId)
      events.push(...bgEvents)
    }
  }

  return events
}

// ============================================================================
// 辅助函数（纯函数）
// ============================================================================

/** 从 tool_use 块的 input 中提取意图 */
function extractIntent(toolBlock: ToolUseBlock): string | undefined {
  const input = toolBlock.input
  let intent = input._intent as string | undefined
  if (!intent && toolBlock.name === 'Bash') {
    intent = (input as { description?: string }).description
  }
  return intent
}

/** 将工具结果值序列化为字符串 */
export function serializeResult(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[结果包含不可序列化的数据]'
  }
}

/** 检查工具结果是否指示错误 */
export function isToolResultError(result: unknown): boolean {
  if (typeof result === 'string') {
    return result.startsWith('Error:') || result.startsWith('error:')
  }
  if (result && typeof result === 'object') {
    if ('is_error' in result && (result as { is_error: boolean }).is_error) return true
    if ('error' in result) return true
  }
  return false
}

/** 检测后台任务/Shell 事件 */
function detectBackgroundEvents(
  toolUseId: string,
  entry: ToolEntry,
  resultStr: string,
  isError: boolean,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = []

  // 后台 Task 检测
  if (entry.name === 'Task' && !isError && resultStr && entry.input.run_in_background === true) {
    const agentIdMatch = resultStr.match(/agentId:\s*([a-zA-Z0-9_-]+)/)
    if (agentIdMatch?.[1]) {
      const intentValue = entry.input._intent
      events.push({
        type: 'task_backgrounded',
        toolUseId,
        taskId: agentIdMatch[1],
        turnId,
        ...(typeof intentValue === 'string' && { intent: intentValue }),
      })
    }
  }

  // 后台 Shell 检测
  if (entry.name === 'Bash' && !isError && resultStr) {
    const shellIdMatch = resultStr.match(/shell_id:\s*([a-zA-Z0-9_-]+)/)
      || resultStr.match(/"backgroundTaskId":\s*"([a-zA-Z0-9_-]+)"/)
    if (shellIdMatch?.[1]) {
      const intentValue = (typeof entry.input._intent === 'string' && entry.input._intent)
        || (typeof entry.input.description === 'string' && entry.input.description)
        || undefined
      const commandValue = typeof entry.input.command === 'string' ? entry.input.command : undefined
      events.push({
        type: 'shell_backgrounded',
        toolUseId,
        shellId: shellIdMatch[1],
        turnId,
        ...(intentValue && { intent: intentValue }),
        ...(commandValue && { command: commandValue }),
      })
    }
  }

  // Shell 终止检测
  if (entry.name === 'KillShell') {
    const shellId = entry.input.shell_id as string
    if (shellId) {
      events.push({
        type: 'shell_killed',
        shellId,
        turnId,
      })
    }
  }

  return events
}
