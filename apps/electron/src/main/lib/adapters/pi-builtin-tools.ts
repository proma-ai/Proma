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
import { getSettings } from '../settings-service'

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
  if (input.agentRuntime === 'pi' && getSettings().experimentalAgentRuntimeSwitchEnabled !== true) {
    throw new Error('实验性 Agent 内核切换未开启')
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

  if (isBuiltinMcpUserEnabled('automation')) {
    try {
      tools.push(...buildAutomationTools(sdk, ctx))
    } catch (error) {
      console.error('[Pi 桥接] 注入 automation 工具失败:', error)
    }
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
