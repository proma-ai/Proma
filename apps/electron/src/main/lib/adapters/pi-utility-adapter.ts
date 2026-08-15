import { randomUUID } from 'node:crypto'
import {
  AGENT_RUNTIME_METHODS,
  type AgentRuntimeEvent,
  type AgentRuntimeRequest,
  type PiQueuedUserMessageInput,
  type PiRunSourceEvent,
  type SendQueuedMessageOptions,
} from '@proma/shared'
import type { PiAgentQueryOptions } from './pi-agent-adapter'
import type { AgentRuntimeClient } from '../agent-runtime-client'

type RuntimeClient = Pick<AgentRuntimeClient, 'call' | 'isReady' | 'onEvent'>

type PendingQuery = {
  queryId: string
  sessionId: string
  input: PiAgentQueryOptions
  queue: AsyncEventQueue<PiRunSourceEvent>
  accepted: boolean
  abortRequested: boolean
  runtimeFailed: boolean
}

type AsyncEventQueue<T> = {
  push: (value: T) => void
  end: () => void
  fail: (error: unknown) => void
  next: () => Promise<IteratorResult<T>>
}

/**
 * Adapter facade used by AgentOrchestrator during the utility migration.
 *
 * Pi sessions execute in utilityProcess. Tool definitions are transferred as
 * structured descriptors; their execute callbacks remain in main and are
 * invoked through capability RPC.
 */
export class PiUtilityAdapter {
  private readonly pendingQueries = new Map<string, PendingQuery>()
  private readonly capabilityAbortControllers = new Map<string, AbortController>()
  private readonly unsubscribeRuntimeEvents: () => void

  constructor(private readonly client: RuntimeClient) {
    this.unsubscribeRuntimeEvents = client.onEvent((event) => this.handleRuntimeEvent(event))
  }

  async *query(input: PiAgentQueryOptions): AsyncIterable<PiRunSourceEvent> {
    const queryId = randomUUID()
    const queue = createAsyncEventQueue<PiRunSourceEvent>()
    const pending: PendingQuery = {
      queryId,
      sessionId: input.sessionId,
      input,
      queue,
      accepted: false,
      abortRequested: false,
      runtimeFailed: false,
    }
    this.pendingQueries.set(queryId, pending)

    let ended = false
    try {
      const { queryId: _queryId, input: serializableInput } = {
        queryId,
        input: serializeQueryInput(input),
      }
      try {
        await this.client.call(AGENT_RUNTIME_METHODS.QUERY_START, { queryId: _queryId, input: serializableInput }, {
          sessionId: input.sessionId,
          runId: input.runId,
        })
        pending.accepted = true
      } catch (error) {
        await this.abortPendingQuery(pending, true).catch(() => {})
        throw error
      }
      if (pending.abortRequested) {
        await this.abortPendingQuery(pending)
        ended = true
        return
      }

      while (true) {
        const result = await queue.next()
        if (result.done) {
          ended = true
          return
        }
        yield result.value
      }
    } finally {
      this.pendingQueries.delete(queryId)
      if (!ended) await this.abortPendingQuery(pending)
    }
  }

  async abort(sessionId: string): Promise<void> {
    let pending: PendingQuery | undefined
    for (const candidate of this.pendingQueries.values()) {
      if (candidate.sessionId === sessionId) pending = candidate
    }
    if (!pending) return
    pending.abortRequested = true
    await this.abortPendingQuery(pending)
  }

  private async abortPendingQuery(pending: PendingQuery, force = false): Promise<void> {
    if ((!pending.accepted && !force) || pending.runtimeFailed || !this.client.isReady) return
    await this.client.call(AGENT_RUNTIME_METHODS.QUERY_ABORT, {
      queryId: pending.queryId,
      sessionId: pending.sessionId,
      runId: pending.input.runId,
    }, {
      sessionId: pending.sessionId,
      runId: pending.input.runId,
      timeoutMs: 5_000,
    })
  }

