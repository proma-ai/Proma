/**
 * Agent 内置协作会话工具
 *
 * 通过 SDK MCP Server 暴露 Proma Agent 子会话委派能力。
 * Skill 负责判断何时协作；这里负责受控创建真实 Agent 会话、运行、等待和停止。
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentDelegationRole,
  AgentDelegationStatus,
  AgentMessage,
  AgentSessionMeta,
  PromaPermissionMode,
  SDKMessage,
} from '@proma/shared'
import {
  createAgentSession,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
  listAgentSessions,
  updateAgentSessionMeta,
} from './agent-session-manager'
import {
  runRegisteredHeadlessAgent,
  stopRegisteredAgent,
} from './agent-headless-runner-registry'
import {
  MAX_RUNNING_DELEGATIONS_PER_PARENT,
  buildDelegationTaskWithSharedContext,
  buildDelegationPrompt,
  resolveDelegationPermissionMode,
} from './agent-collaboration-utils'

interface CollaborationToolContext {
  sessionId: string
  channelId: string
  modelId?: string
  workspaceId?: string
  permissionMode?: PromaPermissionMode
  triggeredBy?: 'user' | 'automation' | 'delegation'
}

interface CollaborationToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
}

interface DelegationRecord {
  delegationId: string
  parentSessionId: string
  childSessionId: string
  title: string
  role: AgentDelegationRole
  goal: string
  permissionMode: PromaPermissionMode
  status: AgentDelegationStatus
  startedAt: number
  completedAt?: number
  error?: string
  resultSummary?: string
  completion: Promise<void>
  resolveCompletion: () => void
}

type ZodModule = typeof import('zod')

const MAX_WAIT_SECONDS = 2 * 60 * 60
const DEFAULT_WAIT_SECONDS = 30 * 60
const RESULT_SUMMARY_CHAR_LIMIT = 12_000
const DELEGATION_GOAL_CHAR_LIMIT = 1_000
/** live Map 中保留的已结束委派上限，超出时按完成时间清理最老的（持久化仍可回查） */
const MAX_RETAINED_FINISHED_DELEGATIONS = 200

const delegations = new Map<string, DelegationRecord>()

/**
 * 清理内存中过多的已结束委派，避免 live Map 无界增长。
 * 仅清理 status !== 'running' 的记录；被清理项仍可通过持久化会话回查。
 */
function pruneFinishedDelegations(): void {
  const finished = Array.from(delegations.values()).filter((item) => item.status !== 'running')
  const excess = finished.length - MAX_RETAINED_FINISHED_DELEGATIONS
  if (excess <= 0) return
  finished
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .slice(0, excess)
    .forEach((item) => delegations.delete(item.delegationId))
}

function jsonResult(payload: unknown): CollaborationToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function normalizeTitle(input: string | undefined, fallback: string): string {
  const trimmed = input?.trim()
  if (trimmed) return trimmed.slice(0, 80)
  return fallback.slice(0, 80)
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n\n[内容过长，已截断 ${text.length - limit} 字符]`
}

function assertNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${field} 不能为空`)
  }
  return trimmed
}

interface DelegateAgentArgs {
  title?: string
  role?: AgentDelegationRole
  task: string
  expectedOutput?: string
  permissionMode?: PromaPermissionMode
}

interface StartDelegationResult {
  record: DelegationRecord
  effectivePermissionMode: PromaPermissionMode
}

function getRunningDelegationCount(parentSessionId: string): number {
  return Array.from(delegations.values())
    .filter((item) => item.parentSessionId === parentSessionId && item.status === 'running')
    .length
}

function assertCanCreateDelegation(
  ctx: CollaborationToolContext,
  requestedCount = 1,
): AgentSessionMeta | undefined {
  const parent = getAgentSessionMeta(ctx.sessionId)
  const delegationDepth = parent?.delegationDepth ?? 0

  if (ctx.triggeredBy === 'delegation' || delegationDepth > 0) {
    throw new Error('协作子会话不能继续创建新的子会话')
  }

  const runningCount = getRunningDelegationCount(ctx.sessionId)
  if (runningCount + requestedCount > MAX_RUNNING_DELEGATIONS_PER_PARENT) {
    throw new Error(`当前父会话已有 ${runningCount} 个运行中的协作子会话，最多允许 ${MAX_RUNNING_DELEGATIONS_PER_PARENT} 个`)
  }

  if (!ctx.channelId) {
    throw new Error('创建协作子会话需要可用的 channelId')
  }
  if (!ctx.workspaceId) {
    throw new Error('创建协作子会话需要绑定工作区')
  }

  return parent
}

