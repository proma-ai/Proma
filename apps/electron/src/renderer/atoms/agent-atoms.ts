/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import type { AgentSessionMeta, AgentMessage, AgentEvent, AgentWorkspace, AgentPendingFile } from '@proma/shared'

/** 活动状态 */
export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'

/** 工具活动状态 */
export interface ToolActivity {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  intent?: string
  displayName?: string
  result?: string
  isError?: boolean
  done: boolean
  parentToolUseId?: string
  elapsedSeconds?: number
  taskId?: string
  shellId?: string
  isBackground?: boolean
}

/** 活动分组（Task 子代理） */
export interface ActivityGroup {
  parent: ToolActivity
  children: ToolActivity[]
}

/** Agent 会话的流式状态 */
export interface AgentStreamState {
  running: boolean
  content: string
  toolActivities: ToolActivity[]
  model?: string
  /** 当前输入 token 数（上下文使用量） */
  inputTokens?: number
  /** 模型上下文窗口大小 */
  contextWindow?: number
  /** 是否正在压缩上下文 */
  isCompacting?: boolean
  /** 重试状态 */
  retrying?: {
    attempt: number
    maxAttempts: number
    delaySeconds: number
    reason: string
  }
}

/** 从 ToolActivity 派生状态 */
export function getActivityStatus(activity: ToolActivity): ActivityStatus {
  if (activity.isBackground) return 'backgrounded'
  if (!activity.done) return 'running'
  if (activity.isError) return 'error'
  return 'completed'
}

/**
 * 合并同层 TodoWrite 活动：多次调用只保留最新 input，置底显示
 *
 * TodoWrite 每次调用都包含完整的 todo 列表，只需展示最新状态。
 */
function mergeTodoWrites(activities: ToolActivity[]): ToolActivity[] {
  const todoWrites: ToolActivity[] = []
  const others: ToolActivity[] = []

  for (const a of activities) {
    if (a.toolName === 'TodoWrite') {
      todoWrites.push(a)
    } else {
      others.push(a)
    }
  }

  if (todoWrites.length === 0) return activities

  const latest = todoWrites[todoWrites.length - 1]
  const allDone = todoWrites.every((t) => t.done)

  const merged: ToolActivity = {
    ...latest,
    done: allDone,
    isError: allDone && todoWrites.some((t) => t.isError),
  }

  return [...others, merged]
}

/**
 * 将扁平活动列表按 parentToolUseId 分组
 *
 * 返回顶层项（ActivityGroup | ToolActivity），
 * Task 类型的工具作为 group.parent，其子活动嵌套在 children 中。
 * 每层内 TodoWrite 合并去重并置底。
 */
export function groupActivities(activities: ToolActivity[]): Array<ActivityGroup | ToolActivity> {
  // 过滤幽灵条目：tool_progress 创建的空 input 条目，完成后仍无内容
  const filtered = activities.filter((a) => {
    if (a.done && Object.keys(a.input).length === 0 && !a.result) return false
    return true
  })
  const processed = mergeTodoWrites(filtered)

  const parentIds = new Set<string>()
  for (const a of processed) {
    if (a.toolName === 'Task') parentIds.add(a.toolUseId)
  }

  const childrenMap = new Map<string, ToolActivity[]>()
  const topLevel: Array<ActivityGroup | ToolActivity> = []

  for (const a of processed) {
    if (a.parentToolUseId && parentIds.has(a.parentToolUseId)) {
      const children = childrenMap.get(a.parentToolUseId) ?? []
      children.push(a)
      childrenMap.set(a.parentToolUseId, children)
    } else {
      topLevel.push(a)
    }
  }

  return topLevel.map((item) => {
    if ('toolUseId' in item && parentIds.has(item.toolUseId)) {
      const children = childrenMap.get(item.toolUseId) ?? []
      return { parent: item, children: mergeTodoWrites(children) } as ActivityGroup
    }
    return item
  })
}

/** 判断是否为 ActivityGroup */
export function isActivityGroup(item: ActivityGroup | ToolActivity): item is ActivityGroup {
  return 'parent' in item && 'children' in item
}

/** 待自动发送的 Agent 提示（从设置页"对话完成配置"触发） */
export interface AgentPendingPrompt {
  sessionId: string
  message: string
}

// ===== Atoms =====

export const agentSessionsAtom = atom<AgentSessionMeta[]>([])
export const agentWorkspacesAtom = atom<AgentWorkspace[]>([])
export const currentAgentWorkspaceIdAtom = atom<string | null>(null)
export const agentChannelIdAtom = atom<string | null>(null)
export const agentModelIdAtom = atom<string | null>(null)
export const currentAgentSessionIdAtom = atom<string | null>(null)
export const currentAgentMessagesAtom = atom<AgentMessage[]>([])
export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>>(new Map())
export const agentPendingPromptAtom = atom<AgentPendingPrompt | null>(null)

/** Agent 待发送文件列表 */
export const agentPendingFilesAtom = atom<AgentPendingFile[]>([])

