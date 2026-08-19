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
  cleanup: () => void
}
type ActiveQuery = {
  queryId: string
  sessionId: string
  sequence: number
  done: Promise<void>
  resolveDone: () => void
}

const bootId = randomUUID()
let runtimePort: MessagePortLike | undefined
let status: AgentRuntimeState['status'] = 'starting'
let activeQuery: ActiveQuery | undefined
const parentRequests = new Map<string, PendingParentRequest>()
const capabilityAbortControllers = new Map<string, AbortController>()
const piAdapter = new PiAgentAdapter()
const parentPort = (process as typeof process & { parentPort?: ParentPortLike }).parentPort

if (!parentPort) {
  console.error('[AgentRuntime] Electron parentPort is unavailable')
  process.exit(1)
}

parentPort.on('message', (event) => {
  const value = event?.data as Record<string, unknown> | undefined
  const transfer = value?.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : value
  if (!transfer || transfer.type !== 'proma-agent-runtime-port') return
  const port = event.ports?.[0] ?? value?.port as MessagePortLike | undefined
  if (transfer.protocolVersion !== AGENT_RUNTIME_PROTOCOL_VERSION || !port) {
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
    active: activeQuery !== undefined,
    pendingRequests: parentRequests.size,
  }
}

function emitState(): void {
  sendEvent(AGENT_RUNTIME_METHODS.EVENT_STATE, getState())
}

function sendEvent(method: string, payload: unknown, sequence?: number): void {
  runtimePort?.postMessage({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    bootId,
    kind: 'event',
    method,
    sessionId: activeQuery?.sessionId,
    queryId: activeQuery?.queryId,
    ...(sequence === undefined ? {} : { sequence }),
    payload,
  })
}

function sendQueryEvent(method: string, payload: unknown): void {
  if (!activeQuery) return
  activeQuery.sequence += 1
  sendEvent(method, payload, activeQuery.sequence)
}

function handleMessage(rawMessage: unknown): void {
  if (!isAgentRuntimeEnvelope(rawMessage)) return
  if (rawMessage.kind === 'response') {
    resolveParentRequest(rawMessage)
    return
  }
  if (rawMessage.kind !== 'request') return
  const request = rawMessage as RuntimeRequest
  if (request.method !== AGENT_RUNTIME_METHODS.HANDSHAKE && request.bootId !== bootId) {
    respondError(request, { code: 'runtime.stale_boot', message: 'Request belongs to a different utility boot' })
    return
  }

  switch (request.method) {
    case AGENT_RUNTIME_METHODS.HANDSHAKE:
      handleHandshake(request)
      return
    case AGENT_RUNTIME_METHODS.SHUTDOWN:
      void handleShutdown(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_START:
      handleQueryStart(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_ABORT:
      void handleQueryAbort(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_SEND_QUEUED_MESSAGE:
      void handleQueuedMessage(request)
      return
    case AGENT_RUNTIME_METHODS.QUERY_SET_PERMISSION_MODE:
      void handleSetPermissionMode(request)
      return
    default:
      respondError(request, { code: 'runtime.method_not_found', message: `Unsupported runtime method: ${request.method}` })
  }
}

function handleQueryStart(request: RuntimeRequest): void {
  const payload = request.payload ?? {}
  const queryId = typeof payload.queryId === 'string' ? payload.queryId : ''
  const input = payload.input
  if (!queryId || !input || typeof input !== 'object') {
    respondError(request, { code: 'agent.query.invalid_input', message: 'queryId and input are required' })
    return
  }
  if (activeQuery) {
    respondError(request, { code: 'agent.query.already_active', message: 'Agent runtime already has an active query' })
    return
  }
  const queryInput = input as Record<string, unknown>
  const sessionId = typeof queryInput.sessionId === 'string' ? queryInput.sessionId : ''
  if (!sessionId) {
    respondError(request, { code: 'agent.query.invalid_session', message: 'sessionId is required' })
    return
  }

  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => { resolveDone = resolve })
  const active: ActiveQuery = { queryId, sessionId, sequence: 0, done, resolveDone }
  activeQuery = active
  emitState()
  respond(request, { accepted: true, queryId })

  const utilityInput = {
    ...queryInput,
    canUseTool: (toolName: string, toolInput: Record<string, unknown>, options: Record<string, unknown>) => requestParent(
      AGENT_RUNTIME_METHODS.CAPABILITY_CAN_USE_TOOL,
      { queryId, sessionId, toolName, input: toolInput, options: serializeCanUseToolOptions(options) },
      options.signal as AbortSignal | undefined,
    ),
    onSessionId: (sdkSessionId: string, sessionFile?: string) => sendCallback(active, 'session_id', { sdkSessionId, sessionFile }),
    onPiEntryBindings: (bindings: Record<string, string>) => sendCallback(active, 'pi_entry_bindings', { bindings }),
    onModelResolved: (model: string) => sendCallback(active, 'model_resolved', { model }),
    onContextWindow: (contextWindow: number) => sendCallback(active, 'context_window', { contextWindow }),
    onRetry: (update: unknown) => sendCallback(active, 'retry', { update }),
    onSkillActivated: (activations: unknown, userMessageUuid: string) => sendCallback(active, 'skill_activated', { activations, userMessageUuid }),
    onCodexOAuthCredentialsRefreshed: (credentials: unknown) => requestParent(
      AGENT_RUNTIME_METHODS.CAPABILITY_CODEX_OAUTH_REFRESHED,
      { queryId, sessionId, credentials },
    ),
    onXaiOAuthCredentialsRefreshed: (credentials: unknown) => requestParent(
      AGENT_RUNTIME_METHODS.CAPABILITY_XAI_OAUTH_REFRESHED,
      { queryId, sessionId, credentials },
    ),
  }
  ;(utilityInput as Record<string, unknown>).customTools = createProxyCustomTools(active, queryInput.customTools)
  void pumpQuery(active, utilityInput as unknown as PiAgentQueryOptions)
}

function serializeCanUseToolOptions(options: Record<string, unknown>): Record<string, unknown> {
  const { signal: _signal, ...serializable } = options
  return serializable
}

function createProxyCustomTools(active: ActiveQuery, rawTools: unknown): unknown[] {
  if (!Array.isArray(rawTools)) return []
  return rawTools.map((rawTool) => {
    const descriptor = rawTool && typeof rawTool === 'object' ? rawTool as Record<string, unknown> : {}
    const toolName = typeof descriptor.name === 'string' ? descriptor.name : ''
    return {
      ...descriptor,
      async execute(toolCallId: string, input: Record<string, unknown>, signal: AbortSignal) {
        return requestParent(
          AGENT_RUNTIME_METHODS.CAPABILITY_CUSTOM_TOOL,
          { queryId: active.queryId, sessionId: active.sessionId, toolName, toolCallId, input },
          signal,
        )
      },
    }
  })
}

function sendCallback(active: ActiveQuery, callback: string, payload: unknown): void {
  if (activeQuery !== active) return
  sendQueryEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_CALLBACK, { callback, payload })
}

async function pumpQuery(active: ActiveQuery, input: PiAgentQueryOptions): Promise<void> {
  try {
    for await (const message of piAdapter.query(input)) {
      if (activeQuery !== active) break
      sendQueryEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY, { message })
    }
    if (activeQuery === active) sendQueryEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_END, {})
  } catch (error) {
    if (activeQuery === active) {
      sendQueryEvent(AGENT_RUNTIME_METHODS.EVENT_QUERY_ERROR, {
        error: serializeAgentRuntimeError(error, 'agent.query.failed'),
      })
    }
  } finally {
    if (activeQuery === active) {
      activeQuery = undefined
      emitState()
    }
    active.resolveDone()
  }
}

