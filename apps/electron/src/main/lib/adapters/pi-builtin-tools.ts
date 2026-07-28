/**
 * Pi Runtime 内置 MCP 工具桥接层
 *
 * Claude SDK 用 sdk.createSdkMcpServer() + Zod schema 注册 MCP 工具；
 * Pi SDK 用 sdk.defineTool() + TypeBox schema 注册 customTools。
 *
 * 本模块复用底层 service 函数（automation-manager、collaboration 等），
 * 用 Pi ToolDefinition 格式暴露相同的业务能力，避免 Pi runtime 下这些工具缺失。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { AgentRuntime, PromaPermissionMode } from '@proma/shared'
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@proma/shared'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  updateAutomation,
} from '../automation-manager'
import {
  broadcastChanged as broadcastAutomationsChanged,
  runAutomationNow,
} from '../automation-scheduler'
import { getAgentSessionMeta } from '../agent-session-manager'
import { isBuiltinMcpUserEnabled } from '../builtin-mcp/settings'
import { buildPiCollaborationTools } from '../agent-collaboration-tools'
import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  touchTodoSession,
  listCalendarEvents,
  getCalendarEvent,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listPlanningGroups,
  createPlanningGroup,
  updatePlanningGroup,
  deletePlanningGroup,
  listPlanningTags,
  createPlanningTag,
  updatePlanningTag,
  deletePlanningTag,
  listActivePlanningReminders,
  createPlanningReminder,
  updatePlanningReminder,
  deletePlanningReminder,
  acknowledgePlanningReminder,
  snoozePlanningReminder,
} from '../planning-manager'
import { broadcastPlanningAgentOperation, broadcastPlanningChanged } from '../planning-events'
import {
  fetchWebPage,
  formatFetchResults,
  formatSearchResults,
  isWebSearchEnabledForAgent,
  searchWeb,
} from '../web-search-service'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

// ===== 通用 =====

export interface PiBuiltinToolsContext {
  sessionId: string
  channelId: string
  modelId?: string
  agentRuntime?: AgentRuntime
  workspaceId?: string
  workspaceSlug?: string
  permissionMode?: PromaPermissionMode
  triggeredBy?: 'user' | 'automation' | 'delegation'
}

function jsonToolResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    details: payload,
  } as AgentToolResult<unknown>
}

function textToolResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details,
  } as AgentToolResult<unknown>
}

// ===== Web 工具 =====

type WebSearchDepth = 'basic' | 'advanced'

function isWebSearchDepth(value: unknown): value is WebSearchDepth {
  return value === 'basic' || value === 'advanced'
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => String(item).trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function assertPlanningDeleteAllowed(ctx: PiBuiltinToolsContext): void {
  if (ctx.triggeredBy === 'automation' || ctx.triggeredBy === 'delegation') {
    throw new Error('定时任务和协作子 Agent 不能删除本地规划数据，请由用户主会话发起并确认。')
  }
}

/** Agent 未明确完成时间时，Todo 默认以本地当天为计划单位。 */
function defaultTodoDueAt(): number {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function buildWebTools(sdk: PiSdk): ToolDefinition[] {
  return [
    sdk.defineTool({
      name: 'WebSearch',
      label: '搜索网页',
      description: 'Search the web for up-to-date information through Proma\'s Tavily integration. Use for current events, recent data, facts that may be stale, or when the user explicitly asks to search.',
      promptSnippet: 'WebSearch: search the web for current information and cite source URLs in the final answer.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query. Keep it concise and avoid including private local file contents, API keys, tokens, or secrets.' }),
        maxResults: Type.Optional(Type.Number({ description: 'Maximum number of results to return. Default 5, max 10.' })),
        searchDepth: Type.Optional(Type.Union([Type.Literal('basic'), Type.Literal('advanced')], { description: 'Search depth. Use basic by default; advanced costs more but may improve recall.' })),
        includeDomains: Type.Optional(Type.Array(Type.String({ description: 'Domain to include, e.g. example.com' }), { description: 'Optional allowlist of domains.' })),
        excludeDomains: Type.Optional(Type.Array(Type.String({ description: 'Domain to exclude, e.g. example.com' }), { description: 'Optional blocklist of domains.' })),
      }),
      async execute(_toolCallId, params, signal) {
        const args = params as Record<string, unknown>
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) throw new Error('query 必填')
        const result = await searchWeb({
          query,
          maxResults: numberOrUndefined(args.maxResults),
          searchDepth: isWebSearchDepth(args.searchDepth) ? args.searchDepth : undefined,
          includeDomains: stringArray(args.includeDomains),
          excludeDomains: stringArray(args.excludeDomains),
          signal,
        })
        return textToolResult(formatSearchResults(result), result)
      },
    }),
    sdk.defineTool({
      name: 'WebFetch',
      label: '抓取网页',
      description: 'Fetch and extract readable Markdown content from a URL through Proma\'s Tavily integration. Use after WebSearch or when the user gives a URL and asks to inspect page content.',
      promptSnippet: 'WebFetch: fetch readable webpage content by URL. Use it to inspect source pages and cite URLs.',
      parameters: Type.Object({
        url: Type.String({ description: 'HTTP/HTTPS URL to fetch.' }),
        prompt: Type.Optional(Type.String({ description: 'Optional extraction focus or question. Use when only part of a page is relevant.' })),
        extractDepth: Type.Optional(Type.Union([Type.Literal('basic'), Type.Literal('advanced')], { description: 'Extraction depth. Use basic by default; advanced may handle difficult pages better.' })),
        maxChars: Type.Optional(Type.Number({ description: 'Maximum characters returned to the model. Default 20000.' })),
      }),
      async execute(_toolCallId, params, signal) {
        const args = params as Record<string, unknown>
        const url = typeof args.url === 'string' ? args.url.trim() : ''
        if (!url) throw new Error('url 必填')
        const maxChars = numberOrUndefined(args.maxChars)
        const result = await fetchWebPage({
          url,
          prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
          extractDepth: isWebSearchDepth(args.extractDepth) ? args.extractDepth : undefined,
          maxChars,
          signal,
        })
        return textToolResult(formatFetchResults(result, { maxChars }), result)
      },
    }),
  ] as unknown as ToolDefinition[]
}

