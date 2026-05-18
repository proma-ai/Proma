import type { ToolActivity } from '@/atoms/agent-atoms'

/** Task 工具名集合（用于聚合判断，与 SDKMessageRenderer 共享语义）
 * 注意：TaskGet/TaskList 是只读查询工具，不纳入聚合，保留为普通工具活动行 */
export const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])

export type TaskItemStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export interface TaskItem {
  id: string
  subject: string
  status: TaskItemStatus
  activeForm?: string
}

interface TaskCreateOutput {
  task?: {
    id?: unknown
    subject?: unknown
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * SDK tool_result content can be a raw string or an array of text blocks.
 * Keep this extraction narrow so binary/image blocks do not leak into task parsing.
 */
export function extractToolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((block) => {
      if (!isRecord(block)) return ''
      return typeof block.text === 'string' ? block.text : ''
    })
    .join('')

  return text || undefined
}

export function parseTaskCreateResult(result: string | undefined): { id: string; subject?: string } | null {
  if (!result) return null

  const json = parseJsonObject(result) as TaskCreateOutput | null
  const task = json?.task
  if (isRecord(task) && (typeof task.id === 'string' || typeof task.id === 'number')) {
    return {
      id: String(task.id),
      subject: typeof task.subject === 'string' ? task.subject : undefined,
    }
  }

  return null
}

function toTaskStatus(value: unknown, fallback: TaskItemStatus = 'pending'): TaskItemStatus {
  if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted') {
    return value
  }
  return fallback
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function taskIdFromInput(input: Record<string, unknown>): string | undefined {
  return stringId(input.taskId ?? input.task_id ?? input.id)
}

/**
 * 从 ToolActivity[] 中提取并聚合所有任务项的最新状态。
 *
 * 策略：
 * 1. TaskCreate 读取 SDK 0.3 的结构化输出 `{ task: { id, subject } }`
 * 2. TaskUpdate 通过 taskId 更新已有条目，跨 turn 时可用历史 subject 恢复任务名
 */
export function aggregateTaskItems(
  activities: ToolActivity[],
  streamEnded: boolean,
  historicalTaskSubjects?: Map<string, string>,
): TaskItem[] {
  const taskMap = new Map<string, TaskItem>()
  let todoAutoId = 0

  const taskCreateIdMap = new Map<string, string>()
  const taskCreateSubjectMap = new Map<string, string>()

  for (const activity of activities) {
    if (activity.toolName !== 'TaskCreate') continue

    const parsedResult = parseTaskCreateResult(activity.result)
    const taskId = parsedResult?.id ?? activity.toolUseId
    taskCreateIdMap.set(activity.toolUseId, taskId)

    if (parsedResult?.subject) {
      taskCreateSubjectMap.set(taskId, parsedResult.subject)
    }
  }

  for (const activity of activities) {
    if (activity.toolName === 'TodoWrite') {
      const todos = activity.input.todos
      if (Array.isArray(todos)) {
        for (const key of taskMap.keys()) {
          if (key.startsWith('todo-')) taskMap.delete(key)
        }
        for (const t of todos as Array<Record<string, unknown>>) {
          const id = `todo-${todoAutoId++}`
          taskMap.set(id, {
            id,
            subject: String(t.subject ?? t.content ?? ''),
            status: toTaskStatus(t.status),
            activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
          })
        }
      }
    } else if (activity.toolName === 'TaskCreate') {
      const id = taskCreateIdMap.get(activity.toolUseId) ?? activity.toolUseId
      const subject = typeof activity.input.subject === 'string'
        ? activity.input.subject
        : taskCreateSubjectMap.get(id)
          ?? (typeof activity.input.description === 'string' ? activity.input.description : '未命名任务')

      taskMap.set(id, {
        id,
        subject,
        status: 'pending',
        activeForm: typeof activity.input.activeForm === 'string' ? activity.input.activeForm : undefined,
      })
    } else if (activity.toolName === 'TaskUpdate') {
      const taskId = taskIdFromInput(activity.input)
      if (!taskId) continue

      const existing = taskMap.get(taskId)
      const status = toTaskStatus(activity.input.status, existing?.status ?? 'pending')

      if (existing) {
        taskMap.set(taskId, {
          ...existing,
          status,
          ...(typeof activity.input.subject === 'string' && { subject: activity.input.subject }),
          ...(typeof activity.input.activeForm === 'string' && { activeForm: activity.input.activeForm }),
        })
      } else {
        taskMap.set(taskId, {
          id: taskId,
          subject: typeof activity.input.subject === 'string'
            ? activity.input.subject
            : historicalTaskSubjects?.get(taskId) ?? `任务 #${taskId}`,
          status,
          activeForm: typeof activity.input.activeForm === 'string' ? activity.input.activeForm : undefined,
        })
      }
    }
  }

  let items = Array.from(taskMap.values()).filter((t) => t.status !== 'deleted')
  if (streamEnded) {
    items = items.map((t) =>
      t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t
    )
  }
  return items
}