async function handleQueryAbort(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  const queryId = typeof payload.queryId === 'string' ? payload.queryId : ''
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : ''
  if (!activeQuery || activeQuery.queryId !== queryId || activeQuery.sessionId !== sessionId) {
    respond(request, { accepted: false, reason: 'stale_or_inactive_query' })
    return
  }
  const query = activeQuery
  piAdapter.abort(sessionId)
  const completed = await Promise.race([
    query.done.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  respond(request, { accepted: true, queryId, completed })
}

async function handleQueuedMessage(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  if (!activeQuery || typeof payload.sessionId !== 'string' || payload.sessionId !== activeQuery.sessionId) {
    respondError(request, { code: 'agent.query.not_active', message: 'Agent session is not active' })
    return
  }
  try {
    await piAdapter.sendQueuedMessage(
      activeQuery.sessionId,
      payload.message as never,
      payload.options as never,
    )
    respond(request, { accepted: true })
  } catch (error) {
    respondError(request, error)
  }
}

async function handleSetPermissionMode(request: RuntimeRequest): Promise<void> {
  const payload = request.payload ?? {}
  if (!activeQuery || payload.sessionId !== activeQuery.sessionId || typeof payload.mode !== 'string') {
    respondError(request, { code: 'agent.query.not_active', message: 'Agent session is not active' })
    return
  }
  await piAdapter.setPermissionMode(activeQuery.sessionId, payload.mode)
  respond(request, { accepted: true })
}

async function handleShutdown(request: RuntimeRequest): Promise<void> {
  status = 'stopping'
  if (activeQuery) piAdapter.abort(activeQuery.sessionId)
  piAdapter.dispose()
  for (const pending of parentRequests.values()) {
    pending.cleanup()
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

function requestParent<Result = unknown>(
  method: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<Result> {
  const port = runtimePort
  if (!port) return Promise.reject(new Error('Agent runtime port is not connected'))
  const request = createAgentRuntimeRequest(method, payload, {
    sessionId: activeQuery?.sessionId,
    queryId: activeQuery?.queryId,
  }, bootId)

  return new Promise<Result>((resolve, reject) => {
    let removeAbortListener = (): void => {}
    const cleanup = (): void => {
      clearTimeout(timer)
      removeAbortListener()
    }
    const timer = setTimeout(() => {
      if (!parentRequests.delete(request.requestId)) return
      cleanup()
      port.postMessage(createAgentRuntimeRequest(
        AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL,
        { requestId: request.requestId },
        { sessionId: activeQuery?.sessionId, queryId: activeQuery?.queryId },
        bootId,
      ))
      reject(new Error(`Main runtime request timed out: ${method}`))
    }, 120_000)
    parentRequests.set(request.requestId, {
      resolve: (value) => resolve(value as Result),
      reject,
      timer,
      cleanup,
    })
    if (signal) {
      const abort = (): void => {
        if (!parentRequests.delete(request.requestId)) return
        cleanup()
        port.postMessage(createAgentRuntimeRequest(
          AGENT_RUNTIME_METHODS.CAPABILITY_CANCEL,
          { requestId: request.requestId },
          { sessionId: activeQuery?.sessionId, queryId: activeQuery?.queryId },
          bootId,
        ))
        reject(new Error(`Main runtime request aborted: ${method}`))
      }
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      removeAbortListener = () => signal.removeEventListener('abort', abort)
    }
    port.postMessage(request)
  })
}

function resolveParentRequest(response: AgentRuntimeResponse): void {
  const pending = parentRequests.get(response.requestId)
  if (!pending) return
  parentRequests.delete(response.requestId)
  pending.cleanup()
  if (response.ok) pending.resolve(response.payload)
  else {
    const error = response.error ?? { code: 'runtime.parent_request_failed', message: `Main request failed: ${response.method}` }
    pending.reject(Object.assign(new Error(error.message), error))
  }
}

function handleHandshake(request: RuntimeRequest): void {
  if (request.payload?.protocolVersion !== AGENT_RUNTIME_PROTOCOL_VERSION) {
    respondError(request, { code: 'runtime.protocol_version_unsupported', message: 'Unsupported runtime protocol version' })
    return
  }
  const payload: AgentRuntimeHandshakePayload = {
    runtimeVersion: 'per-session-utility/1',
    pid: process.pid,
    capabilities: Object.values(AGENT_RUNTIME_METHODS),
    state: getState(),
  }
  respond(request, payload)
}

function respond(request: RuntimeRequest, payload: unknown): void {
  runtimePort?.postMessage(createAgentRuntimeResponse(request, { payload }, bootId))
}

function respondError(request: RuntimeRequest, error: unknown): void {
  runtimePort?.postMessage(createAgentRuntimeResponse(request, {
    error: serializeAgentRuntimeError(error),
  }, bootId))
}