  async sendQueuedMessage(
    sessionId: string,
    message: PiQueuedUserMessageInput,
    options?: SendQueuedMessageOptions,
  ): Promise<void> {
    const { onAccepted: _onAccepted, ...serializableOptions } = options ?? {}
    await this.client.call(AGENT_RUNTIME_METHODS.QUERY_SEND_QUEUED_MESSAGE, {
      sessionId,
      message,
      options: serializableOptions,
    }, { sessionId })
    options?.onAccepted?.()
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    await this.client.call(AGENT_RUNTIME_METHODS.QUERY_SET_PERMISSION_MODE, { sessionId, mode }, { sessionId })
  }

  dispose(): void {
    this.unsubscribeRuntimeEvents()
    for (const pending of this.pendingQueries.values()) {
      pending.abortRequested = true
      pending.queue.fail(new Error('Agent utility stopped'))
    }
    this.pendingQueries.clear()
    for (const controller of this.capabilityAbortControllers.values()) controller.abort()
    this.capabilityAbortControllers.clear()
  }

  /** Handles utility -> main capability requests and callback events. */
  async handleRuntimeRequest(request: AgentRuntimeRequest): Promise<unknown> {
    const payload = request.payload as Record<string, unknown> | undefined
    const queryId = typeof payload?.queryId === 'string' ? payload.queryId : undefined
    const pending = queryId ? this.pendingQueries.get(queryId) : undefined

    if (request.method === AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL) {
      if (!pending?.input.canUseTool) throw new Error(`No canUseTool handler for query: ${queryId ?? 'unknown'}`)
      const options = (payload?.options && typeof payload.options === 'object'
        ? payload.options
        : {}) as Record<string, unknown>
      const controller = new AbortController()
      this.capabilityAbortControllers.set(request.requestId, controller)
      try {
        return await pending.input.canUseTool(
          String(payload?.toolName ?? ''),
          (payload?.input && typeof payload.input === 'object' ? payload.input : {}) as Record<string, unknown>,
          { ...options, signal: controller.signal } as never,
        )
      } finally {
        this.capabilityAbortControllers.delete(request.requestId)
      }
    }

    if (request.method === AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL) {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
      this.capabilityAbortControllers.get(requestId)?.abort()
      return { accepted: true }
    }

    if (request.method === AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL) {
      const toolName = typeof payload?.toolName === 'string' ? payload.toolName : ''
      const tool = pending?.input.customTools?.find((candidate) => candidate.name === toolName)
      if (!tool) throw new Error(`No custom tool handler for query: ${queryId ?? 'unknown'}, tool: ${toolName}`)
      const controller = new AbortController()
      this.capabilityAbortControllers.set(request.requestId, controller)
      try {
        const execute = tool.execute as unknown as (...args: unknown[]) => Promise<unknown>
        return await execute(
          String(payload?.toolCallId ?? ''),
          (payload?.input && typeof payload.input === 'object' ? payload.input : {}) as Record<string, unknown>,
          controller.signal,
          () => {},
        )
      } finally {
        this.capabilityAbortControllers.delete(request.requestId)
      }
    }

    if (request.method === AGENT_RUNTIME_METHODS.CAPABILITY_CODEX_OAUTH_REFRESHED) {
      await pending?.input.onCodexOAuthCredentialsRefreshed?.(payload?.credentials as never)
      return { accepted: true }
    }

    if (request.method === AGENT_RUNTIME_METHODS.CAPABILITY_XAI_OAUTH_REFRESHED) {
      await pending?.input.onXaiOAuthCredentialsRefreshed?.(payload?.credentials as never)
      return { accepted: true }
    }

    throw new Error(`Unsupported Agent utility request: ${request.method}`)
  }