// ===== Automation 工具 =====

function getCurrentAutomationId(ctx: PiBuiltinToolsContext): string | undefined {
  return getAgentSessionMeta(ctx.sessionId)?.sourceAutomationId
}

interface AutomationSummary {
  id: string
  name: string
  active: boolean
  scheduleType: string
  [key: string]: unknown
}

function summarizeAutomation(a: import('@proma/shared').Automation, includeHistory: boolean): AutomationSummary {
  return {
    id: a.id,
    name: a.name,
    active: a.active,
    scheduleType: a.scheduleType,
    intervalMinutes: a.intervalMinutes,
    timeOfDay: a.timeOfDay,
    dayOfWeek: a.dayOfWeek,
    dayOfMonth: a.dayOfMonth,
    scheduledAt: a.scheduledAt,
    maxRuns: a.maxRuns,
    runCount: a.runCount ?? 0,
    agentRuntime: a.agentRuntime ?? 'claude',
    completedAt: a.completedAt,
    sessionMode: a.sessionMode,
    workspaceId: a.workspaceId,
    sourceSessionId: a.sourceSessionId,
    lastSessionId: a.lastSessionId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    nextRunAt: a.nextRunAt,
    lastRunAt: a.lastRunAt,
    consecutiveFailures: a.consecutiveFailures ?? 0,
    prompt: a.prompt,
    ...(includeHistory && { runHistory: a.runHistory }),
  }
}

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
}

