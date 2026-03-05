/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { AgentSessionMeta, AgentMessage, AgentEvent, AgentWorkspace, AgentPendingFile, RetryAttempt, PromaPermissionMode, PermissionRequest, AskUserRequest, ThinkingConfig, AgentEffort, TaskUsage, AgentTeamData } from '@proma/shared'

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

/** 子代理条目（从 ToolActivity 派生，用于侧面板展示 — TODO: 完善 Team UI 时启用） */
export interface SubAgentEntry {
  toolUseId: string
  toolName: 'Task' | 'Agent'
  subagentType?: string
  description: string
  teamName?: string
  status: ActivityStatus
  elapsedSeconds?: number
  isBackground?: boolean
  taskId?: string
  childActivities: ToolActivity[]
}

/** Teammate 状态枚举 */
export type TeammateStatus = 'running' | 'completed' | 'failed' | 'stopped'

/** 单个 teammate 的实时状态（Agent Teams 功能） */
export interface TeammateState {
  /** SDK task_id */
  taskId: string
  /** 关联的 tool_use_id（Task 工具调用 ID） */
  toolUseId?: string
  /** 任务描述（spawn 时 Claude 给出的说明） */
  description: string
  /** 任务类型（SDK 内部类型，如 in_process_teammate） */
  taskType?: string
  /** 在当前对话中的序号（从 1 开始） */
  index: number
  /** 当前状态 */
  status: TeammateStatus
  /** 最近一次 task_progress 的描述（实时思考内容） */
  progressDescription?: string
  /** 当前正在运行的工具名 */
  currentToolName?: string
  /** 当前工具已运行秒数 */
  currentToolElapsedSeconds?: number
  /** 当前工具 toolUseId */
  currentToolUseId?: string
  /** 已使用的工具历史记录（最近 N 个，去重） */
  toolHistory: string[]
  /** 完成时的摘要 */
  summary?: string
  /** 完成时输出文件路径 */
  outputFile?: string
  /** 累计用量 */
  usage?: TaskUsage
  /** 开始时间戳 */
  startedAt: number
  /** 结束时间戳 */
  endedAt?: number
}

/** 工具历史最大记录数 */
const MAX_TOOL_HISTORY = 20

/** 侧面板活跃 Tab */
export type SidePanelTab = 'team' | 'files'

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
  /** Agent Teams: teammate 状态列表 */
  teammates: TeammateState[]
  /** 是否等待 auto-resume（teammate 结果收集中） */
  waitingResume?: boolean
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

/**
 * 从 ToolActivity[] 构建 SubAgentEntry[]
 *
 * 将 Task/Agent 提取为顶层条目，
 * 其子活动（parentToolUseId 匹配）嵌套在 childActivities 中。
 */
export function buildTeamActivityEntries(activities: ToolActivity[]): SubAgentEntry[] {
  const subAgentIds = new Set<string>()
  const entries: SubAgentEntry[] = []

  // 第一遍：收集所有 Task/Agent 的 toolUseId
  for (const a of activities) {
    if (a.toolName === 'Task' || a.toolName === 'Agent') {
      subAgentIds.add(a.toolUseId)
    }
  }

  if (subAgentIds.size === 0) return []

  // 第二遍：按 parentToolUseId 分组子活动
  const childrenMap = new Map<string, ToolActivity[]>()
  for (const a of activities) {
    if (a.parentToolUseId && subAgentIds.has(a.parentToolUseId)) {
      const children = childrenMap.get(a.parentToolUseId) ?? []
      children.push(a)
      childrenMap.set(a.parentToolUseId, children)
    }
  }

  // 第三遍：构建 SubAgentEntry
  for (const a of activities) {
    if (a.toolName !== 'Task' && a.toolName !== 'Agent') continue

    const description = typeof a.input.description === 'string'
      ? a.input.description
      : typeof a.input.prompt === 'string'
        ? a.input.prompt
        : a.intent ?? a.toolName

    entries.push({
      toolUseId: a.toolUseId,
      toolName: a.toolName as 'Task' | 'Agent',
      subagentType: typeof a.input.subagent_type === 'string' ? a.input.subagent_type : undefined,
      description,
      teamName: typeof a.input.team_name === 'string' ? a.input.team_name : undefined,
      status: getActivityStatus(a),
      elapsedSeconds: a.elapsedSeconds,
      isBackground: a.isBackground,
      taskId: a.taskId,
      childActivities: childrenMap.get(a.toolUseId) ?? [],
    })
  }

  return entries
}

