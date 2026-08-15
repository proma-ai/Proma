import {
  AGENT_RUNTIME_BOOTSTRAP_ID,
  AGENT_RUNTIME_PROTOCOL_VERSION,
  type AgentRuntimeContext,
  type AgentRuntimeEnvelope,
  type AgentRuntimeError,
  type AgentRuntimeRequest,
  type AgentRuntimeResponse,
} from '../types/agent-runtime'

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createAgentRuntimeRequest<Payload>(
  method: string,
  payload?: Payload,
  context: AgentRuntimeContext = {},
  bootId = AGENT_RUNTIME_BOOTSTRAP_ID,
): AgentRuntimeRequest<Payload> {
  return {
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    bootId,
    kind: 'request',
    requestId: createRequestId(),
    method,
    ...(payload === undefined ? {} : { payload }),
    ...context,
  }
}

export function createAgentRuntimeResponse<Payload>(
  request: AgentRuntimeRequest,
  result: { payload?: Payload; error?: AgentRuntimeError },
  bootId = request.bootId,
): AgentRuntimeResponse<Payload> {
  const response: AgentRuntimeResponse<Payload> = {
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    bootId,
    kind: 'response',
    requestId: request.requestId,
    method: request.method,
    ok: !result.error,
    ...(result.payload === undefined ? {} : { payload: result.payload }),
    ...(result.error ? { error: result.error } : {}),
  }

  if (request.sessionId !== undefined) response.sessionId = request.sessionId
  if (request.runId !== undefined) response.runId = request.runId
  if (request.sequence !== undefined) response.sequence = request.sequence
  return response
}

export function serializeAgentRuntimeError(
  error: unknown,
  fallbackCode = 'runtime.internal_error',
): AgentRuntimeError {
  if (isAgentRuntimeError(error)) return error
  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message || error.name,
      ...(error.stack ? { details: { stack: error.stack } } : {}),
    }
  }
  return {
    code: fallbackCode,
    message: typeof error === 'string' ? error : 'Unknown runtime error',
    details: error,
  }
}

export function isAgentRuntimeError(value: unknown): value is AgentRuntimeError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}

export function isAgentRuntimeEnvelope(value: unknown): value is AgentRuntimeEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.protocolVersion === AGENT_RUNTIME_PROTOCOL_VERSION
    && typeof candidate.bootId === 'string'
    && (candidate.kind === 'request' || candidate.kind === 'response' || candidate.kind === 'event')
    && typeof candidate.method === 'string'
}