  private handleRuntimeEvent(event: AgentRuntimeEvent): void {
    if (event.method === AGENT_RUNTIME_METHODS.EVENT_CRASHED) {
      const error = toRuntimeError(event.payload)
      for (const controller of this.capabilityAbortControllers.values()) controller.abort()
      this.capabilityAbortControllers.clear()
      for (const pending of this.pendingQueries.values()) {
        pending.runtimeFailed = true
        pending.queue.fail(error)
      }
      return
    }
    const payload = event.payload as Record<string, unknown> | undefined
    const queryId = typeof payload?.queryId === 'string' ? payload.queryId : undefined
    if (!queryId) return
    const pending = this.pendingQueries.get(queryId)
    if (!pending) return

    if (event.method === AGENT_RUNTIME_METHODS.EVENT_QUERY) {
      if (payload?.event) pending.queue.push(payload.event as PiRunSourceEvent)
      return
    }
    if (event.method === AGENT_RUNTIME_METHODS.EVENT_QUERY_END) {
      pending.queue.end()
      return
    }
    if (event.method === AGENT_RUNTIME_METHODS.EVENT_QUERY_ERROR) {
      pending.queue.fail(toRuntimeError(payload?.error))
      return
    }
    if (event.method !== AGENT_RUNTIME_METHODS.EVENT_QUERY_CALLBACK) return

    const callback = payload?.callback
    const callbackPayload = payload?.payload as Record<string, unknown> | undefined
    switch (callback) {
      case 'session_id':
        pending.input.onSessionId?.(String(callbackPayload?.sdkSessionId ?? ''), callbackPayload?.sessionFile as string | undefined)
        break
      case 'pi_entry_bindings':
        pending.input.onPiEntryBindings?.((callbackPayload?.bindings ?? {}) as Record<string, string>)
        break
      case 'model_resolved':
        pending.input.onModelResolved?.(String(callbackPayload?.model ?? ''))
        break
      case 'context_window':
        pending.input.onContextWindow?.(Number(callbackPayload?.contextWindow ?? 0))
        break
      case 'retry':
        pending.input.onRetry?.(callbackPayload?.update as never)
        break
      case 'skill_activated':
        pending.input.onSkillActivated?.(
          (callbackPayload?.activations ?? []) as never,
          String(callbackPayload?.userMessageUuid ?? ''),
        )
        break
    }
  }
}

function serializeQueryInput(input: PiAgentQueryOptions): Record<string, unknown> {
  const {
    abortSignal: _abortSignal,
    canUseTool: _canUseTool,
    customTools,
    onSessionId: _onSessionId,
    onPiEntryBindings: _onPiEntryBindings,
    onModelResolved: _onModelResolved,
    onContextWindow: _onContextWindow,
    onRetry: _onRetry,
    onSkillActivated: _onSkillActivated,
    onCodexOAuthCredentialsRefreshed: _onCodexOAuthCredentialsRefreshed,
    onXaiOAuthCredentialsRefreshed: _onXaiOAuthCredentialsRefreshed,
    ...serializable
  } = input
  const serializedCustomTools = (customTools ?? []).map((tool) => {
    const { execute: _execute, ...descriptor } = tool as unknown as Record<string, unknown>
    return descriptor
  })
  return {
    ...serializable,
    ...(serializedCustomTools.length > 0 ? { customTools: serializedCustomTools } : {}),
  } as Record<string, unknown>
}

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = []
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  let ended = false
  let failure: unknown

  return {
    push(value) {
      if (ended || failure !== undefined) return
      const waiter = waiters.shift()
      if (waiter) waiter.resolve({ done: false, value })
      else values.push(value)
    },
    end() {
      if (ended || failure !== undefined) return
      ended = true
      while (waiters.length > 0) waiters.shift()!.resolve({ done: true, value: undefined })
    },
    fail(error) {
      if (ended || failure !== undefined) return
      failure = error
      while (waiters.length > 0) waiters.shift()!.reject(error)
    },
    async next() {
      if (values.length > 0) return { done: false, value: values.shift()! }
      if (failure !== undefined) throw failure
      if (ended) return { done: true, value: undefined }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    },
  }
}

function toRuntimeError(value: unknown): Error {
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    const error = new Error((value as { message: string }).message)
    Object.assign(error, value)
    return error
  }
  return new Error(typeof value === 'string' ? value : 'Agent utility query failed')
}