// ============================================================================
// Team Overview — 从 ToolActivity 提取丰富的团队信息
// ============================================================================

/** 团队全景信息（从工具调用事件提取） */
export interface TeamOverview {
  /** 团队名称（来自 TeamCreate） */
  teamName?: string
  /** 团队描述 */
  teamDescription?: string
  /** 任务看板项（来自 TaskCreate + TaskUpdate） */
  tasks: TeamTaskItem[]
  /** Agent 条目（来自 Agent tool_start） */
  agents: TeamAgentInfo[]
}

/** 团队任务项 */
export interface TeamTaskItem {
  /** 任务编号（从 result 中解析） */
  taskNumber?: string
  /** 任务主题 */
  subject: string
  /** 任务描述 */
  description?: string
  /** 进行中标签 */
  activeForm?: string
  /** 被哪些任务阻塞 */
  blockedBy: string[]
  /** 状态（来自 TaskUpdate） */
  status?: string
  /** 工具调用 ID */
  toolUseId: string
}

/** 团队 Agent 条目 */
export interface TeamAgentInfo {
  /** Agent 名称 */
  name: string
  /** 描述/角色 */
  description: string
  /** 所属团队 */
  teamName?: string
  /** Agent 类型 */
  subagentType?: string
  /** 是否后台运行 */
  isBackground?: boolean
  /** 对应的 toolUseId */
  toolUseId: string
  /** Agent 工具状态 */
  status: ActivityStatus
  /** 关联的 TeammateState（通过 toolUseId 匹配） */
  teammate?: TeammateState
}

/**
 * 从 ToolActivity[] 和 TeammateState[] 提取团队全景信息
 *
 * 解析 TeamCreate、TaskCreate、TaskUpdate、Agent 工具调用，
 * 构建团队名称 + Task Board + Agent 列表。
 */
