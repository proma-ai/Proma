import type {
  AgentEventUsage,
  AgentPlanModeChangeSource,
  AgentRendererStreamPayload,
  AgentToolResultImage,
  AskUserRequest,
  ExitPlanModeRequest,
  PermissionRequest,
  PromaPermissionMode,
  ProviderType,
  RetryAttempt,
  SDKAssistantMessage,
  SDKContentBlock,
  SDKSystemMessage,
  SDKUserContentBlock,
  SDKUserMessage,
  TaskUsage,
} from '@proma/shared'
import { inferContextWindow } from '@proma/shared'

/**
 * canonical stream 在 renderer 内产生的状态/副作用投影。
 *
 * 它不是 IPC 兼容协议：main/renderer 唯一传输协议仍是 AgentRendererStreamPayload。
 * 此投影只把 SDKMessage 与 PromaEvent 转成 UI 能直接消费的语义更新，不包含正文副本。
 */
export type AgentLiveUpdate =
  | { type: 'assistant_progress' }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; parentToolUseId?: string; isFinal: boolean }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; parentToolUseId?: string; imageAttachments?: AgentToolResultImage[] }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string }
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds?: number; taskId?: string; description?: string; lastToolName?: string; usage?: TaskUsage }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; status: 'completed' | 'failed' | 'stopped'; summary: string; outputFile?: string; usage?: TaskUsage }
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'run_resumed' }
  | { type: 'error'; message: string }
  | { type: 'retrying'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string; scheduledAt?: number; runStartedAt?: number; totalAttempt?: number; maxTotalAttempts?: number }
  | { type: 'retry_attempt'; attemptData: RetryAttempt; runStartedAt?: number; maxAttempts?: number; totalAttempt?: number; maxTotalAttempts?: number }
  | { type: 'retry_cleared'; runStartedAt?: number; attempt?: number; maxAttempts?: number; totalAttempt?: number; maxTotalAttempts?: number }
  | { type: 'retry_failed'; finalAttempt: RetryAttempt; runStartedAt?: number; maxAttempts?: number; totalAttempt?: number; maxTotalAttempts?: number }
  | { type: 'retry_cancelled'; runStartedAt?: number; attempt: number; maxAttempts: number; totalAttempt?: number; maxTotalAttempts?: number; reason?: string }
  | { type: 'usage_update'; usage: AgentEventUsage }
  | { type: 'compacting' }
  | { type: 'compact_complete'; status: 'success' | 'noop' | 'failed'; summary?: string; message?: string; estimatedTokensAfter?: number }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  | { type: 'exit_plan_mode_request'; request: ExitPlanModeRequest }
  | { type: 'exit_plan_mode_resolved'; requestId: string }
  | { type: 'enter_plan_mode' }
  | { type: 'plan_mode_changed'; active: boolean; source: AgentPlanModeChangeSource }
  | { type: 'prompt_suggestion'; suggestion: string }
  | { type: 'model_resolved'; model: string }
  | { type: 'permission_mode_changed'; mode: PromaPermissionMode }

export function isRunScopedRetryUpdate(update: AgentLiveUpdate): update is Extract<AgentLiveUpdate, {
  type: 'retrying' | 'retry_attempt' | 'retry_cleared' | 'retry_failed' | 'retry_cancelled'
}> {
  return update.type === 'retrying'
    || update.type === 'retry_attempt'
    || update.type === 'retry_cleared'
    || update.type === 'retry_failed'
    || update.type === 'retry_cancelled'
}

export function shouldAcceptAgentRunStart(
  active: { runId?: string; startedAt?: number; running: boolean } | undefined,
  incoming: { runId: string; startedAt: number },
): boolean {
  if (!active) return true
  // 第一次 start 只会匹配尚无 runId 的 optimistic state；同 runId 再出现即为重复/迟到。
  if (active.runId === incoming.runId) return false
  if (active.runId == null && active.startedAt === incoming.startedAt) return true
  if (active.running) return false
  return active.startedAt == null || incoming.startedAt > active.startedAt
}

/** 旧 run 的终态不能清空已经开始的新 run；有 runId 时禁止退回时间大小比较。 */
export function isAgentRunSignalForCurrent(
  activeRunId: string | undefined,
  incomingRunId: string | undefined,
  activeStartedAt?: number,
  incomingStartedAt?: number,
): boolean {
  if (activeRunId) return incomingRunId === activeRunId
  return activeStartedAt === undefined
    || incomingStartedAt === activeStartedAt
}