function extractTextFromSdkMessage(message: SDKMessage): string[] {
  const record = message as Record<string, unknown>
  if (record.type !== 'assistant') return []

  const outerMessage = record.message
  if (!outerMessage || typeof outerMessage !== 'object') return []

  const content = (outerMessage as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const blockRecord = block as Record<string, unknown>
    if (blockRecord.type === 'text' && typeof blockRecord.text === 'string') {
      parts.push(blockRecord.text)
    }
  }
  return parts
}

function summarizeChildResult(childSessionId: string, messages?: AgentMessage[]): string {
  const lastAssistant = [...(messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim().length > 0)
  if (lastAssistant) return truncateText(lastAssistant.content.trim(), RESULT_SUMMARY_CHAR_LIMIT)

  const sdkMessages = getAgentSessionSDKMessages(childSessionId)
  const sdkTexts: string[] = []
  for (const message of sdkMessages) {
    sdkTexts.push(...extractTextFromSdkMessage(message))
  }
  const text = sdkTexts.join('\n\n').trim()
  if (text) return truncateText(text, RESULT_SUMMARY_CHAR_LIMIT)

  return '子会话已结束，但未找到可摘要的 assistant 文本。请打开子会话查看完整记录。'
}

function markDelegationFinished(
  record: DelegationRecord,
  status: AgentDelegationStatus,
  fields: { error?: string; resultSummary?: string } = {},
): void {
  if (record.status !== 'running') return
  record.status = status
  record.completedAt = Date.now()
  record.error = fields.error
  record.resultSummary = fields.resultSummary
  updateAgentSessionMeta(record.childSessionId, { delegationStatus: status })
  record.resolveCompletion()
}

function getDelegationSummary(record: DelegationRecord): Record<string, unknown> {
  return {
    delegationId: record.delegationId,
    parentSessionId: record.parentSessionId,
    childSessionId: record.childSessionId,
    title: record.title,
    role: record.role,
    goal: record.goal,
    permissionMode: record.permissionMode,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    error: record.error,
    resultSummary: record.resultSummary,
  }
}

function listKnownDelegations(parentSessionId: string): Array<Record<string, unknown>> {
  const live = Array.from(delegations.values())
    .filter((item) => item.parentSessionId === parentSessionId)
    .map(getDelegationSummary)

  const liveIds = new Set(live.map((item) => item.delegationId))
  const persisted = listAgentSessions()
    .filter((session) => session.parentSessionId === parentSessionId && session.sourceDelegationId && !liveIds.has(session.sourceDelegationId))
    .map((session) => ({
      delegationId: session.sourceDelegationId,
      parentSessionId,
      childSessionId: session.id,
      title: session.title,
      role: session.delegationRole,
      goal: session.delegationGoal,
      permissionMode: session.permissionMode,
      status: session.delegationStatus,
      startedAt: session.createdAt,
      completedAt: session.delegationStatus && session.delegationStatus !== 'running' ? session.updatedAt : undefined,
    }))

  return [...live, ...persisted]
}

function getDelegationResult(parentSessionId: string, delegationId: string): Record<string, unknown> {
  const live = delegations.get(delegationId)
  if (live) {
    if (live.parentSessionId !== parentSessionId) {
      throw new Error(`委派不属于当前父会话: ${delegationId}`)
    }
    return getDelegationSummary(live)
  }

  const session = listAgentSessions()
    .find((item) => item.parentSessionId === parentSessionId && item.sourceDelegationId === delegationId)
  if (!session) {
    throw new Error(`未找到当前会话下的委派: ${delegationId}`)
  }

  const resultSummary = session.delegationStatus && session.delegationStatus !== 'running'
    ? summarizeChildResult(session.id)
    : undefined

  return {
    delegationId,
    parentSessionId,
    childSessionId: session.id,
    title: session.title,
    role: session.delegationRole,
    goal: session.delegationGoal,
    permissionMode: session.permissionMode,
    status: session.delegationStatus,
    startedAt: session.createdAt,
    completedAt: session.delegationStatus && session.delegationStatus !== 'running' ? session.updatedAt : undefined,
    resultSummary,
  }
}

interface WaitResolution {
  /** 仍在内存中、需要实际等待的委派 */
  liveRecords: DelegationRecord[]
  /** 不在内存、但持久化记录已是终态的委派（如应用重启后的遗留委派） */
  settled: Array<Record<string, unknown>>
}

/**
 * 解析等待目标：内存中的进行中委派照常等待；
 * 不在内存的委派回退到持久化记录（重启后遗留），已终态则直接计入完成。
 * 两处都查不到才抛错。
 */
function resolveWaitTargets(ids: string[], parentSessionId: string): WaitResolution {
  const liveRecords: DelegationRecord[] = []
  const settled: Array<Record<string, unknown>> = []
  for (const id of ids) {
    const record = delegations.get(id)
    if (record) {
      if (record.parentSessionId !== parentSessionId) {
        throw new Error(`委派不属于当前父会话: ${id}`)
      }
      liveRecords.push(record)
      continue
    }
    // 不在内存：回退到持久化记录；getDelegationResult 在完全找不到时抛错
    settled.push(getDelegationResult(parentSessionId, id))
  }
  return { liveRecords, settled }
}

function getFinishedDelegationCount(records: DelegationRecord[]): number {
  return records.filter((record) => record.status !== 'running').length
}

async function waitForLiveRecords(
  records: DelegationRecord[],
  timeoutSeconds: number,
  liveTarget: number,
): Promise<'completed' | 'timeout'> {
  if (getFinishedDelegationCount(records) >= liveTarget) {
    return 'completed'
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<'completed'>((resolve) => {
        const check = () => {
          if (getFinishedDelegationCount(records) >= liveTarget) {
            resolve('completed')
          }
        }
        for (const record of records) {
          if (record.status === 'running') {
            record.completion.then(check)
          }
        }
      }),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), timeoutSeconds * 1000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function getCurrentParentPermissionMode(
  parent: AgentSessionMeta | undefined,
  fallback: PromaPermissionMode | undefined,
): PromaPermissionMode | undefined {
  const latestParent = parent ? getAgentSessionMeta(parent.id) : undefined
  return latestParent?.permissionMode ?? parent?.permissionMode ?? fallback
}

function stopDelegation(parentSessionId: string, delegationId: string): Record<string, unknown> {
  const record = delegations.get(delegationId)
  if (!record) {
    // 不在内存：可能是应用重启后的遗留委派。回退到持久化记录（完全找不到才抛错），无法主动停止
    return {
      delegation: getDelegationResult(parentSessionId, delegationId),
      stopped: false,
      note: '该委派不在当前运行内存中（可能因应用重启已中断），无法主动停止。',
    }
  }
  if (record.parentSessionId !== parentSessionId) {
    throw new Error(`未找到当前会话下的委派: ${delegationId}`)
  }
  if (record.status !== 'running') {
    return {
      delegation: getDelegationSummary(record),
      stopped: false,
    }
  }

  stopRegisteredAgent(record.childSessionId)
  markDelegationFinished(record, 'cancelled')
  return {
    delegation: getDelegationSummary(record),
    stopped: true,
  }
}

function startDelegation(
  ctx: CollaborationToolContext,
  parent: AgentSessionMeta | undefined,
  args: DelegateAgentArgs,
): StartDelegationResult {
  const task = assertNonBlank(args.task, 'task')
  const delegationId = randomUUID()
  const role = args.role ?? 'custom'
  const title = normalizeTitle(args.title, `协作：${task}`)
  const goal = truncateText(task, DELEGATION_GOAL_CHAR_LIMIT)
  const parentPermissionMode = getCurrentParentPermissionMode(parent, ctx.permissionMode)
  const permissionMode = resolveDelegationPermissionMode(parentPermissionMode, args.permissionMode)

  let resolveCompletion: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const child = createAgentSession(title, ctx.channelId, ctx.workspaceId, ctx.modelId)
  const rootSessionId = parent?.rootSessionId ?? parent?.id ?? ctx.sessionId
  updateAgentSessionMeta(child.id, {
    parentSessionId: ctx.sessionId,
    rootSessionId,
    sourceDelegationId: delegationId,
    delegationRole: role,
    delegationStatus: 'running',
    delegationDepth: (parent?.delegationDepth ?? 0) + 1,
    delegationGoal: goal,
    permissionMode,
  })

  const record: DelegationRecord = {
    delegationId,
    parentSessionId: ctx.sessionId,
    childSessionId: child.id,
    title,
    role,
    goal,
    permissionMode,
    status: 'running',
    startedAt: Date.now(),
    completion,
    resolveCompletion,
  }
  delegations.set(delegationId, record)
  pruneFinishedDelegations()

  const prompt = buildDelegationPrompt({
    parentSessionId: ctx.sessionId,
    delegationId,
    role,
    task,
    expectedOutput: args.expectedOutput,
  })

  runRegisteredHeadlessAgent(
    {
      sessionId: child.id,
      userMessage: prompt,
      channelId: ctx.channelId,
      modelId: ctx.modelId,
      workspaceId: ctx.workspaceId,
      permissionModeOverride: permissionMode,
      triggeredBy: 'delegation',
      startedAt: record.startedAt,
    },
    {
      source: 'delegation',
      onError: (error) => {
        markDelegationFinished(record, 'failed', { error })
      },
      onComplete: (messages) => {
        if (record.status !== 'running') return
        const resultSummary = summarizeChildResult(child.id, messages)
        markDelegationFinished(record, 'completed', { resultSummary })
      },
      onTitleUpdated: (updatedTitle) => {
        record.title = updatedTitle
      },
    },
  ).catch((error: unknown) => {
    markDelegationFinished(record, 'failed', {
      error: error instanceof Error ? error.message : '未知错误',
    })
  })

  return { record, effectivePermissionMode: permissionMode }
}

function buildCollaborationSchemas(z: ZodModule['z']) {
  const nonBlankString = z.string().trim().min(1)
  const role = z.enum(['explore', 'research', 'implement', 'review', 'custom'])
  const permissionMode = z.enum(['plan', 'auto', 'bypassPermissions'])
  const delegateItem = z.object({
    title: z.string().optional().describe('子会话标题，简短说明子任务'),
    role: role.optional().describe('子任务角色：explore/research/implement/review/custom'),
    task: nonBlankString.describe('发送给子 Agent 的完整任务说明，必须自包含必要上下文'),
    expectedOutput: z.string().optional().describe('希望子 Agent 最终返回的格式或要点'),
    permissionMode: permissionMode.optional().describe('子会话权限模式；不能高于父会话权限'),
  })
  return {
    delegate: {
      title: z.string().optional().describe('子会话标题，简短说明子任务'),
      role: role.optional().describe('子任务角色：explore/research/implement/review/custom'),
      task: nonBlankString.describe('发送给子 Agent 的完整任务说明，必须自包含必要上下文'),
      expectedOutput: z.string().optional().describe('希望子 Agent 最终返回的格式或要点'),
      permissionMode: permissionMode.optional().describe('子会话权限模式；不能高于父会话权限'),
    },
    delegateBatch: {
      sharedContext: z.string().optional().describe('批量子任务共用背景，会自动拼接到每个子任务前'),
      items: z.array(delegateItem).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要创建的子会话列表，最多 50 个'),
    },
    wait: {
      delegationIds: z.array(z.string()).optional().describe('要等待的委派 ID；不传则等待当前父会话当前运行中的全部委派'),
      mode: z.enum(['all', 'any']).optional().describe('等待模式：all 等全部完成，any 等至少 minCompleted 个完成'),
      minCompleted: z.number().int().min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).optional().describe('mode=any 时至少等待完成的数量，默认 1'),
      timeoutSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional().describe('最长等待秒数，默认 1800，最大 7200'),
    },
    list: {
      includeCompleted: z.boolean().optional().describe('是否包含已完成委派，默认 true'),
    },
    results: {
      delegationIds: z.array(z.string()).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要读取结果的委派 ID 列表'),
    },
    stop: {
      delegationId: z.string().describe('要停止的委派 ID'),
    },
    stopBatch: {
      delegationIds: z.array(z.string()).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要停止的委派 ID 列表'),
    },
  }
}

export async function injectAgentCollaborationMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
  ctx: CollaborationToolContext,
): Promise<void> {
  const { z } = await import('zod')
  const schemas = buildCollaborationSchemas(z)

  const server = sdk.createSdkMcpServer({
    name: 'collaboration',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'delegate_agent',
        '创建一个真实可见的 Proma 协作子 Agent 会话来并行处理独立子任务。只用于长耗时、可并行、需要追踪的任务；简单搜索优先用内置 Agent/SubAgent。',
        schemas.delegate,
        async (args) => {
          const parent = assertCanCreateDelegation(ctx)
          const result = startDelegation(ctx, parent, args)

          return jsonResult({
            delegation: getDelegationSummary(result.record),
            effectivePermissionMode: result.effectivePermissionMode,
            note: '子会话已启动。需要结果时调用 wait_for_delegations。',
          })
        },
      ),
      sdk.tool(
        'delegate_agents',
        '批量创建多个真实可见的 Proma 协作子 Agent 会话。适合把同一大任务拆成多片并行处理，单个父会话运行中子会话最多 50 个。',
        schemas.delegateBatch,
        async (args) => {
          const parent = assertCanCreateDelegation(ctx, args.items.length)
          // 逐个创建并容错：单个失败不影响其余，避免整体抛错导致已创建的子会话成孤儿
          const created: StartDelegationResult[] = []
          const failures: Array<{ index: number; title?: string; error: string }> = []
          args.items.forEach((item, index) => {
            try {
              created.push(startDelegation(ctx, parent, {
                ...item,
                task: buildDelegationTaskWithSharedContext({
                  sharedContext: args.sharedContext,
                  task: item.task,
                }),
              }))
            } catch (error) {
              failures.push({
                index,
                title: item.title,
                error: error instanceof Error ? error.message : '未知错误',
              })
            }
          })

          return jsonResult({
            delegations: created.map((item) => getDelegationSummary(item.record)),
            effectivePermissionModes: created.map((item) => ({
              delegationId: item.record.delegationId,
              permissionMode: item.effectivePermissionMode,
            })),
            failures,
            createdCount: created.length,
            failedCount: failures.length,
            maxRunningDelegations: MAX_RUNNING_DELEGATIONS_PER_PARENT,
            note: failures.length > 0
              ? `批量子会话部分创建成功（成功 ${created.length}，失败 ${failures.length}）。失败项可修正后重试；需要结果时调用 wait_for_delegations。`
              : '批量子会话已启动。需要结果时调用 wait_for_delegations，可用 mode=any 先收敛部分结果。',
          })
        },
      ),
      sdk.tool(
        'wait_for_delegations',
        '等待一个或多个 Proma 协作子会话完成，并返回结构化结果摘要。支持 all 等全部完成，或 any 等部分完成。',
        schemas.wait,
        async (args) => {
          const ids = args.delegationIds?.length
            ? args.delegationIds
            : Array.from(delegations.values())
              .filter((item) => item.parentSessionId === ctx.sessionId && item.status === 'running')
              .map((item) => item.delegationId)
          const { liveRecords, settled } = resolveWaitTargets(ids, ctx.sessionId)
          const totalTargets = liveRecords.length + settled.length
          if (totalTargets === 0) {
            return jsonResult({ delegations: [], note: '没有找到可等待的协作委派' })
          }

          const mode = args.mode ?? 'all'
          const minCompleted = args.minCompleted ?? 1
          const timeoutSeconds = Math.min(args.timeoutSeconds ?? DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS)
          // settled 已是终态，先计入完成数；只需让足够多的 liveRecords 完成即可
          const targetCompleted = mode === 'all'
            ? totalTargets
            : Math.max(1, Math.min(minCompleted, totalTargets))
          const liveTarget = Math.max(0, targetCompleted - settled.length)
          const waitResult = liveRecords.length > 0
            ? await waitForLiveRecords(liveRecords, timeoutSeconds, liveTarget)
            : 'completed'

          const allDelegations = [...liveRecords.map(getDelegationSummary), ...settled]
          return jsonResult({
            status: waitResult,
            mode,
            completedCount: allDelegations.filter((item) => item.status !== 'running').length,
            runningCount: allDelegations.filter((item) => item.status === 'running').length,
            delegations: allDelegations,
          })
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'list_delegations',
        '列出当前父会话创建的 Proma 协作子会话及状态。',
        schemas.list,
        async (args) => {
          const items = listKnownDelegations(ctx.sessionId)
          const delegationsResult = args.includeCompleted === false
            ? items.filter((item) => item.status === 'running')
            : items
          return jsonResult({
            maxRunningDelegations: MAX_RUNNING_DELEGATIONS_PER_PARENT,
            runningCount: delegationsResult.filter((item) => item.status === 'running').length,
            delegations: delegationsResult,
          })
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'get_delegation_results',
        '按委派 ID 读取一个或多个 Proma 协作子会话的结果摘要。适合先 list 后按需取结果，或父会话恢复后读取已完成子会话。',
        schemas.results,
        async (args) => {
          return jsonResult({
            delegations: args.delegationIds.map((delegationId) => getDelegationResult(ctx.sessionId, delegationId)),
          })
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'stop_delegation',
        '停止一个正在运行的 Proma 协作子会话。',
        schemas.stop,
        async (args) => {
          return jsonResult(stopDelegation(ctx.sessionId, args.delegationId))
        },
      ),
      sdk.tool(
        'stop_delegations',
        '批量停止多个正在运行的 Proma 协作子会话。',
        schemas.stopBatch,
        async (args) => {
          return jsonResult({
            results: args.delegationIds.map((delegationId) => stopDelegation(ctx.sessionId, delegationId)),
          })
        },
      ),
    ],
  })

  mcpServers.collaboration = server as unknown as Record<string, unknown>
  console.log('[Agent 编排] 已注入内置协作会话工具 (collaboration)')
}