export function extractTeamOverview(
  activities: ToolActivity[],
  teammates: TeammateState[],
): TeamOverview | null {
  let teamName: string | undefined
  let teamDescription: string | undefined
  const tasks: TeamTaskItem[] = []
  const agents: TeamAgentInfo[] = []

  // 按 toolUseId 建立 TeammateState 快速查找表
  const teammateByToolUseId = new Map<string, TeammateState>()
  for (const tm of teammates) {
    if (tm.toolUseId) teammateByToolUseId.set(tm.toolUseId, tm)
  }

  for (const a of activities) {
    switch (a.toolName) {
      case 'TeamCreate': {
        if (typeof a.input.team_name === 'string') teamName = a.input.team_name
        if (typeof a.input.description === 'string') teamDescription = a.input.description
        break
      }

      case 'TaskCreate': {
        const subject = typeof a.input.subject === 'string' ? a.input.subject : ''
        if (!subject) break
        // 从 result 中解析任务编号（如 "Task #1 created successfully"）
        let taskNumber: string | undefined
        if (a.result) {
          const match = a.result.match(/(?:Task\s+)?#(\d+)/i)
          if (match) taskNumber = match[1]
        }
        tasks.push({
          taskNumber,
          subject,
          description: typeof a.input.description === 'string' ? a.input.description : undefined,
          activeForm: typeof a.input.activeForm === 'string' ? a.input.activeForm : undefined,
          blockedBy: [],
          toolUseId: a.toolUseId,
        })
        break
      }

      case 'TaskUpdate': {
        const taskId = typeof a.input.taskId === 'string' ? a.input.taskId : undefined
        if (!taskId) break
        // 找到匹配的 task，合并数据
        const task = tasks.find((t) => t.taskNumber === taskId)
        if (task) {
          if (Array.isArray(a.input.addBlockedBy)) {
            for (const dep of a.input.addBlockedBy) {
              if (typeof dep === 'string' && !task.blockedBy.includes(dep)) {
                task.blockedBy.push(dep)
              }
            }
          }
          if (typeof a.input.status === 'string') {
            task.status = a.input.status
          }
        }
        break
      }

      case 'Agent': {
        const name = typeof a.input.name === 'string' ? a.input.name : ''
        const desc = typeof a.input.description === 'string'
          ? a.input.description
          : typeof a.input.prompt === 'string'
            ? a.input.prompt
            : ''
        if (!name && !desc) break
        agents.push({
          name: name || 'Agent',
          description: desc,
          teamName: typeof a.input.team_name === 'string' ? a.input.team_name : undefined,
          subagentType: typeof a.input.subagent_type === 'string' ? a.input.subagent_type : undefined,
          isBackground: a.input.run_in_background === true,
          toolUseId: a.toolUseId,
          status: getActivityStatus(a),
          teammate: teammateByToolUseId.get(a.toolUseId),
        })
        break
      }

      default:
        break
    }
  }

  // 无任何团队信息则返回 null
  if (!teamName && tasks.length === 0 && agents.length === 0) return null

  return { teamName, teamDescription, tasks, agents }
}

/**
 * 从持久化消息中重建 Team 数据
 *
 * 页面刷新后，从 JSONL 加载的 AgentMessage.events 中提取
 * ToolActivity[] 和 TeammateState[]，用于填充缓存 atoms。
 */
export function rebuildTeamDataFromMessages(messages: AgentMessage[]): {
  toolActivities: ToolActivity[]
  teammates: TeammateState[]
  overview: TeamOverview | null
} | null {
  // 收集所有 assistant 消息中的 events
  const allEvents: AgentEvent[] = []
  for (const msg of messages) {
    if (msg.events) allEvents.push(...msg.events)
  }
  if (allEvents.length === 0) return null

  // 重建 ToolActivity[]
  const toolActivities: ToolActivity[] = []
  for (const event of allEvents) {
    if (event.type === 'tool_start') {
      toolActivities.push({
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        input: event.input ?? {},
        intent: event.intent,
        displayName: event.displayName,
        done: false,
        parentToolUseId: event.parentToolUseId,
      })
    } else if (event.type === 'tool_result') {
      const idx = toolActivities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        toolActivities[idx] = {
          ...toolActivities[idx]!,
          result: event.result,
          isError: event.isError,
          done: true,
        }
      }
    }
  }

  // 重建 TeammateState[]
  const teammates: TeammateState[] = []
  for (const event of allEvents) {
    if (event.type === 'task_started') {
      teammates.push({
        taskId: event.taskId,
        toolUseId: event.toolUseId,
        description: event.description,
        taskType: event.taskType,
        index: teammates.length + 1,
        status: 'running',
        toolHistory: [],
        startedAt: Date.now(),
      })
    } else if (event.type === 'task_progress' && event.taskId) {
      const idx = teammates.findIndex((t) => t.taskId === event.taskId)
      if (idx >= 0) {
        const tm = teammates[idx]!
        teammates[idx] = {
          ...tm,
          progressDescription: event.description ?? tm.progressDescription,
          usage: event.usage ?? tm.usage,
          ...(event.lastToolName && {
            currentToolName: event.lastToolName,
            currentToolElapsedSeconds: event.elapsedSeconds,
            toolHistory: appendToolHistory(tm.toolHistory, event.lastToolName),
          }),
        }
      }
    } else if (event.type === 'task_notification') {
      const idx = teammates.findIndex((t) => t.taskId === event.taskId)
      if (idx >= 0) {
        const tm = teammates[idx]!
        teammates[idx] = {
          ...tm,
          status: event.status,
          summary: event.summary,
          outputFile: event.outputFile,
          endedAt: Date.now(),
          ...(event.usage && { usage: event.usage }),
          currentToolName: undefined,
          currentToolElapsedSeconds: undefined,
          currentToolUseId: undefined,
        }
      }
    }
  }

  // 检查是否有团队活动
  const hasTeamActivity = toolActivities.some((a) =>
    a.toolName === 'TeamCreate' || a.toolName === 'TaskCreate' ||
    a.toolName === 'Agent' || a.toolName === 'Task',
  ) || teammates.length > 0

  if (!hasTeamActivity) return null

  const overview = extractTeamOverview(toolActivities, teammates)
  return { toolActivities, teammates, overview }
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

// ===== 侧面板 Atoms =====

/** 侧面板是否打开（per-session Map） */
export const agentSidePanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 侧面板当前活跃 Tab（per-session Map） */
export const agentSidePanelTabMapAtom = atom<Map<string, SidePanelTab>>(new Map())

/**
 * Team 活动缓存 — 以 sessionId 为 key
 *
 * 流式完成后 agentStreamingStatesAtom 会被清除，
 * 此缓存在清除前保存 Team 活动数据，确保面板内容不丢失。
 */
export const cachedTeamActivitiesAtom = atom<Map<string, SubAgentEntry[]>>(new Map())

/**
 * Teammate 状态缓存 — 以 sessionId 为 key
 *
 * 流式完成后保存 teammates 快照，确保切换会话后面板数据不丢失。
 */
export const cachedTeammateStatesAtom = atom<Map<string, TeammateState[]>>(new Map())

/**
 * TeamOverview 缓存 — 以 sessionId 为 key
 *
 * 流式完成后保存 TeamOverview 快照，确保切换 tab 后团队全景数据不丢失。
 */
export const cachedTeamOverviewsAtom = atom<Map<string, TeamOverview>>(new Map())

/**
 * 轮询数据缓存 — 以 sessionId 为 key
 *
 * 缓存文件系统轮询得到的 AgentTeamData（tasks + inboxes），
 * 防止组件卸载后通信时间线等数据丢失。
 */
export const cachedPolledTeamDataAtom = atom<Map<string, AgentTeamData>>(new Map())

/**
 * 已关闭 Team 面板的 sessionId 集合
 *
 * 用户主动关闭 Team 活动面板后，阻止 derived atoms 返回数据。
 * 当新一轮流式请求开始时自动清除（允许新 Team 数据显示）。
 */
export const dismissedTeamSessionIdsAtom = atom<Set<string>>(new Set<string>())

/** 当前会话是否有 Team/Task 活动（派生只读原子，同时检查流式状态和缓存） */
export const hasTeamActivityAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return false
  // 优先检查流式状态
  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state) {
    const hasActivity = state.toolActivities.some(
      (a) => a.toolName === 'Task' || a.toolName === 'Agent'
    )
    if (hasActivity) return true
  }
  // 回退到缓存（流式状态无 Team 活动或不存在时）
  const cached = get(cachedTeamActivitiesAtom).get(currentId)
  return cached !== undefined && cached.length > 0
})