/** 工作区能力版本号 — 每次修改 MCP/Skills 后自增，触发侧边栏重新获取 */
export const workspaceCapabilitiesVersionAtom = atom(0)

/** 工作区文件版本号 — 文件变化时自增，触发文件浏览器重新加载 */
export const workspaceFilesVersionAtom = atom(0)

export const currentAgentSessionAtom = atom<AgentSessionMeta | null>((get) => {
  const sessions = get(agentSessionsAtom)
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return sessions.find((s) => s.id === currentId) ?? null
})

export const agentStreamingAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentStreamingStatesAtom).get(currentId)?.running ?? false
})

export const agentStreamingContentAtom = atom<string>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return ''
  return get(agentStreamingStatesAtom).get(currentId)?.content ?? ''
})

export const agentToolActivitiesAtom = atom<ToolActivity[]>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return []
  return get(agentStreamingStatesAtom).get(currentId)?.toolActivities ?? []
})

export const agentStreamingModelAtom = atom<string | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.model
})

export const agentRetryingAtom = atom<AgentStreamState['retrying'] | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.retrying
})

export const agentRunningSessionIdsAtom = atom<Set<string>>((get) => {
  const states = get(agentStreamingStatesAtom)
  const ids = new Set<string>()
  for (const [id, state] of states) {
    if (state.running) ids.add(id)
  }
  return ids
})

/**
 * 处理 AgentEvent 并更新流式状态（纯函数）
 */
export function applyAgentEvent(
  prev: AgentStreamState,
  event: AgentEvent,
): AgentStreamState {
  switch (event.type) {
    case 'text_delta':
      // 开始接收文本 - 清除重试状态（重试成功）
      return { ...prev, content: prev.content + event.text, retrying: undefined }

    case 'text_complete':
      return prev

    case 'tool_start': {
      const existing = prev.toolActivities.find((t) => t.toolUseId === event.toolUseId)
      if (existing) {
        return {
          ...prev,
          toolActivities: prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, input: event.input, intent: event.intent || t.intent, displayName: event.displayName || t.displayName }
              : t
          ),
          // 开始工具调用 - 清除重试状态（重试成功）
          retrying: undefined,
        }
      }
      return {
        ...prev,
        toolActivities: [...prev.toolActivities, {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: false,
          parentToolUseId: event.parentToolUseId,
        }],
        // 开始工具调用 - 清除重试状态（重试成功）
        retrying: undefined,
      }
    }

    case 'tool_result':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, result: event.result, isError: event.isError, done: true }
            : t
        ),
      }

    case 'task_backgrounded':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, isBackground: true, taskId: event.taskId }
            : t
        ),
      }

    case 'task_progress':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, elapsedSeconds: event.elapsedSeconds }
            : t
        ),
      }

    case 'shell_backgrounded':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, isBackground: true, shellId: event.shellId }
            : t
        ),
      }

    case 'shell_killed':
      return prev

    case 'complete':
      return { ...prev, running: false }

    case 'error':
      return { ...prev, running: false }

    case 'usage_update':
      return {
        ...prev,
        inputTokens: event.usage.inputTokens,
        ...(event.usage.contextWindow && { contextWindow: event.usage.contextWindow }),
      }

    case 'compacting':
      return { ...prev, isCompacting: true }

    case 'compact_complete':
      return { ...prev, isCompacting: false }

    case 'retrying':
      return {
        ...prev,
        retrying: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delaySeconds: event.delaySeconds,
          reason: event.reason,
        },
      }

    default:
      return prev
  }
}

/** 上下文使用量状态 */
export interface AgentContextStatus {
  isCompacting: boolean
  inputTokens?: number
  contextWindow?: number
}

/** 当前会话的上下文使用量派生 atom */
export const agentContextStatusAtom = atom<AgentContextStatus>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return { isCompacting: false }
  const state = get(agentStreamingStatesAtom).get(currentId)
  return {
    isCompacting: state?.isCompacting ?? false,
    inputTokens: state?.inputTokens,
    contextWindow: state?.contextWindow,
  }
})

/**
 * Agent 流式错误消息 Map — 以 sessionId 为 key
 * 错误发生时写入，下次发送或手动关闭时清除
 */
export const agentStreamErrorsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的错误消息（派生只读原子） */
export const currentAgentErrorAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentStreamErrorsAtom).get(currentId) ?? null
})

/**
 * Agent 会话输入框草稿 Map — 以 sessionId 为 key
 * 用于在切换会话时保留输入框内容
 */
export const agentSessionDraftsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的草稿内容（派生读写原子） */
export const currentAgentSessionDraftAtom = atom<string>(
  (get) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return ''
    return get(agentSessionDraftsAtom).get(currentId) ?? ''
  },
  (get, set, newDraft: string) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(agentSessionDraftsAtom, (prev) => {
      const map = new Map(prev)
      if (newDraft.trim() === '') {
        map.delete(currentId)
      } else {
        map.set(currentId, newDraft)
      }
      return map
    })
  }
)
