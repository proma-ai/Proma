/**
 * Agent 内置定时任务工具
 *
 * 通过 SDK MCP Server 暴露 Proma Automation 的创建、维护和运行记录能力。
 * 这些工具服务于 Agent 模式，不经过渲染进程 IPC，因此这里必须独立做参数校验。
 */

import {
  type Automation,
  type AutomationPermissionMode,
  type AutomationScheduleType,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@proma/shared'
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  updateAutomation,
} from './automation-manager'
import {
  broadcastChanged as broadcastAutomationsChanged,
  runAutomationNow,
} from './automation-scheduler'
import { getAgentSessionMeta } from './agent-session-manager'

interface AutomationAgentToolContext {
  sessionId: string
  channelId: string
  modelId?: string
  workspaceId?: string
  triggeredBy?: 'user' | 'automation'
}

interface AutomationToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
}

type ZodModule = typeof import('zod')

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function validScheduleType(v: unknown): v is AutomationScheduleType {
  return v === 'interval' || v === 'daily' || v === 'weekly' || v === 'monthly'
}

function validPermissionMode(v: unknown): v is AutomationPermissionMode {
  return v === 'auto' || v === 'bypassPermissions'
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
}

function assertNonBlank(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} 不能为空`)
  }
  return value.trim()
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
  if (input.permissionMode !== undefined && !validPermissionMode(input.permissionMode)) {
    throw new Error(`非法的 permissionMode: ${String(input.permissionMode)}`)
  }
  if (input.sessionMode !== undefined && input.sessionMode !== 'new' && input.sessionMode !== 'reuse') {
    throw new Error(`非法的 sessionMode: ${String(input.sessionMode)}`)
  }
}

function summarizeAutomation(a: Automation, includeHistory: boolean): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    active: a.active,
    scheduleType: a.scheduleType,
    intervalMinutes: a.intervalMinutes,
    timeOfDay: a.timeOfDay,
    dayOfWeek: a.dayOfWeek,
    dayOfMonth: a.dayOfMonth,
    permissionMode: a.permissionMode,
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

function jsonResult(payload: unknown): AutomationToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function getCurrentAutomationId(ctx: AutomationAgentToolContext): string | undefined {
  return getAgentSessionMeta(ctx.sessionId)?.sourceAutomationId
}

function buildAutomationSchemas(z: ZodModule['z']) {
  const scheduleType = z.enum(['interval', 'daily', 'weekly', 'monthly'])
  const permissionMode = z.enum(['auto', 'bypassPermissions'])
  const sessionMode = z.enum(['new', 'reuse'])
  return {
    list: {
      active: z.boolean().optional().describe('只列出启用或暂停任务；不传则列出全部'),
      includeHistory: z.boolean().optional().describe('是否包含运行历史，默认 false'),
    },
    get: {
      id: z.string().optional().describe('定时任务 ID；定时任务自动执行中可省略以读取当前任务'),
    },
    create: {
      name: z.string().describe('任务名，简短说明长期反复执行的目标'),
      prompt: z.string().describe('每次触发时发送给 Agent 的完整自然语言指令'),
      scheduleType: scheduleType.describe('调度类型：interval 固定间隔，daily 每天定点，weekly 每周定点，monthly 每月定点'),
      intervalMinutes: z.number().int().min(1).optional().describe('固定间隔分钟数；scheduleType=interval 时必填'),
      timeOfDay: z.string().optional().describe('每天/每周/每月触发时间，24 小时制 HH:MM'),
      dayOfWeek: z.number().int().min(0).max(6).optional().describe('每周触发日，0=周日，1=周一，...，6=周六'),
      dayOfMonth: z.number().int().min(1).max(31).optional().describe('每月触发日，1-31；scheduleType=monthly 时必填'),
      active: z.boolean().optional().describe('创建后是否启用，默认 true'),
      permissionMode: permissionMode.optional().describe('无人值守权限模式，默认 bypassPermissions；高风险任务可用 auto'),
      sessionMode: sessionMode.optional().describe('会话模式：new=每次新建子会话（默认，避免上下文膨胀）；reuse=复用上次子会话（保留上下文，首次会自动新建）'),
    },
    update: {
      id: z.string().optional().describe('定时任务 ID；定时任务自动执行中可省略以更新当前任务'),
      name: z.string().optional().describe('新的任务名'),
      prompt: z.string().optional().describe('新的执行提示词'),
      scheduleType: scheduleType.optional().describe('新的调度类型'),
      intervalMinutes: z.number().int().min(1).optional().describe('新的固定间隔分钟数'),
      timeOfDay: z.string().optional().describe('新的每天/每周/每月触发时间，24 小时制 HH:MM'),
      dayOfWeek: z.number().int().min(0).max(6).optional().describe('新的每周触发日，0=周日，...，6=周六'),
      dayOfMonth: z.number().int().min(1).max(31).optional().describe('新的每月触发日，1-31'),
      active: z.boolean().optional().describe('启用或暂停任务'),
      permissionMode: permissionMode.optional().describe('新的无人值守权限模式'),
      sessionMode: sessionMode.optional().describe('新的会话模式：new=每次新建子会话；reuse=复用上次子会话'),
    },
    delete: {
      id: z.string().describe('要删除的定时任务 ID'),
    },
    runNow: {
      id: z.string().optional().describe('要立即运行的定时任务 ID；定时任务自动执行中可省略以运行当前任务'),
    },
  }
}

export async function injectAutomationMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: AutomationAgentToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const schemas = buildAutomationSchemas(z)

  const server = sdk.createSdkMcpServer({
    name: 'automation',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'list_automations',
        '列出 Proma 持久化定时任务。用于查看已有长期反复任务、判断是否需要新建任务、检查运行状态和最近失败情况。',
        schemas.list,
        async (args) => {
          const items = listAutomations()
            .filter((a) => args.active === undefined || a.active === args.active)
            .map((a) => summarizeAutomation(a, args.includeHistory === true))
          return jsonResult({ automations: items })
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'get_automation',
        '读取单个 Proma 定时任务详情和运行记录。定时任务自动执行中可以省略 id 来读取当前任务，用于自检和自迭代。',
        schemas.get,
        async (args) => {
          const id = args.id?.trim() || getCurrentAutomationId(ctx)
          if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
          const automation = getAutomation(id)
          if (!automation) throw new Error(`定时任务不存在: ${id}`)
          return jsonResult({ automation: summarizeAutomation(automation, true) })
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'create_automation',
        '创建 Proma 持久化定时任务。只用于长期、反复、无人值守有价值的场景；一次性任务、短期提醒、需要用户实时判断的任务不要创建。',
        schemas.create,
        async (args) => {
          if (ctx.triggeredBy === 'automation' || getCurrentAutomationId(ctx)) {
            throw new Error('当前是定时任务自动执行，禁止递归创建新的定时任务；请改用 update_automation 调整当前任务')
          }
          const input: CreateAutomationInput = {
            name: assertNonBlank(args.name, 'name'),
            prompt: assertNonBlank(args.prompt, 'prompt'),
            scheduleType: args.scheduleType,
            intervalMinutes: args.intervalMinutes ?? 10,
            timeOfDay: args.timeOfDay,
            dayOfWeek: args.dayOfWeek,
            dayOfMonth: args.dayOfMonth,
            channelId: ctx.channelId,
            modelId: ctx.modelId,
            workspaceId: ctx.workspaceId,
            permissionMode: args.permissionMode,
            sessionMode: args.sessionMode,
            sourceSessionId: ctx.sessionId,
            active: args.active ?? true,
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
          const automation = createAutomation(input)
          broadcastAutomationsChanged()
          return jsonResult({ automation: summarizeAutomation(automation, true) })
        },
      ),
      sdk.tool(
        'update_automation',
        '修改 Proma 定时任务，包括名称、执行提示词、频率、启用状态和权限模式。定时任务自动执行中可以省略 id 来修改当前任务。',
        schemas.update,
        async (args) => {
          const id = args.id?.trim() || getCurrentAutomationId(ctx)
          if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
          const input: UpdateAutomationInput = {
            id,
            name: args.name?.trim(),
            prompt: args.prompt?.trim(),
            scheduleType: args.scheduleType,
            intervalMinutes: args.intervalMinutes,
            timeOfDay: args.timeOfDay,
            dayOfWeek: args.dayOfWeek,
            dayOfMonth: args.dayOfMonth,
            active: args.active,
            permissionMode: args.permissionMode,
            sessionMode: args.sessionMode,
          }
          if (input.name !== undefined) assertNonBlank(input.name, 'name')
          if (input.prompt !== undefined) assertNonBlank(input.prompt, 'prompt')
          validateScheduleFields(input)
          const automation = updateAutomation(input)
          if (!automation) throw new Error(`定时任务不存在: ${id}`)
          broadcastAutomationsChanged()
          return jsonResult({ automation: summarizeAutomation(automation, true) })
        },
      ),
      sdk.tool(
        'delete_automation',
        '删除 Proma 定时任务。只在用户明确要求删除，或任务已经长期无价值且用户确认后使用。',
        schemas.delete,
        async (args) => {
          const ok = deleteAutomation(assertNonBlank(args.id, 'id'))
          if (ok) broadcastAutomationsChanged()
          return jsonResult({ deleted: ok })
        },
      ),
      sdk.tool(
        'run_automation_now',
        '立即运行 Proma 定时任务。用于用户要求马上验证，或修改任务后需要试跑一次。定时任务自动执行中不要调用自己触发重入。',
        schemas.runNow,
        async (args) => {
          const id = args.id?.trim() || getCurrentAutomationId(ctx)
          if (!id) throw new Error('id 必填；只有定时任务自动执行中才可以省略 id')
          if (ctx.triggeredBy === 'automation' && id === getCurrentAutomationId(ctx)) {
            throw new Error('当前任务正在自动执行，不能立即运行自身')
          }
          await runAutomationNow(id)
          return jsonResult({ started: true, id })
        },
      ),
    ],
  })

  mcpServers.automation = server as unknown as Record<string, unknown>
  console.log('[Agent 编排] 已注入内置定时任务工具 (automation)')
}