/** 当前会话的 Team 活动数据（派生只读原子，同时读取流式状态和缓存） */
export const teamActivityEntriesAtom = atom<SubAgentEntry[]>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return []
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return []
  // 优先使用流式状态
  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state && state.toolActivities.length > 0) {
    const entries = buildTeamActivityEntries(state.toolActivities)
    if (entries.length > 0) return entries
  }
  // 回退到缓存
  return get(cachedTeamActivitiesAtom).get(currentId) ?? []
})

/** 运行中的子代理数量（用于 badge 指示器） */
export const teamActivityCountAtom = atom<number>((get) => {
  const entries = get(teamActivityEntriesAtom)
  return entries.filter((e) => e.status === 'running' || e.status === 'backgrounded').length
})

/** 当前会话的 teammate 状态列表（派生只读原子，优先流式状态，回退缓存） */
export const teammateStatesAtom = atom<TeammateState[]>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return []
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return []
  // 优先使用流式状态中的 teammates
  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state && state.teammates.length > 0) return state.teammates
  // 回退到缓存
  return get(cachedTeammateStatesAtom).get(currentId) ?? []
})

/** 是否有 teammate 活动（综合检查流式状态和缓存） */
export const hasTeammatesAtom = atom<boolean>((get) => {
  return get(teammateStatesAtom).length > 0
})

