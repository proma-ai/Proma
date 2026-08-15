import { randomUUID } from 'node:crypto'
import {
  AGENT_RUNTIME_METHODS,
  AGENT_RUNTIME_PROTOCOL_VERSION,
  createAgentRuntimeRequest,
  createAgentRuntimeResponse,
  isAgentRuntimeEnvelope,
  serializeAgentRuntimeError,
  type AgentRuntimeHandshakePayload,
  type AgentRuntimeRequest,
  type AgentRuntimeResponse,
  type AgentRuntimeState,
} from '@proma/shared'
import { PiAgentAdapter, type PiAgentQueryOptions } from '../main/lib/adapters/pi-agent-adapter'

type MessagePortLike = {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start(): void
  close(): void
}

type ParentPortLike = {
  on(event: 'message', listener: (event: { data: unknown; ports?: MessagePortLike[] }) => void): void
  start?: () => void
}

type RuntimeRequest = AgentRuntimeRequest & { payload?: Record<string, unknown> }
type PendingParentRequest = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
  cleanup?: () => void
}
type ActiveQuery = {
  queryId: string
  sessionId: string
  runId?: string
  sequence: number
  done: Promise<void>
  resolveDone: () => void
}

const bootId = randomUUID()
let runtimePort: MessagePortLike | undefined
let status: AgentRuntimeState['status'] = 'starting'
const parentRequests = new Map<string, PendingParentRequest>()
const activeQueries = new Map<string, ActiveQuery>()
const piAdapter = new PiAgentAdapter()

const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort

if (!parentPort) {
  console.error('[AgentRuntime] Electron parentPort is unavailable')
  process.exit(1)
}

parentPort.on('message', (event) => {
  const value = event?.data as Record<string, unknown> | undefined
  const transfer = value?.data && typeof value.data === 'object'
    ? value.data as Record<string, unknown>
    : value
  if (!transfer || transfer.type !== 'proma-agent-runtime-port') return

  const protocolVersion = transfer.protocolVersion
  const port = event.ports?.[0] ?? value?.port as MessagePortLike | undefined
  if (protocolVersion !== AGENT_RUNTIME_PROTOCOL_VERSION || !port) {
    console.error('[AgentRuntime] invalid MessagePort bootstrap message')
    process.exit(1)
  }
  attachRuntimePort(port)
})
parentPort.start?.()

function attachRuntimePort(port: MessagePortLike): void {
  runtimePort?.close()
  runtimePort = port
  status = 'ready'
  port.on('message', (event) => handleMessage(event.data))
  port.start()
  emitState()
}

function getState(): AgentRuntimeState {
  return {
    status,
    bootId,
    pid: process.pid,
    activeRuns: activeQueries.size,
    pendingRequests: 0,
  }
}

function emitState(): void {
  sendEvent(AGENT_RUNTIME_METHODS.EVENT_STATE, getState())
}

function sendEvent(method: string, payload: unknown, context: { sessionId?: string; runId?: string; sequence?: number } = {}): void {
  runtimePort?.postMessage({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    bootId,
    kind: 'event',
    method,
    payload,
    ...context,
  })
}