function assertNonBlank(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} 不能为空`)
  }
  return value.trim()
}

type AutomationScheduleType = 'interval' | 'daily' | 'weekly' | 'monthly' | 'once'

function validScheduleType(v: unknown): v is AutomationScheduleType {
  return v === 'interval' || v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'once'
}

function validateScheduleFields(input: Partial<CreateAutomationInput | UpdateAutomationInput>): void {
  if (input.scheduleType !== undefined && !validScheduleType(input.scheduleType)) {
    throw new Error(`非法的 scheduleType: ${String(input.scheduleType)}`)
  }
  if (input.intervalMinutes !== undefined && (!isFiniteInt(input.intervalMinutes) || input.intervalMinutes < 1)) {
    throw new Error(`非法的 intervalMinutes: ${String(input.intervalMinutes)}`)
  }
  if (input.timeOfDay !== undefined && !TIME_OF_DAY_PATTERN.test(input.timeOfDay)) {
    throw new Error(`非法的 timeOfDay: ${String(input.timeOfDay)}`)
  }
  if (input.dayOfWeek !== undefined && (!isFiniteInt(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
    throw new Error(`非法的 dayOfWeek: ${String(input.dayOfWeek)}`)
  }
  if (input.dayOfMonth !== undefined && (!isFiniteInt(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
    throw new Error(`非法的 dayOfMonth: ${String(input.dayOfMonth)}`)
  }
  if (input.scheduledAt !== undefined && (typeof input.scheduledAt !== 'number' || !Number.isFinite(input.scheduledAt) || input.scheduledAt <= 0)) {
    throw new Error(`非法的 scheduledAt: ${String(input.scheduledAt)}（应为毫秒时间戳）`)
  }
  if (input.maxRuns !== undefined && (!isFiniteInt(input.maxRuns) || input.maxRuns < 1)) {
    throw new Error(`非法的 maxRuns: ${String(input.maxRuns)}（应为 ≥1 的整数）`)
  }
  if (input.agentRuntime !== undefined && input.agentRuntime !== 'claude' && input.agentRuntime !== 'pi') {
    throw new Error(`非法的 agentRuntime: ${String(input.agentRuntime)}`)
  }
  if (input.sessionMode !== undefined && input.sessionMode !== 'daily' && input.sessionMode !== 'reuse') {
    throw new Error(`非法的 sessionMode: ${String(input.sessionMode)}`)
  }
}

function buildAutomationTools(sdk: PiSdk, ctx: PiBuiltinToolsContext): ToolDefinition[] {
  return [
    sdk.defineTool({
      name: 'mcp__automation__list_automations',
      label: '列出定时任务',
      description: '列出 Proma 持久化定时任务。用于查看已有长期反复任务、判断是否需要新建任务、检查运行状态和最近失败情况。',
      parameters: Type.Object({
        active: Type.Optional(Type.Boolean({ description: '只列出启用或暂停任务；不传则列出全部' })),
        includeHistory: Type.Optional(Type.Boolean({ description: '是否包含运行历史，默认 false' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { active?: boolean; includeHistory?: boolean }
        const items = listAutomations()
          .filter((a) => args.active === undefined || a.active === args.active)
          .map((a) => summarizeAutomation(a, args.includeHistory === true))
        return jsonToolResult({ automations: items })
      },
    }),
    sdk.defineTool({
      name: 'mcp__automation__get_automation',
      label: '查看定时任务',
      description: '读取单个 Proma 定时任务详情和运行记录。定时任务自动执行中可以省略 id 来读取当前任务，用于自检和自迭代。',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: '定时任务 ID；定时任务自动执行中可省略以读取当前任务' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { id?: string }
        const id = args.id?.trim() || getCurrentAutomationId(ctx)
        if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
        const automation = getAutomation(id)
        if (!automation) throw new Error(`定时任务不存在: ${id}`)
        return jsonToolResult({ automation: summarizeAutomation(automation, true) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__automation__create_automation',
      label: '创建定时任务',
      description: '创建 Proma 持久化定时任务。适合无人值守、有稳定价值的场景。纯提醒/闹钟、需要用户实时参与判断、或现在就该做完即终结的事不要创建。',
      parameters: Type.Object({
        name: Type.String({ description: '任务名，简短说明长期反复执行的目标' }),
        prompt: Type.String({ description: '每次触发时发送给 Agent 的完整自然语言指令' }),
        scheduleType: Type.Union([
          Type.Literal('interval'),
          Type.Literal('daily'),
          Type.Literal('weekly'),
          Type.Literal('monthly'),
          Type.Literal('once'),
        ], { description: '调度类型' }),
        intervalMinutes: Type.Optional(Type.Number({ description: '固定间隔分钟数；scheduleType=interval 时必填' })),
        timeOfDay: Type.Optional(Type.String({ description: '每天/每周/每月触发时间，24 小时制 HH:MM' })),
        dayOfWeek: Type.Optional(Type.Number({ description: '每周触发日，0=周日，...，6=周六' })),
        dayOfMonth: Type.Optional(Type.Number({ description: '每月触发日，1-31' })),
        scheduledAt: Type.Optional(Type.Number({ description: '一次性任务的绝对触发时间（毫秒时间戳）；scheduleType=once 时必填' })),
        maxRuns: Type.Optional(Type.Number({ description: '最大运行次数上限；达到后任务自动停用' })),
        active: Type.Optional(Type.Boolean({ description: '创建后是否启用，默认 true' })),
        agentRuntime: Type.Optional(Type.Union([Type.Literal('claude'), Type.Literal('pi')], { description: '运行该任务的 Agent runtime；不传则继承当前会话 runtime' })),
        sessionMode: Type.Optional(Type.Union([Type.Literal('daily'), Type.Literal('reuse')], { description: '会话模式' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as Record<string, unknown>
        if (ctx.triggeredBy === 'automation' || getCurrentAutomationId(ctx)) {
          throw new Error('当前是定时任务自动执行，禁止递归创建新的定时任务')
        }
        const input: CreateAutomationInput = {
          name: assertNonBlank(args.name as string, 'name'),
          prompt: assertNonBlank(args.prompt as string, 'prompt'),
          scheduleType: args.scheduleType as AutomationScheduleType,
          intervalMinutes: (args.intervalMinutes as number) ?? 10,
          timeOfDay: args.timeOfDay as string | undefined,
          dayOfWeek: args.dayOfWeek as number | undefined,
          dayOfMonth: args.dayOfMonth as number | undefined,
          scheduledAt: args.scheduledAt as number | undefined,
          maxRuns: args.maxRuns as number | undefined,
          agentRuntime: (args.agentRuntime as AgentRuntime | undefined) ?? ctx.agentRuntime,
          channelId: ctx.channelId,
          modelId: ctx.modelId,
          workspaceId: ctx.workspaceId,
          sessionMode: args.sessionMode as 'daily' | 'reuse' | undefined,
          sourceSessionId: ctx.sessionId,
          active: (args.active as boolean) ?? true,
        }
        validateScheduleFields(input)
        if (input.scheduleType === 'interval' && args.intervalMinutes === undefined) {
          throw new Error('scheduleType=interval 时 intervalMinutes 必填')
        }
        if ((input.scheduleType === 'daily' || input.scheduleType === 'weekly' || input.scheduleType === 'monthly') && !input.timeOfDay) {
          throw new Error('scheduleType=daily/weekly/monthly 时 timeOfDay 必填')
        }
        if (input.scheduleType === 'weekly' && input.dayOfWeek === undefined) {
          throw new Error('scheduleType=weekly 时 dayOfWeek 必填')
        }
        if (input.scheduleType === 'monthly' && input.dayOfMonth === undefined) {
          throw new Error('scheduleType=monthly 时 dayOfMonth 必填')
        }
        if (input.scheduleType === 'once' && input.scheduledAt === undefined) {
          throw new Error('scheduleType=once 时 scheduledAt（绝对触发时间戳）必填')
        }
        const automation = createAutomation(input)
        broadcastAutomationsChanged()
        return jsonToolResult({ automation: summarizeAutomation(automation, true) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__automation__update_automation',
      label: '修改定时任务',
      description: '修改 Proma 定时任务，包括名称、执行提示词、频率和启用状态。定时任务自动执行中可以省略 id 来修改当前任务。',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: '定时任务 ID；定时任务自动执行中可省略以更新当前任务' })),
        name: Type.Optional(Type.String({ description: '新的任务名' })),
        prompt: Type.Optional(Type.String({ description: '新的执行提示词' })),
        scheduleType: Type.Optional(Type.Union([
          Type.Literal('interval'),
          Type.Literal('daily'),
          Type.Literal('weekly'),
          Type.Literal('monthly'),
          Type.Literal('once'),
        ])),
        intervalMinutes: Type.Optional(Type.Number({ description: '新的固定间隔分钟数' })),
        timeOfDay: Type.Optional(Type.String({ description: '新的每天/每周/每月触发时间' })),
        dayOfWeek: Type.Optional(Type.Number({ description: '新的每周触发日' })),
        dayOfMonth: Type.Optional(Type.Number({ description: '新的每月触发日' })),
        scheduledAt: Type.Optional(Type.Number({ description: '新的一次性触发时间（毫秒时间戳）' })),
        maxRuns: Type.Optional(Type.Number({ description: '新的最大运行次数上限' })),
        active: Type.Optional(Type.Boolean({ description: '启用或暂停任务' })),
        agentRuntime: Type.Optional(Type.Union([Type.Literal('claude'), Type.Literal('pi')], { description: '新的 Agent runtime' })),
        sessionMode: Type.Optional(Type.Union([Type.Literal('daily'), Type.Literal('reuse')])),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as Record<string, unknown>
        const id = (args.id as string)?.trim() || getCurrentAutomationId(ctx)
        if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
        const input: UpdateAutomationInput = {
          id,
          name: (args.name as string)?.trim(),
          prompt: (args.prompt as string)?.trim(),
          scheduleType: args.scheduleType as AutomationScheduleType | undefined,
          intervalMinutes: args.intervalMinutes as number | undefined,
          timeOfDay: args.timeOfDay as string | undefined,
          dayOfWeek: args.dayOfWeek as number | undefined,
          dayOfMonth: args.dayOfMonth as number | undefined,
          scheduledAt: args.scheduledAt as number | undefined,
          maxRuns: args.maxRuns as number | undefined,
          active: args.active as boolean | undefined,
          agentRuntime: args.agentRuntime as AgentRuntime | undefined,
          sessionMode: args.sessionMode as 'daily' | 'reuse' | undefined,
        }
        if (input.name !== undefined) assertNonBlank(input.name, 'name')
        if (input.prompt !== undefined) assertNonBlank(input.prompt, 'prompt')
        validateScheduleFields(input)
        if (input.scheduleType === 'once' && input.scheduledAt === undefined) {
          const existing = getAutomation(id)
          if (!existing?.scheduledAt) {
            throw new Error('scheduleType 改为 once 时必须提供 scheduledAt')
          }
        }
        const automation = updateAutomation(input)
        if (!automation) throw new Error(`定时任务不存在: ${id}`)
        broadcastAutomationsChanged()
        return jsonToolResult({ automation: summarizeAutomation(automation, true) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__automation__delete_automation',
      label: '删除定时任务',
      description: '删除 Proma 定时任务。只在用户明确要求删除，或任务已经长期无价值且用户确认后使用。',
      parameters: Type.Object({
        id: Type.String({ description: '要删除的定时任务 ID' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { id: string }
        const ok = deleteAutomation(assertNonBlank(args.id, 'id'))
        if (ok) broadcastAutomationsChanged()
        return jsonToolResult({ deleted: ok })
      },
    }),
    sdk.defineTool({
      name: 'mcp__automation__run_automation_now',
      label: '立即运行定时任务',
      description: '立即运行 Proma 定时任务。用于用户要求马上验证，或修改任务后需要试跑一次。',
      parameters: Type.Object({
        id: Type.Optional(Type.String({ description: '要立即运行的定时任务 ID；定时任务自动执行中可省略以运行当前任务' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { id?: string }
        const id = args.id?.trim() || getCurrentAutomationId(ctx)
        if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
        if (ctx.triggeredBy === 'automation' && id === getCurrentAutomationId(ctx)) {
          throw new Error('当前任务正在自动执行，不能立即运行自身')
        }
        await runAutomationNow(id)
        return jsonToolResult({ started: true, id })
      },
    }),
  ] as unknown as ToolDefinition[]
}

// ===== Pi 专属任务 / 日程工具 =====

function buildPlanningTools(sdk: PiSdk, ctx: PiBuiltinToolsContext): ToolDefinition[] {
  const optionalPlanningFields = {
    notes: Type.Optional(Type.String({ description: '补充说明' })),
    workspaceId: Type.Optional(Type.String({ description: '所属工作区 ID；不传默认当前工作区' })),
    groupId: Type.Optional(Type.String({ description: '可选分组 ID；必须来自该对象对应范围的 list_groups 查询结果' })),
    tagIds: Type.Optional(Type.Array(Type.String(), { description: '可选标签 ID 列表；会整体替换该对象现有标签' })),
  }
  return [
    sdk.defineTool({
      name: 'mcp__planning__list_todos', label: '列出 Todo',
      description: '列出 Proma 本地 Todo。适合在安排工作、检查今天待办、维护任务状态前使用。仅 Pi Agent 可用。',
      parameters: Type.Object({
        status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('completed')])),
        dueBefore: Type.Optional(Type.Number({ description: '仅返回此截止时间之前的 Todo，Unix 毫秒时间戳' })),
        limit: Type.Optional(Type.Number({ description: '最多返回数量，默认 50，最大 100' })),
      }),
      async execute(_id: string, params: unknown) {
        const { status, dueBefore, limit } = params as { status?: 'open' | 'completed'; dueBefore?: number; limit?: number }
        return jsonToolResult({ todos: listTodos({ status, dueBefore, limit: limit ?? 50 }) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__get_todo', label: '读取 Todo',
      description: '按 ID 读取一个 Todo 的完整详情。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String({ description: 'Todo ID' }) }),
      async execute(_id: string, params: unknown) {
        const id = assertNonBlank((params as { id: string }).id, 'id')
        const todo = getTodo(id)
        if (!todo) throw new Error('Todo 不存在')
        return jsonToolResult({ todo })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__create_todo', label: '创建 Todo',
      description: '创建 Proma 本地 Todo。调用前必须先用 list_todos(status=open) 检查重复，并用 list_groups({ scope: todo }) 查询并优先复用 Todo 分组；用户明确提出待办，或可合理确定下一步时使用。未传 dueAt 时默认当天结束前；仅 Pi Agent 可用。',
      parameters: Type.Object({ title: Type.String(), ...optionalPlanningFields, priority: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')])), dueAt: Type.Optional(Type.Number({ description: '截止时间 Unix 毫秒时间戳' })) }),
      async execute(_id: string, params: unknown) {
        const args = params as Record<string, unknown>
        const title = assertNonBlank(args.title as string, 'title')
        const created = createTodo({ title, notes: args.notes as string | undefined, priority: args.priority as 'low' | 'medium' | 'high' | undefined, dueAt: numberOrUndefined(args.dueAt) ?? defaultTodoDueAt(), groupId: args.groupId as string | undefined, tagIds: args.tagIds as string[] | undefined, workspaceId: (args.workspaceId as string | undefined) ?? ctx.workspaceId })
        touchTodoSession(created.id, ctx.sessionId)
        const todo = getTodo(created.id)!
        broadcastPlanningChanged(['todos', 'reminders'])
        broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'todo', action: 'created', title: todo.title })
        return jsonToolResult({ todo })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__update_todo', label: '更新 Todo',
      description: '更新 Todo 的标题、说明、优先级或截止时间。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), notes: Type.Optional(Type.String()), priority: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')])), dueAt: Type.Optional(Type.Union([Type.Number(), Type.Null()])), groupId: Type.Optional(Type.Union([Type.String(), Type.Null()])), tagIds: Type.Optional(Type.Array(Type.String())), status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('completed')])) }),
      async execute(_id: string, params: unknown) {
        const args = params as Record<string, unknown>
        const updated = updateTodo({ id: assertNonBlank(args.id as string, 'id'), title: args.title as string | undefined, notes: args.notes as string | undefined, priority: args.priority as 'low' | 'medium' | 'high' | undefined, dueAt: args.dueAt as number | null | undefined, groupId: args.groupId as string | null | undefined, tagIds: args.tagIds as string[] | undefined, status: args.status as 'open' | 'completed' | undefined })
        if (!updated) throw new Error('Todo 不存在')
        touchTodoSession(updated.id, ctx.sessionId)
        const todo = getTodo(updated.id)!
        broadcastPlanningChanged(['todos', 'reminders'])
        broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'todo', action: 'updated', title: todo.title })
        return jsonToolResult({ todo })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__complete_todo', label: '完成 Todo',
      description: '将指定 Todo 标记为已完成。仅在任务确实完成或用户明确要求完成时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) {
        const updated = updateTodo({ id: assertNonBlank((params as { id: string }).id, 'id'), status: 'completed' })
        if (!updated) throw new Error('Todo 不存在')
        touchTodoSession(updated.id, ctx.sessionId)
        const todo = getTodo(updated.id)!
        broadcastPlanningChanged(['todos', 'reminders'])
        broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'todo', action: 'updated', title: todo.title })
        return jsonToolResult({ todo })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__delete_todo', label: '删除 Todo',
      description: '删除 Todo。只在用户明确要求删除时使用；不会删除关联草稿或日程。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) {
        assertPlanningDeleteAllowed(ctx)
        const id = assertNonBlank((params as { id: string }).id, 'id')
        const todo = getTodo(id)
        const deleted = deleteTodo(id)
        if (deleted) {
          broadcastPlanningChanged(['todos', 'calendar_events', 'reminders'])
          broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'todo', action: 'deleted', title: todo?.title ?? 'Todo' })
        }
        return jsonToolResult({ deleted })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__list_calendar_events', label: '列出日程',
      description: '列出 Proma 本地日程。用于查看指定时间范围的安排。仅 Pi Agent 可用。',
      parameters: Type.Object({
        startAt: Type.Optional(Type.Number({ description: '查询范围起点，Unix 毫秒时间戳' })),
        endAt: Type.Optional(Type.Number({ description: '查询范围终点，Unix 毫秒时间戳' })),
        limit: Type.Optional(Type.Number({ description: '最多返回数量，默认 50，最大 100' })),
      }),
      async execute(_id: string, params: unknown) {
        const { startAt, endAt, limit } = params as { startAt?: number; endAt?: number; limit?: number }
        return jsonToolResult({ events: listCalendarEvents({ from: startAt, to: endAt, limit: limit ?? 50 }) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__get_calendar_event', label: '读取日程',
      description: '按 ID 读取一个日程的完整详情。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String({ description: '日程 ID' }) }),
      async execute(_id: string, params: unknown) {
        const id = assertNonBlank((params as { id: string }).id, 'id')
        const event = getCalendarEvent(id)
        if (!event) throw new Error('日程不存在')
        return jsonToolResult({ event })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__create_calendar_event', label: '创建日程',
      description: '创建 Proma 本地日程。分组必须来自 list_groups({ scope: calendar })；用户明确提供时间安排时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ title: Type.String(), startAt: Type.Number({ description: '开始时间 Unix 毫秒时间戳' }), endAt: Type.Optional(Type.Number()), allDay: Type.Optional(Type.Boolean()), ...optionalPlanningFields, todoId: Type.Optional(Type.String()) }),
      async execute(_id: string, params: unknown) {
        const args = params as Record<string, unknown>
        const event = createCalendarEvent({ title: assertNonBlank(args.title as string, 'title'), startAt: args.startAt as number, endAt: args.endAt as number | undefined, allDay: args.allDay as boolean | undefined, notes: args.notes as string | undefined, groupId: args.groupId as string | undefined, tagIds: args.tagIds as string[] | undefined, workspaceId: (args.workspaceId as string | undefined) ?? ctx.workspaceId, todoId: args.todoId as string | undefined })
        broadcastPlanningChanged(['calendar_events', 'reminders'])
        broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'calendar_event', action: 'created', title: event.title })
        return jsonToolResult({ event })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__update_calendar_event', label: '更新日程',
      description: '更新日程时间或内容。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), title: Type.Optional(Type.String()), notes: Type.Optional(Type.String()), startAt: Type.Optional(Type.Number()), endAt: Type.Optional(Type.Union([Type.Number(), Type.Null()])), allDay: Type.Optional(Type.Boolean()), groupId: Type.Optional(Type.Union([Type.String(), Type.Null()])), tagIds: Type.Optional(Type.Array(Type.String())), todoId: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
      async execute(_id: string, params: unknown) {
        const args = params as Record<string, unknown>
        const event = updateCalendarEvent({ id: assertNonBlank(args.id as string, 'id'), title: args.title as string | undefined, notes: args.notes as string | undefined, startAt: args.startAt as number | undefined, endAt: args.endAt as number | null | undefined, allDay: args.allDay as boolean | undefined, groupId: args.groupId as string | null | undefined, tagIds: args.tagIds as string[] | undefined, todoId: args.todoId as string | null | undefined })
        if (!event) throw new Error('日程不存在')
        broadcastPlanningChanged(['calendar_events', 'reminders'])
        broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'calendar_event', action: 'updated', title: event.title })
        return jsonToolResult({ event })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__delete_calendar_event', label: '删除日程',
      description: '删除 Proma 本地日程。只在用户明确要求删除时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) {
        assertPlanningDeleteAllowed(ctx)
        const id = assertNonBlank((params as { id: string }).id, 'id')
        const event = getCalendarEvent(id)
        const deleted = deleteCalendarEvent(id)
        if (deleted) {
          broadcastPlanningChanged(['calendar_events', 'reminders'])
          broadcastPlanningAgentOperation({ sessionId: ctx.sessionId, target: 'calendar_event', action: 'deleted', title: event?.title ?? '日程' })
        }
        return jsonToolResult({ deleted })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__list_groups', label: '列出分组',
      description: '列出指定范围的 Todo 或日程分组。创建或归入分组前优先调用，以复用该范围内的现有分组。仅 Pi Agent 可用。',
      parameters: Type.Object({ scope: Type.Union([Type.Literal('todo'), Type.Literal('calendar')]) }),
      async execute(_id: string, params: unknown) {
        const scope = (params as { scope: 'todo' | 'calendar' }).scope
        return jsonToolResult({ groups: listPlanningGroups(scope) })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__create_group', label: '创建分组',
      description: '创建 Todo 或日程范围内的独立分组。只在用户明确提出新分组或该范围内现有分组不适用时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ scope: Type.Union([Type.Literal('todo'), Type.Literal('calendar')]), name: Type.String(), color: Type.Optional(Type.String()), sortOrder: Type.Optional(Type.Number()) }),
      async execute(_id: string, params: unknown) {
        const args = params as { scope: 'todo' | 'calendar'; name: string; color?: string; sortOrder?: number }
        const group = createPlanningGroup({ scope: args.scope, name: assertNonBlank(args.name, 'name'), color: args.color, sortOrder: args.sortOrder })
        broadcastPlanningChanged(args.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return jsonToolResult({ group })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__update_group', label: '更新分组',
      description: '更新指定范围内的分组，不能借此移动分组范围。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), scope: Type.Union([Type.Literal('todo'), Type.Literal('calendar')]), name: Type.Optional(Type.String()), color: Type.Optional(Type.Union([Type.String(), Type.Null()])), sortOrder: Type.Optional(Type.Number()) }),
      async execute(_id: string, params: unknown) {
        const args = params as Record<string, unknown>
        const scope = args.scope as 'todo' | 'calendar'
        const group = updatePlanningGroup({ id: assertNonBlank(args.id as string, 'id'), scope, name: args.name as string | undefined, color: args.color as string | null | undefined, sortOrder: args.sortOrder as number | undefined })
        if (!group) throw new Error('分组不存在'); broadcastPlanningChanged(scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return jsonToolResult({ group })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__delete_group', label: '删除分组',
      description: '删除指定范围内的分组，并仅清除该范围关联对象的分组字段。只在用户明确要求删除时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), scope: Type.Union([Type.Literal('todo'), Type.Literal('calendar')]) }),
      async execute(_id: string, params: unknown) {
        assertPlanningDeleteAllowed(ctx)
        const args = params as { id: string; scope: 'todo' | 'calendar' }
        const deleted = deletePlanningGroup(args.scope, assertNonBlank(args.id, 'id'))
        if (deleted) broadcastPlanningChanged(args.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders'])
        return jsonToolResult({ deleted })
      },
    }),
    sdk.defineTool({
      name: 'mcp__planning__list_tags', label: '列出标签',
      description: '列出可用于 Todo 与日程的标签。创建或归类前优先调用，以复用已有标签。仅 Pi Agent 可用。',
      parameters: Type.Object({}),
      async execute() { return jsonToolResult({ tags: listPlanningTags() }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__create_tag', label: '创建标签',
      description: '创建跨 Todo 和日程复用的标签。只在用户明确给出新标签或现有标签不适用时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ name: Type.String(), color: Type.Optional(Type.String()) }),
      async execute(_id: string, params: unknown) { const args = params as { name: string; color?: string }; const tag = createPlanningTag({ name: assertNonBlank(args.name, 'name'), color: args.color }); broadcastPlanningChanged(['tags', 'todos', 'calendar_events', 'reminders']); return jsonToolResult({ tag }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__update_tag', label: '更新标签',
      description: '更新标签名称或颜色。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), name: Type.Optional(Type.String()), color: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
      async execute(_id: string, params: unknown) { const args = params as Record<string, unknown>; const tag = updatePlanningTag({ id: assertNonBlank(args.id as string, 'id'), name: args.name as string | undefined, color: args.color as string | null | undefined }); if (!tag) throw new Error('标签不存在'); broadcastPlanningChanged(['tags', 'todos', 'calendar_events', 'reminders']); return jsonToolResult({ tag }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__delete_tag', label: '删除标签',
      description: '删除标签并移除其关联。只在用户明确要求删除时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) { assertPlanningDeleteAllowed(ctx); const deleted = deletePlanningTag(assertNonBlank((params as { id: string }).id, 'id')); if (deleted) broadcastPlanningChanged(['tags', 'todos', 'calendar_events', 'reminders']); return jsonToolResult({ deleted }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__list_active_reminders', label: '列出到期提醒',
      description: '列出当前已到期且未确认的常驻提醒。用于帮助用户处理提醒，不用于扫描全部历史。仅 Pi Agent 可用。',
      parameters: Type.Object({}),
      async execute() { return jsonToolResult({ reminders: listActivePlanningReminders() }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__create_reminder', label: '创建提醒',
      description: '为 Todo 或日程创建指定时点的提醒。仅在用户要求提醒且时点明确时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ targetType: Type.Union([Type.Literal('todo'), Type.Literal('calendar_event')]), targetId: Type.String(), triggerAt: Type.Number({ description: '提醒触发 Unix 毫秒时间戳' }) }),
      async execute(_id: string, params: unknown) { const args = params as { targetType: 'todo' | 'calendar_event'; targetId: string; triggerAt: number }; const reminder = createPlanningReminder({ targetType: args.targetType, targetId: assertNonBlank(args.targetId, 'targetId'), triggerAt: args.triggerAt }); broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return jsonToolResult({ reminder }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__update_reminder', label: '更新提醒时间',
      description: '修改未确认提醒的触发时间。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), triggerAt: Type.Number({ description: '新的提醒触发 Unix 毫秒时间戳' }) }),
      async execute(_id: string, params: unknown) { const args = params as { id: string; triggerAt: number }; const reminder = updatePlanningReminder(assertNonBlank(args.id, 'id'), args.triggerAt); if (!reminder) throw new Error('提醒不存在或已处理'); broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return jsonToolResult({ reminder }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__acknowledge_reminder', label: '确认提醒',
      description: '确认并关闭一个到期提醒，不会删除 Todo 或日程。仅在用户明确要求关闭提醒时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) { const reminder = acknowledgePlanningReminder(assertNonBlank((params as { id: string }).id, 'id')); if (!reminder) throw new Error('提醒不存在或已处理'); broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return jsonToolResult({ reminder }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__snooze_reminder', label: '推迟提醒',
      description: '将未确认提醒推迟指定分钟数。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String(), minutes: Type.Number({ description: '推迟分钟数，1 到 10080' }) }),
      async execute(_id: string, params: unknown) { const args = params as { id: string; minutes: number }; const reminder = snoozePlanningReminder(assertNonBlank(args.id, 'id'), args.minutes); if (!reminder) throw new Error('提醒不存在或已处理'); broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return jsonToolResult({ reminder }) },
    }),
    sdk.defineTool({
      name: 'mcp__planning__delete_reminder', label: '删除提醒',
      description: '删除提醒记录。只在用户明确要求彻底删除提醒时使用。仅 Pi Agent 可用。',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id: string, params: unknown) { assertPlanningDeleteAllowed(ctx); const deleted = deletePlanningReminder(assertNonBlank((params as { id: string }).id, 'id')); if (deleted) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return jsonToolResult({ deleted }) },
    }),
  ] as unknown as ToolDefinition[]
}

// ===== Collaboration 工具（占位，下阶段实现） =====

// collaboration 逻辑较重（涉及子会话生命周期管理、EventBus 订阅、BlockedEvent 冒泡），
// 需要独立桥接文件。当前阶段先确保 automation 和 proma-cloud 可用。
// TODO: 从 agent-collaboration-tools.ts 提取核心逻辑到 service 层，再桥接到 Pi。

// ===== Proma Cloud 工具 =====

function buildPromaCloudTools(sdk: PiSdk, _ctx: PiBuiltinToolsContext): ToolDefinition[] {
  // proma-cloud MCP 工具（get_credentials / create_app_key）通常由 Proma 的
  // 内置 MCP server 进程独立提供（非 SDK in-process），Pi adapter 在 orchestrator
  // 构建 mcpServers 后通过 customTools 或 MCP stdio 通道访问。
  // 如果 proma-cloud 是 SDK in-process MCP，需要在此桥接：
  // 当前实现中 proma-cloud 走的是外部 MCP（不在 injectBuiltinMcpServers 内），
  // 所以 Pi runtime 需要通过 MCP stdio transport 独立连接，不在这里注册。
  return []
}

// ===== 统一入口 =====

export interface PiBuiltinToolsResult {
  tools: ToolDefinition[]
  collaborationAvailable: boolean
}

export async function buildPiBuiltinTools(
  sdk: PiSdk,
  ctx: PiBuiltinToolsContext,
): Promise<PiBuiltinToolsResult> {
  const tools: ToolDefinition[] = []

  if (isWebSearchEnabledForAgent()) {
    try {
      tools.push(...buildWebTools(sdk))
    } catch (error) {
      console.error('[Pi 桥接] 注入 WebSearch/WebFetch 工具失败:', error)
    }
  }

  if (isBuiltinMcpUserEnabled('automation')) {
    try {
      tools.push(...buildAutomationTools(sdk, ctx))
    } catch (error) {
      console.error('[Pi 桥接] 注入 automation 工具失败:', error)
    }
  }

  // 任务/日程是 Pi native customTools，Claude runtime 不经此入口，因此天然隔离。
  try {
    tools.push(...buildPlanningTools(sdk, ctx))
  } catch (error) {
    console.error('[Pi 桥接] 注入任务/日程工具失败:', error)
  }

  // collaboration 桥接
  const collaborationAvailable = isBuiltinMcpUserEnabled('collaboration') &&
    !!ctx.workspaceId &&
    ctx.triggeredBy !== 'delegation'

  if (collaborationAvailable) {
    try {
      const collaborationTools = buildPiCollaborationTools(sdk, {
        sessionId: ctx.sessionId,
        channelId: ctx.channelId,
        modelId: ctx.modelId,
        workspaceId: ctx.workspaceId,
        permissionMode: ctx.permissionMode,
        agentRuntime: ctx.agentRuntime,
        triggeredBy: ctx.triggeredBy,
      })
      tools.push(...collaborationTools as ToolDefinition[])
    } catch (error) {
      console.error('[Pi 桥接] 注入 collaboration 工具失败:', error)
    }
  }

  // nano-banana 当前走外部 MCP stdio，不需要 in-process 桥接

  const cloudTools = buildPromaCloudTools(sdk, ctx)
  tools.push(...cloudTools)

  return { tools, collaborationAvailable }
}