/** @deprecated 仅供没有 runId 的旧调用者。 */
export function isStaleAgentRunSignal(
  activeStartedAt: number | undefined,
  incomingStartedAt: number | undefined,
): boolean {
  return !isAgentRunSignalForCurrent(undefined, undefined, activeStartedAt, incomingStartedAt)
}

/**
 * 领取依赖完整工具参数的外围副作用。partial 只更新工具卡片，不消耗领取资格；
 * final 对同一 session/toolUseId 最多成功一次。
 */
export function claimFinalToolSideEffects(
  claimedBySession: Map<string, Set<string>>,
  sessionId: string,
  update: AgentLiveUpdate,
): boolean {
  if (update.type !== 'tool_start' || !update.isFinal) return false
  const existing = claimedBySession.get(sessionId)
  if (existing?.has(update.toolUseId)) return false
  const next = existing ?? new Set<string>()
  next.add(update.toolUseId)
  if (!existing) claimedBySession.set(sessionId, next)
  return true
}

function isToolUseBlock(block: SDKContentBlock): block is SDKContentBlock & {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
} {
  return block.type === 'tool_use'
    && typeof block.id === 'string'
    && typeof block.name === 'string'
    && typeof block.input === 'object'
    && block.input !== null
}

export function toolStartFromBlock(
  block: SDKContentBlock,
  parentToolUseId: string | undefined,
  isFinal: boolean,
): Extract<AgentLiveUpdate, { type: 'tool_start' }> | null {
  if (!isToolUseBlock(block)) return null
  const intent = (block.input._intent as string | undefined)
    ?? (block.name === 'Bash' ? block.input.description as string | undefined : undefined)
  return {
    type: 'tool_start',
    toolName: block.name,
    toolUseId: block.id,
    input: block.input,
    intent,
    displayName: block.input._displayName as string | undefined,
    parentToolUseId,
    isFinal,
  }
}

export function usageUpdateFromAssistant(message: SDKAssistantMessage): Extract<AgentLiveUpdate, { type: 'usage_update' }> | null {
  if (message.parent_tool_use_id || !message.message.usage) return null
  const usage = message.message.usage
  const modelName = message._channelModelId ?? message.message.model
  const contextWindow = inferContextWindow(modelName)
  return {
    type: 'usage_update',
    usage: {
      inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens,
      ...(contextWindow ? { contextWindow } : {}),
    },
  }
}

function projectAssistant(message: SDKAssistantMessage, includeProgress: boolean): AgentLiveUpdate[] {
  if (message.isReplay) return []
  if (message.error) return [{ type: 'error', message: message.error.message }]

  const updates: AgentLiveUpdate[] = []
  if (includeProgress && message.message.content.length > 0) updates.push({ type: 'assistant_progress' })
  for (const block of message.message.content) {
    const toolStart = toolStartFromBlock(block, message.parent_tool_use_id ?? undefined, true)
    if (toolStart) updates.push(toolStart)
  }
  const usage = usageUpdateFromAssistant(message)
  if (usage) updates.push(usage)
  return updates
}

function projectAssistantDelta(payload: Extract<AgentRendererStreamPayload, { kind: 'assistant_message_delta' }>): AgentLiveUpdate[] {
  const updates: AgentLiveUpdate[] = []
  const toolStarts = new Map<string, Extract<AgentLiveUpdate, { type: 'tool_start' }>>()
  const parentToolUseId = payload.metadata?.parentToolUseId
    ?? payload.reset?.parent_tool_use_id
    ?? undefined

  if (payload.reset) {
    if (payload.reset.message.content.length > 0) updates.push({ type: 'assistant_progress' })
    for (const block of payload.reset.message.content) {
      const toolStart = toolStartFromBlock(block, parentToolUseId ?? undefined, false)
      if (toolStart) toolStarts.set(toolStart.toolUseId, toolStart)
    }
    const usage = usageUpdateFromAssistant(payload.reset)
    if (usage) updates.push(usage)
  }

  if (payload.operations.length > 0) updates.push({ type: 'assistant_progress' })
  for (const operation of payload.operations) {
    if (operation.type !== 'append_block' && operation.type !== 'replace_block') continue
    const toolStart = toolStartFromBlock(operation.block, parentToolUseId ?? undefined, false)
    if (toolStart) toolStarts.set(toolStart.toolUseId, toolStart)
  }
  updates.push(...toolStarts.values())

  if (payload.metadata?.usage && !payload.reset) {
    const usage = payload.metadata.usage
    const contextWindow = inferContextWindow(payload.metadata.channelModelId ?? payload.metadata.model)
    updates.push({
      type: 'usage_update',
      usage: {
        inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        ...(contextWindow ? { contextWindow } : {}),
      },
    })
  }

  return updates
}