/** 运行中的 teammate 数量 */
export const runningTeammateCountAtom = atom<number>((get) => {
  return get(teammateStatesAtom).filter((t) => t.status === 'running').length
})

/** 团队全景信息（派生只读原子，从 toolActivities + teammates 提取，回退到缓存） */
export const teamOverviewAtom = atom<TeamOverview | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  if (get(dismissedTeamSessionIdsAtom).has(currentId)) return null
  const state = get(agentStreamingStatesAtom).get(currentId)
  if (state) {
    const overview = extractTeamOverview(state.toolActivities, state.teammates)
    if (overview) return overview
  }
  // 回退到缓存（流式状态无 Team 数据或不存在时）
  return get(cachedTeamOverviewsAtom).get(currentId) ?? null
})

// ===== 权限系统 Atoms =====

/** 当前工作区权限模式 */
export const agentPermissionModeAtom = atom<PromaPermissionMode>('smart')

/** Agent 思考模式 */
export const agentThinkingAtom = atom<ThinkingConfig | undefined>(undefined)

/** Agent 推理深度 */
export const agentEffortAtom = atom<AgentEffort | undefined>(undefined)

/** Agent 最大预算（美元/次） */
export const agentMaxBudgetUsdAtom = atom<number | undefined>(undefined)

/** Agent 最大轮次 */
export const agentMaxTurnsAtom = atom<number | undefined>(undefined)

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
 * 追加工具名到历史记录（不可变版本）
 * 相同工具不连续重复，超出上限则删除最旧的
 */