function handleMessage(rawMessage: unknown): void {
  if (!isAgentRuntimeEnvelope(rawMessage)) {
    console.warn('[AgentRuntime] ignored malformed message')
    return
  }
  if (rawMessage.kind === 'response') {
    resolveParentRequest(rawMessage)
    return
  }
  if (rawMessage.kind !== 'request') {
    console.warn('[AgentRuntime] ignored event sent to utility')
    return
  }

  const request = rawMessage as RuntimeRequest
  if (request.method !== AGENT_RUNTIME_METHODS.HANDSHAKE && request.bootId !== bootId) {
    respondError(request, {
      code: 'runtime.stale_boot',
      message: 'Request belongs to a different utility boot',
    })
    return
  }

  switch (request.method) {
    case AGENT_RUNTIME_METHODS.HANDSHAKE:
      handleHandshake(request)
      return
    case AGENT_RUNTIME_METHODS.PING:
      respond(request, { pong: true, state: getState() })
      return
    case AGENT_RUNTIME_METHODS.GET_STATE:
      respond(request, getState())
      return
    case AGENT_RUNTIME_METHODS.CANCEL:
      respond(request, { cancelled: false, reason: 'no cancellable operation' })
      return
    case AGENT_RUNTIME_METHODS.SHUTDOWN:
      handleShutdown(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_START:
      handleQueryStart(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_ABORT:
      handleQueryAbort(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_SET_PERMISSION_MODE:
      void handleQuerySetPermissionMode(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_SEND_QUEUED_MESSAGE:
      void handleQuerySendQueuedMessage(request)
      return
    default:
      respondError(request, {
        code: 'runtime.method_not_found',
        message: `Unsupported runtime method: ${request.method}`,
      })
  }
}

function handleQueryStart(request: RuntimeRequest): void {
  const payload = request.payload ?? {}
  const queryId = typeof payload.queryId === 'string' ? payload.queryId : ''
  const input = payload.input
  if (!queryId || !input || typeof input !== 'object') {
    respondError(request, {
      code: 'agent.query.invalid_input',
      message: 'agent.query.start requires queryId and input',
    })
    return
  }

  const queryInput = input as Record<string, unknown>
  const sessionId = typeof queryInput.sessionId === 'string' ? queryInput.sessionId : ''
  if (!sessionId) {
    respondError(request, {
      code: 'agent.query.invalid_session',
      message: 'agent.query.start requires sessionId',
    })
    return
  }
  if ([...activeQueries.values()].some((active) => active.sessionId === sessionId)) {
    respondError(request, {
      code: 'agent.query.already_active',
      message: `Agent session is already active: ${sessionId}`,
    })
    return
  }

  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const active: ActiveQuery = {
    queryId,
    sessionId,
    runId: typeof queryInput.runId === 'string' ? queryInput.runId : undefined,
    sequence: 0,
    done,
    resolveDone,
  }
  activeQueries.set(queryId, active)
  emitState()
  respond(request, { accepted: true, queryId })

  const utilityInput: Record<string, unknown> = {
    ...queryInput,
    canUseTool: (toolName: string, toolInput: Record<string, unknown>, options: Record<string, unknown>) =>
      requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL, {
        queryId,
        sessionId,
        toolName,
        input: toolInput,
        options: serializeCanUseToolOptions(options),
      }, {
        sessionId,
        runId: typeof queryInput.runId === 'string' ? queryInput.runId : undefined,
        signal: options.signal as AbortSignal | undefined,
      }),
    onSessionId: (sdkSessionId: string, sessionFile?: string) => {
      sendQueryCallback(active, 'session_id', { sdkSessionId, sessionFile })
    },
    onPiEntryBindings: (bindings: Record<string, string>) => {
      sendQueryCallback(active, 'pi_entry_bindings', { bindings })
    },
    onModelResolved: (model: string) => {
      sendQueryCallback(active, 'model_resolved', { model })
    },
    onContextWindow: (contextWindow: number) => {
      sendQueryCallback(active, 'context_window', { contextWindow })
    },
    onRetry: (update: unknown) => {
      sendQueryCallback(active, 'retry', { update })
    },
    onSkillActivated: (activations: unknown, userMessageUuid: string) => {
      sendQueryCallback(active, 'skill_activated', { activations, userMessageUuid })
    },
    onCodexOAuthCredentialsRefreshed: (credentials: unknown) =>
      requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_CODEX_OAUTH_REFRESHED, { queryId, sessionId, credentials }, {
        sessionId,
        runId: typeof queryInput.runId === 'string' ? queryInput.runId : undefined,
      }),
    onXaiOAuthCredentialsRefreshed: (credentials: unknown) =>
      requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_XAI_OAUTH_REFRESHED, { queryId, sessionId, credentials }, {
        sessionId,
        runId: typeof queryInput.runId === 'string' ? queryInput.runId : undefined,
      }),
  }
  utilityInput.customTools = createProxyCustomTools(active, queryInput.customTools)

  void pumpQuery(active, utilityInput as unknown as PiAgentQueryOptions)
}

function serializeCanUseToolOptions(options: Record<string, unknown>): Record<string, unknown> {
  const { signal: _signal, ...serializable } = options
  return serializable
}

function createProxyCustomTools(active: ActiveQuery, rawTools: unknown): unknown[] {
  if (!Array.isArray(rawTools)) return []
  return rawTools.map((rawTool) => {
    const descriptor = rawTool && typeof rawTool === 'object'
      ? rawTool as Record<string, unknown>
      : {}
    const toolName = typeof descriptor.name === 'string' ? descriptor.name : ''
    return {
      ...descriptor,
      async execute(toolCallId: string, input: Record<string, unknown>, signal: AbortSignal) {
        return requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL, {
          queryId: active.queryId,
          sessionId: active.sessionId,
          toolName,
          toolCallId,
          input,
        }, {
          sessionId: active.sessionId,
          runId: active.runId,
          signal,
        })
      },
    }
  })
}