function projectResult(message: AgentRendererStreamPayload & { kind: 'sdk_message' }): AgentLiveUpdate[] {
  const result = message.message as {
    type: 'result'
    subtype: string
    total_cost_usd?: number
    modelUsage?: Record<string, { contextWindow?: number }>
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
    isSyntheticCompactionResult?: boolean
    _channelModelId?: string
    _channelProvider?: ProviderType
  }
  if (result.isSyntheticCompactionResult) {
    return [{ type: 'complete', stopReason: result.subtype === 'success' ? 'end_turn' : 'error' }]
  }

  let contextWindow: number | undefined
  const fallbackWindow = inferContextWindow(result._channelModelId)
  if (result.modelUsage) {
    for (const [modelId, info] of Object.entries(result.modelUsage)) {
      const candidate = Math.max(
        info?.contextWindow ?? 0,
        inferContextWindow(result._channelModelId ?? modelId) ?? 0,
      ) || undefined
      if (candidate && (contextWindow === undefined || candidate > contextWindow)) contextWindow = candidate
    }
  } else {
    contextWindow = fallbackWindow
  }

  const usage = result.usage
  const inputTokens = usage
    ? usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    : undefined
  return [{
    type: 'complete',
    stopReason: result.subtype === 'success' ? 'end_turn' : 'error',
    usage: (result.total_cost_usd != null || contextWindow != null || usage != null) ? {
      costUsd: result.total_cost_usd,
      contextWindow,
      ...(inputTokens != null && { inputTokens }),
      ...(usage && { outputTokens: usage.output_tokens }),
      ...(usage && { cacheReadTokens: usage.cache_read_input_tokens }),
      ...(usage && { cacheCreationTokens: usage.cache_creation_input_tokens }),
    } : undefined,
  }]
}

function projectSystem(message: SDKSystemMessage): AgentLiveUpdate[] {
  if (message.subtype === 'compact_boundary') {
    const estimatedTokensAfter = message.compactionEstimatedTokensAfter
    return [{
      type: 'compact_complete',
      status: 'success',
      summary: message.summary,
      ...(typeof estimatedTokensAfter === 'number' && estimatedTokensAfter > 0 && { estimatedTokensAfter }),
    }]
  }
  if (message.subtype === 'compacting') return [{ type: 'compacting' }]
  if (message.subtype === 'status') {
    if (message.status === 'compacting') return [{ type: 'compacting' }]
    if (message.compact_result === 'success' || message.compact_result === 'failed' || message.compact_result === 'noop') {
      return [{
        type: 'compact_complete',
        status: message.compact_result,
        summary: message.summary,
        message: message.compact_error ?? message.message,
      }]
    }
    if (typeof message.compact_error === 'string') {
      return [{ type: 'compact_complete', status: 'failed', message: message.compact_error }]
    }
  }
  if (message.subtype === 'task_started' && message.task_id) {
    return [{ type: 'task_started', taskId: message.task_id, description: message.description ?? '', taskType: message.task_type, toolUseId: message.tool_use_id }]
  }
  if (message.subtype === 'task_notification' && message.task_id) {
    return [{
      type: 'task_notification',
      taskId: message.task_id,
      status: (message.status as 'completed' | 'failed' | 'stopped') ?? 'completed',
      summary: message.summary ?? '',
      outputFile: message.output_file,
      toolUseId: message.tool_use_id,
      usage: message.usage ? {
        totalTokens: message.usage.total_tokens ?? 0,
        toolUses: message.usage.tool_uses ?? 0,
        durationMs: message.usage.duration_ms ?? 0,
      } : undefined,
    }]
  }
  if (message.subtype === 'task_progress' && message.task_id) {
    return [{
      type: 'task_progress',
      taskId: message.task_id,
      toolUseId: message.tool_use_id ?? message.task_id,
      description: message.description,
      lastToolName: message.last_tool_name,
      usage: message.usage ? {
        totalTokens: message.usage.total_tokens ?? 0,
        toolUses: message.usage.tool_uses ?? 0,
        durationMs: message.usage.duration_ms ?? 0,
      } : undefined,
    }]
  }
  return []
}

