import type { WorkspaceComponentTab } from '@/atoms/agent-atoms'

const TODO_MUTATION_TOOLS = new Set([
  'mcp__planning__create_todo',
  'mcp__planning__update_todo',
  'mcp__planning__complete_todo',
  'mcp__planning__delete_todo',
])

const CALENDAR_MUTATION_TOOLS = new Set([
  'mcp__planning__create_calendar_event',
  'mcp__planning__update_calendar_event',
  'mcp__planning__delete_calendar_event',
])

const AUTOMATION_MUTATION_TOOLS = new Set([
  'mcp__automation__create_automation',
  'mcp__automation__update_automation',
  'mcp__automation__delete_automation',
])

const PLANNING_GROUP_MUTATION_TOOLS = new Set([
  'mcp__planning__create_group',
  'mcp__planning__update_group',
  'mcp__planning__delete_group',
])

const PLANNING_REMINDER_CREATE_TOOL = 'mcp__planning__create_reminder'
const FILE_MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const BASH_MUTATION_PATTERN = /(?:^|[;&|]\s*|\s)(?:rm|mv|mkdir|cp|touch|tee|sed\s+-i)\b|(?:>|>>)/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getFilePath(input: Record<string, unknown>): string | null {
  const value = input.file_path ?? input.filePath ?? input.path ?? input.notebook_path
  return typeof value === 'string' ? value : null
}

function getWorkspaceManagedFileComponent(path: string): WorkspaceComponentTab | null {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  // 只响应 Proma workspace 下的配置，避免用户项目中同名 skills/ 或 mcp.json 误触发。
  if (!normalized.includes('/agent-workspaces/')) return null
  if (normalized.includes('/skills/')) return 'skills'
  if (normalized.endsWith('/mcp.json')) return 'mcp'
  return null
}

/**
 * 将 Agent 的变更工具调用映射为应展示的项目级组件。
 * 仅匹配增删改操作；读取、列举与执行定时任务不触发界面抢焦点。
 */
export function getChangedWorkspaceComponentForTool(
  toolName: unknown,
  rawInput: unknown,
): WorkspaceComponentTab | null {
  if (typeof toolName !== 'string') return null
  if (TODO_MUTATION_TOOLS.has(toolName)) return 'todos'
  if (CALENDAR_MUTATION_TOOLS.has(toolName)) return 'calendar'
  if (AUTOMATION_MUTATION_TOOLS.has(toolName)) return 'automations'

  const input = asRecord(rawInput)
  if (!input) return null

  if (PLANNING_GROUP_MUTATION_TOOLS.has(toolName)) {
    return input.scope === 'calendar' ? 'calendar' : input.scope === 'todo' ? 'todos' : null
  }
  if (toolName === PLANNING_REMINDER_CREATE_TOOL) {
    return input.targetType === 'calendar_event' ? 'calendar' : input.targetType === 'todo' ? 'todos' : null
  }

  if (FILE_MUTATION_TOOLS.has(toolName)) {
    const filePath = getFilePath(input)
    return filePath ? getWorkspaceManagedFileComponent(filePath) : null
  }
  // Skills/MCP 的创建和删除有时由 Bash 完成；仅识别 Proma workspace 路径和明确写入命令。
  if (toolName === 'Bash' && typeof input.command === 'string' && BASH_MUTATION_PATTERN.test(input.command)) {
    return getWorkspaceManagedFileComponent(input.command)
  }
  return null
}

/** 从一条 SDK assistant 消息提取本轮第一个会改变项目组件数据的工具。 */
export function getChangedWorkspaceComponentFromSdkMessage(message: unknown): WorkspaceComponentTab | null {
  const record = asRecord(message)
  if (!record || record.type !== 'assistant') return null
  const envelope = asRecord(record.message)
  const content = envelope?.content
  if (!Array.isArray(content)) return null

  for (const block of content) {
    const toolUse = asRecord(block)
    if (toolUse?.type !== 'tool_use') continue
    const component = getChangedWorkspaceComponentForTool(toolUse.name, toolUse.input)
    if (component) return component
  }
  return null
}