function sendQueryCallback(active: ActiveQuery, callback: string, payload: unknown): void {
  sendEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_CALLBACK, { queryId: active.queryId, callback, payload }, {
    sessionId: active.sessionId,
    runId: active.runId,
    sequence: ++active.sequence,
  })
}

async function pumpQuery(active: ActiveQuery, input: PiAgentQueryOptions): Promise<void> {
  try {
    for await (const event of piAdapter.query(input)) {
      sendEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY, { queryId: active.queryId, event }, {
        sessionId: active.sessionId,
        runId: active.runId,
        sequence: ++active.sequence,
      })
    }
    sendEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_END, { queryId: active.queryId }, {
      sessionId: active.sessionId,
      runId: active.runId,
      sequence: ++active.sequence,
    })
  } catch (error) {
    sendEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_ERROR, {
      queryId: active.queryId,
      error: serializeAgentRuntimeError(error, 'agent.query.failed'),
    }, {
      sessionId: active.sessionId,
      runId: active.runId,
      sequence: ++active.sequence,
    })
  } finally {
    activeQueries.delete(active.queryId)
    active.resolveDone()
    emitState()
  }
}

async function handleQueryAbort(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  const queryId = typeof payload.queryId === 'string' ? payload.queryId : ''
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const runId = typeof payload.runId === 'string' ? payload.runId : undefined
  if (!queryId || !sessionId) {
    respondError(request, {
      code: 'agent.query.invalid_abort',
      message: 'queryId and sessionId are required',
    })
    return
  }

  const active = activeQueries.get(queryId)
  if (!active || active.sessionId !== sessionId || (runId !== undefined && active.runId !== runId)) {
    respond(request, { accepted: false, reason: 'stale_or_inactive_query', queryId })
    return
  }

  piAdapter.abort(active.sessionId)
  const completed = await Promise.race([
    active.done.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!completed) {
    respondError(request, {
      code: 'agent.query.abort_timeout',
      message: `Timed out waiting for query to stop: ${queryId}`,
      retryable: true,
    })
    // An unresponsive Pi query may still hold side-effecting tool work. The
    // utility cannot safely continue serving other sessions after this point.
    setTimeout(() => {
      piAdapter.dispose()
      process.exit(1)
    }, 0)
    return
  }
  respond(request, { accepted: true, queryId })
}

async function handleQuerySetPermissionMode(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  if (typeof payload.sessionId !== 'string' || typeof payload.mode !== 'string') {
    respondError(request, {
      code: 'agent.query.invalid_permission_mode',
      message: 'sessionId and mode are required',
    })
    return
  }
  try {
    await piAdapter.setPermissionMode(payload.sessionId, payload.mode)
    respond(request, { accepted: true })
  } catch (error) {
    respondError(request, error)
  }
}

async function handleQuerySendQueuedMessage(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  if (typeof payload.sessionId !== 'string' || !payload.message || typeof payload.message !== 'object') {
    respondError(request, {
      code: 'agent.query.invalid_queued_message',
      message: 'sessionId and message are required',
    })
    return
  }
  try {
    await piAdapter.sendQueuedMessage(
      payload.sessionId,
      payload.message as never,
      payload.options as never,
    )
    respond(request, { accepted: true })
  } catch (error) {
    respondError(request, error)
  }
}

function resolveParentRequest(response: AgentRuntimeResponse): void {
  const pending = parentRequests.get(response.requestId)
  if (!pending) return
  parentRequests.delete(response.requestId)
  pending.cleanup?.()
  if (response.ok) {
    pending.resolve(response.payload)
  } else {
    const error = response.error ?? {
      code: 'runtime.parent_request_failed',
      message: `Main runtime request failed: ${response.method}`,
    }
    pending.reject(Object.assign(new Error(error.message), error))
  }
}

function requestParent<Result = unknown>(
  method: string,
  payload: unknown,
  options: { sessionId?: string; runId?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Result> {
  const port = runtimePort
  if (!port) return Promise.reject(new Error('Agent runtime port is not connected'))
  const request = createAgentRuntimeRequest(method, payload, {
    sessionId: options.sessionId,
    runId: options.runId,
  }, bootId)
  const timeoutMs = options.timeoutMs ?? 120_000

  return new Promise<Result>((resolve, reject) => {
    let pending: PendingParentRequest | undefined
    let removeAbortListener = (): void => {}
    const timer = setTimeout(() => {
      if (!pending || !parentRequests.delete(request.requestId)) return
      pending.cleanup?.()
      void requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL, {
        requestId: request.requestId,
      }, {
        sessionId: options.sessionId,
        runId: options.runId,
        timeoutMs: 2_000,
      }).catch(() => {})
      reject(new Error(`Main runtime request timed out: ${method}`))
    }, timeoutMs)
    pending = {
      resolve: (value) => resolve(value as Result),
      reject,
      timer,
      cleanup: () => {
        clearTimeout(timer)
        removeAbortListener()
      },
    }
    parentRequests.set(request.requestId, pending)

    if (options.signal) {
      const abort = (): void => {
        if (!parentRequests.delete(request.requestId)) return
        void requestParent(AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL, { requestId: request.requestId }).catch(() => {})
        pending?.cleanup?.()
        reject(new Error(`Main runtime request aborted: ${method}`))
      }
      if (options.signal.aborted) {
        abort()
        return
      }
      options.signal.addEventListener('abort', abort, { once: true })
      removeAbortListener = () => options.signal?.removeEventListener('abort', abort)
    }

    try {
      port.postMessage(request)
    } catch (error) {
      parentRequests.delete(request.requestId)
      pending.cleanup?.()
      reject(error)
    }
  })
}

function handleHandshake(request: RuntimeRequest): void {
  const requestedVersion = request.payload?.protocolVersion
  if (requestedVersion !== AGENT_RUNTIME_PROTOCOL_VERSION) {
    respondError(request, {
      code: 'runtime.protocol_version_unsupported',
      message: `Unsupported protocol version: ${String(requestedVersion)}`,
    })
    return
  }

  const payload: AgentRuntimeHandshakePayload = {
    runtimeVersion: 'utility-bootstrap/1',
    pid: process.pid,
    capabilities: [
      AGENT_RUNTIME_METHODS.HANDSHAKE,
      AGENT_RUNTIME_METHODS.PING,
      AGENT_RUNTIME_METHODS.GET_STATE,
      AGENT_RUNTIME_METHODS.CANCEL,
      AGENT_RUNTIME_METHODS.SHUTDOWN,
      AGENT_RUNTIME_METHODS.QUERY_START,
      AGENT_RUNTIME_METHODS.QUERY_ABORT,
      AGENT_RUNTIME_METHODS.QUERY_SET_PERMISSION_MODE,
      AGENT_RUNTIME_METHODS.QUERY_SEND_QUEUED_MESSAGE,
      AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL,
      AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL,
      AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL,
      AGENT_RUNTIME_METHODS.CAPABILITY_CODEX_OAUTH_REFRESHED,
      AGENT_RUNTIME_METHODS.CAPABILITY_XAI_OAUTH_REFRESHED,
    ],
    state: getState(),
  }
  respond(request, payload)
}

function handleShutdown(request: RuntimeRequest): void {
  status = 'stopping'
  piAdapter.dispose()
  for (const pending of parentRequests.values()) {
    pending.cleanup?.()
    pending.reject(new Error('Agent runtime is shutting down'))
  }
  parentRequests.clear()
  emitState()
  respond(request, { accepted: true })
  setTimeout(() => {
    status = 'stopped'
    runtimePort?.close()
    process.exit(0)
  }, 0)
}

function respond(request: RuntimeRequest, payload: unknown): void {
  runtimePort?.postMessage(createAgentRuntimeResponse(request, { payload }, bootId))
}

function respondError(request: RuntimeRequest, error: unknown): void {
  runtimePort?.postMessage(createAgentRuntimeResponse(request, {
    error: serializeAgentRuntimeError(error),
  }, bootId))
}