function projectPromaEvent(payload: Extract<AgentRendererStreamPayload, { kind: 'proma_event' }>): AgentLiveUpdate[] {
  const event = payload.event
  switch (event.type) {
    case 'permission_request': return [{ type: 'permission_request', request: event.request }]
    case 'permission_resolved': return [{ type: 'permission_resolved', requestId: event.requestId, behavior: event.behavior }]
    case 'ask_user_request': return [{ type: 'ask_user_request', request: event.request }]
    case 'ask_user_resolved': return [{ type: 'ask_user_resolved', requestId: event.requestId }]
    case 'exit_plan_mode_request': return [{ type: 'exit_plan_mode_request', request: event.request }]
    case 'exit_plan_mode_resolved': return [{ type: 'exit_plan_mode_resolved', requestId: event.requestId }]
    case 'enter_plan_mode': return [{ type: 'enter_plan_mode' }]
    case 'plan_mode_changed': return [{ type: 'plan_mode_changed', active: event.active, source: event.source }]
    case 'model_resolved': return [{ type: 'model_resolved', model: event.model }]
    case 'context_window': return [{ type: 'usage_update', usage: { contextWindow: event.contextWindow } }]
    case 'permission_mode_changed': return [{ type: 'permission_mode_changed', mode: event.mode }]
    case 'run_resumed': return [{ type: 'run_resumed' }]
    case 'retry': {
      const scope = {
        runStartedAt: event.runStartedAt,
        totalAttempt: event.totalAttempt,
        maxTotalAttempts: event.maxTotalAttempts,
      }
      if (event.status === 'starting' && event.attempt != null && event.maxAttempts != null) {
        return [{ type: 'retrying', attempt: event.attempt, maxAttempts: event.maxAttempts, delaySeconds: event.delaySeconds ?? 0, reason: event.reason ?? '', scheduledAt: event.scheduledAt, ...scope }]
      }
      if (event.status === 'attempt' && event.attemptData) {
        return [{ type: 'retry_attempt', attemptData: event.attemptData, maxAttempts: event.maxAttempts, ...scope }]
      }
      if (event.status === 'cleared') {
        return [{ type: 'retry_cleared', attempt: event.attempt, maxAttempts: event.maxAttempts, ...scope }]
      }
      if (event.status === 'failed' && event.attemptData) {
        return [{ type: 'retry_failed', finalAttempt: event.attemptData, maxAttempts: event.maxAttempts, ...scope }]
      }
      if (event.status === 'cancelled' && event.attempt != null && event.maxAttempts != null) {
        return [{ type: 'retry_cancelled', attempt: event.attempt, maxAttempts: event.maxAttempts, reason: event.reason, ...scope }]
      }
      return []
    }
    default: return []
  }
}

/** 将唯一 canonical IPC payload 投影为 renderer 状态更新；正文始终留在 transcript store。 */
export function projectAgentLiveUpdates(payload: AgentRendererStreamPayload): AgentLiveUpdate[] {
  if (payload.kind === 'assistant_message_delta') return projectAssistantDelta(payload)
  if (payload.kind === 'proma_event') return projectPromaEvent(payload)

  const message = payload.message
  switch (message.type) {
    case 'assistant': return projectAssistant(message as SDKAssistantMessage, true)
    case 'user': {
      const user = message as SDKUserMessage
      if (user.isReplay) return []
      const updates: AgentLiveUpdate[] = []
      for (const block of user.message?.content ?? []) {
        if (block.type !== 'tool_result') continue
        const resultBlock = block as SDKUserContentBlock & { tool_use_id: string; content?: unknown; is_error?: boolean }
        const result = typeof resultBlock.content === 'string'
          ? resultBlock.content
          : resultBlock.content != null ? JSON.stringify(resultBlock.content) : ''
        updates.push({
          type: 'tool_result',
          toolUseId: resultBlock.tool_use_id,
          result,
          isError: resultBlock.is_error ?? false,
          parentToolUseId: user.parent_tool_use_id ?? undefined,
        })
      }
      return updates
    }
    case 'result': return projectResult(payload as AgentRendererStreamPayload & { kind: 'sdk_message' })
    case 'system': return projectSystem(message as SDKSystemMessage)
    case 'tool_progress': {
      const progress = message as { tool_use_id: string; elapsed_time_seconds?: number; task_id?: string }
      return [{ type: 'task_progress', toolUseId: progress.tool_use_id, elapsedSeconds: progress.elapsed_time_seconds, taskId: progress.task_id }]
    }
    case 'prompt_suggestion': {
      const suggestion = (message as { suggestion?: string }).suggestion
      return suggestion ? [{ type: 'prompt_suggestion', suggestion }] : []
    }
    default: return []
  }
}
