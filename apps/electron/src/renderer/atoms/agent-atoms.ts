/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { AgentSessionMeta, AgentMessage, AgentEvent, AgentWorkspace, AgentPendingFile, RetryAttempt, PromaPermissionMode, PermissionRequest, AskUserRequest } from '@proma/shared'

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
  /** 流式开始时间戳（用于思考计时持久化） */
  startedAt?: number
  /** 重试状态（扩展版） */
  retrying?: {
    /** 当前第几次尝试 */
    currentAttempt: number
    /** 最大尝试次数 */
    maxAttempts: number
    /** 重试历史记录（按时间顺序） */
    history: RetryAttempt[]
    /** 是否已失败 */
    failed: boolean
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

  const latest = todoWrites[todoWrites.length - 1]!
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

// ===== 权限系统 Atoms =====

/** 当前工作区权限模式 */
export const agentPermissionModeAtom = atom<PromaPermissionMode>('smart')

/** 待处理的权限请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingPermissionRequestsAtom = atom<Map<string, readonly PermissionRequest[]>>(new Map())

type PermissionRequestsUpdate = readonly PermissionRequest[] | ((prev: readonly PermissionRequest[]) => readonly PermissionRequest[])

/** 当前会话的权限请求队列（派生读写原子） */
export const pendingPermissionRequestsAtom = atom(
  (get): readonly PermissionRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingPermissionRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: PermissionRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingPermissionRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

/** 待处理的 AskUser 请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingAskUserRequestsAtom = atom<Map<string, readonly AskUserRequest[]>>(new Map())

type AskUserRequestsUpdate = readonly AskUserRequest[] | ((prev: readonly AskUserRequest[]) => readonly AskUserRequest[])

/** 当前会话的 AskUser 请求队列（派生读写原子） */
export const pendingAskUserRequestsAtom = atom(
  (get): readonly AskUserRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingAskUserRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: AskUserRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingAskUserRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

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

export const agentStartedAtAtom = atom<number | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.startedAt
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
            ? { ...t, isBackground: true, taskId: event.taskId, done: true }
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
            ? { ...t, isBackground: true, shellId: event.shellId, done: true }
            : t
        ),
      }

    case 'shell_killed':
      return prev

    case 'complete':
      // 成功完成 - 清除 retrying
      return { ...prev, running: false, retrying: undefined }

    case 'typed_error':
      // 处理类型化错误（TypedError）
      // 停止运行，清除重试状态
      return { ...prev, running: false, retrying: undefined }

    case 'error':
      // 改进：error 事件不再清除 retrying 状态
      // retrying 状态由专用事件控制
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
      // 向后兼容：保留原有的简单 retrying 事件
      return {
        ...prev,
        retrying: prev.retrying ?? {
          currentAttempt: event.attempt,
          maxAttempts: event.maxAttempts,
          history: [],
          failed: false,
        },
      }

    case 'retry_attempt': {
      // 新增：记录详细的重试尝试
      const currentHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        retrying: {
          currentAttempt: event.attemptData.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: [...currentHistory, event.attemptData],
          failed: false,
        },
      }
    }

    case 'retry_cleared':
      // 新增：重试成功，清除状态
      return { ...prev, retrying: undefined }

    case 'retry_failed': {
      // 新增：重试失败，标记为 failed 但保留历史
      const finalHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        running: false,
        retrying: {
          currentAttempt: event.finalAttempt.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: [...finalHistory, event.finalAttempt],
          failed: true,
        },
      }
    }

    case 'permission_request':
      // 权限请求事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'permission_resolved':
      // 权限解决事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'ask_user_request':
      // AskUser 请求事件由 AskUserBanner 处理，不影响流式状态
      return prev

    case 'ask_user_resolved':
      // AskUser 解决事件由 AskUserBanner 处理，不影响流式状态
      return prev

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
export const currentAgentSessionDraftAtom = atom(
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

// ===== 后台任务管理 =====

/**
 * 后台任务数据结构
 *
 * 用于 ActiveTasksBar 显示运行中的 Agent 任务和 Shell 任务。
 */
export interface BackgroundTask {
  /** 任务或 Shell ID */
  id: string
  /** 任务类型 */
  type: 'agent' | 'shell'
  /** 关联的工具调用 ID（用于滚动定位到 ToolActivityItem） */
  toolUseId: string
  /** 任务开始时间戳 */
  startTime: number
  /** 已耗时（秒） */
  elapsedSeconds: number
  /** 任务意图/描述 */
  intent?: string
}

/**
 * 后台任务列表原子家族
 *
 * 按 sessionId 隔离，每个会话独立管理后台任务。
 * 任务完成后从列表中移除（只显示运行中任务）。
 */
export const backgroundTasksAtomFamily = atomFamily((sessionId: string) =>
  atom<BackgroundTask[]>([])
)