function appendToolHistory(history: string[], toolName: string): string[] {
  if (history[history.length - 1] === toolName) return history
  const next = [...history, toolName]
  return next.length > MAX_TOOL_HISTORY ? next.slice(next.length - MAX_TOOL_HISTORY) : next
}

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
      // 用完整文本替换增量累积的文本（用于回放场景：只需 text_complete 即可重建文本状态）
      return { ...prev, content: event.text }

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
      // Teams 级别的 teammate 进度（带 taskId）
      if (event.taskId) {
        const tmIdx = prev.teammates.findIndex((t) => t.taskId === event.taskId)
        if (tmIdx >= 0) {
          const tm = prev.teammates[tmIdx]!
          const updatedTm: TeammateState = {
            ...tm,
            progressDescription: event.description ?? tm.progressDescription,
            usage: event.usage ?? tm.usage,
            // 更新当前工具名和计时（来自 tool_progress 或 system task_progress）
            ...(event.lastToolName && {
              currentToolName: event.lastToolName,
              currentToolElapsedSeconds: event.elapsedSeconds ?? tm.currentToolElapsedSeconds,
              currentToolUseId: event.toolUseId,
              toolHistory: appendToolHistory(tm.toolHistory, event.lastToolName),
            }),
            // 无 lastToolName 但有真实 elapsedSeconds 时仅更新计时
            ...(!event.lastToolName && event.elapsedSeconds != null && {
              currentToolElapsedSeconds: event.elapsedSeconds,
            }),
            // 主对话仍在运行时，收到进度说明 teammate 实际仍在工作，重置 stopped/failed
            // 主对话已结束时（running: false），不重置（防止建议信息等后续事件错误唤醒）
            ...(prev.running && (tm.status === 'stopped' || tm.status === 'failed')
              ? { status: 'running' as const, endedAt: undefined }
              : {}),
          }
          const nextTeammates = [...prev.teammates]
          nextTeammates[tmIdx] = updatedTm
          return { ...prev, teammates: nextTeammates }
        }
      }
      // 普通 tool 计时语义（仅当有真实 elapsedSeconds 时更新）
      if (event.elapsedSeconds != null) {
        return {
          ...prev,
          toolActivities: prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, elapsedSeconds: event.elapsedSeconds! }
              : t
          ),
        }
      }
      return prev

    case 'task_started': {
      // 查找匹配 toolUseId 的 ToolActivity，更新 intent 和 taskId
      let nextActivities = prev.toolActivities
      if (event.toolUseId) {
        const idx = prev.toolActivities.findIndex((t) => t.toolUseId === event.toolUseId)
        if (idx >= 0) {
          nextActivities = prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, intent: event.description, taskId: event.taskId }
              : t
          )
        }
      }
      // 去重：已有同 taskId 的 teammate 时仅更新 activities
      if (prev.teammates.some((t) => t.taskId === event.taskId)) {
        return { ...prev, toolActivities: nextActivities }
      }
      // 创建 TeammateState
      const newTeammate: TeammateState = {
        taskId: event.taskId,
        toolUseId: event.toolUseId,
        description: event.description,
        taskType: event.taskType,
        index: prev.teammates.length + 1,
        status: 'running',
        toolHistory: [],
        startedAt: Date.now(),
      }
      return {
        ...prev,
        toolActivities: nextActivities,
        teammates: [...prev.teammates, newTeammate],
      }
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

    case 'task_notification': {
      // Agent Teams: teammate 完成/失败/停止
      const nextTeammates = [...prev.teammates]
      let tmIdx = nextTeammates.findIndex((t) => t.taskId === event.taskId)
      if (tmIdx < 0) {
        // task_started 丢失时的兜底：从 notification 补创 teammate
        nextTeammates.push({
          taskId: event.taskId,
          toolUseId: event.toolUseId,
          description: event.summary || event.taskId,
          index: nextTeammates.length + 1,
          status: 'running',
          toolHistory: [],
          startedAt: Date.now(),
        })
        tmIdx = nextTeammates.length - 1
      }
      nextTeammates[tmIdx] = {
        ...nextTeammates[tmIdx]!,
        status: event.status,
        summary: event.summary,
        outputFile: event.outputFile,
        endedAt: Date.now(),
        ...(event.usage && { usage: event.usage }),
        // 任务结束后清除实时工具状态
        currentToolName: undefined,
        currentToolElapsedSeconds: undefined,
        currentToolUseId: undefined,
      }
      return { ...prev, teammates: nextTeammates }
    }

    case 'tool_use_summary':
      // 工具使用摘要 — 目前不影响流式状态，仅用于 UI 展示
      return prev

    case 'waiting_resume':
      return { ...prev, waitingResume: true }

    case 'resume_start':
      return { ...prev, waitingResume: false }

    case 'complete':
      // 成功完成 — 清除 retrying，但保持 running: true
      // 等待 STREAM_COMPLETE IPC 回调通过删除流式状态来控制 UI 就绪状态
      // 这避免了用户在后端尚未完成清理时就能发送新消息的竞态条件
      // 同时将仍 running 的 teammates 标记为 stopped（兜底）
      return {
        ...prev,
        retrying: undefined,
        teammates: prev.teammates.map((tm) =>
          tm.status === 'running'
            ? { ...tm, status: 'stopped' as const, endedAt: Date.now(), currentToolName: undefined, currentToolElapsedSeconds: undefined, currentToolUseId: undefined }
            : tm
        ),
      }

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

    case 'prompt_suggestion':
      // 提示建议由全局监听器处理，不影响流式状态
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

/**
 * Agent 消息刷新版本 Map — 以 sessionId 为 key
 * 全局监听器在流式完成/错误时递增版本号，
 * AgentView 监听版本号变化来重新加载消息。
 */
export const agentMessageRefreshAtom = atom<Map<string, number>>(new Map())

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

/**
 * 会话附加目录 Map — 以 sessionId 为 key
 * 存储每个会话通过"附加文件夹"功能关联的外部目录路径列表。
 * 这些路径作为 SDK additionalDirectories 参数传递。
 */
export const agentAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

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

// ===== 提示建议 Atoms =====

/** Agent 提示建议 Map — 以 sessionId 为 key，存储最近一条建议 */
export const agentPromptSuggestionsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的提示建议（派生只读原子） */
export const currentAgentSuggestionAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentPromptSuggestionsAtom).get(currentId) ?? null
})

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
