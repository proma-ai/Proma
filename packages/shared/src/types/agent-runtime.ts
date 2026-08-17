/**
 * Electron main process 与 Pi utility process 之间的版本化协议。
 * 该文件不能依赖 Electron 或 Pi SDK，保证两端可以独立 bundle。
 */

export const AGENT_RUNTIME_PROTOCOL_VERSION = 1 as const
export const AGENT_RUNTIME_BOOTSTRAP_ID = 'bootstrap'

export type AgentRuntimeMessageKind = 'request' | 'response' | 'event'

export interface AgentRuntimeContext {
  sessionId?: string
  queryId?: string
  sequence?: number
}

export interface AgentRuntimeError {
  code: string
  message: string
  retryable?: boolean
  details?: unknown
}

interface AgentRuntimeEnvelopeBase extends AgentRuntimeContext {
  protocolVersion: typeof AGENT_RUNTIME_PROTOCOL_VERSION
  bootId: string
  kind: AgentRuntimeMessageKind
  method: string
}

export interface AgentRuntimeRequest<Payload = unknown> extends AgentRuntimeEnvelopeBase {
  kind: 'request'
  requestId: string
  payload?: Payload
}

export interface AgentRuntimeResponse<Payload = unknown> extends AgentRuntimeEnvelopeBase {
  kind: 'response'
  requestId: string
  ok: boolean
  payload?: Payload
  error?: AgentRuntimeError
}

export interface AgentRuntimeEvent<Payload = unknown> extends AgentRuntimeEnvelopeBase {
  kind: 'event'
  payload?: Payload
}

export type AgentRuntimeEnvelope = AgentRuntimeRequest | AgentRuntimeResponse | AgentRuntimeEvent

export type AgentRuntimeStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'crashed'

export interface AgentRuntimeState {
  status: AgentRuntimeStatus
  bootId: string
  pid: number | null
  active: boolean
  pendingRequests: number
  lastError?: AgentRuntimeError
}

export interface AgentRuntimeHandshakePayload {
  runtimeVersion: string
  pid: number
  capabilities: string[]
  state: AgentRuntimeState
}

export interface AgentRuntimePortTransfer {
  type: 'proma-agent-runtime-port'
  protocolVersion: typeof AGENT_RUNTIME_PROTOCOL_VERSION
}

export const AGENT_RUNTIME_METHODS = {
  HANDSHAKE: 'runtime.handshake',
  SHUTDOWN: 'runtime.shutdown',
  QUERY_START: 'agent.query.start',
  QUERY_ABORT: 'agent.query.abort',
  QUERY_SEND_QUEUED_MESSAGE: 'agent.query.sendQueuedMessage',
  QUERY_SET_PERMISSION_MODE: 'agent.query.setPermissionMode',
  CAPABILITY_CAN_USE_TOOL: 'agent.capability.canUseTool',
  CAPABILITY_CANCEL: 'agent.capability.cancel',
  CAPABILITY_CUSTOM_TOOL: 'agent.capability.customTool',
  CAPABILITY_CODEX_OAUTH_REFRESHED: 'agent.capability.codex_oauth_refreshed',
  CAPABILITY_XAI_OAUTH_REFRESHED: 'agent.capability.xai_oauth_refreshed',
  EVENT_STATE: 'runtime.state',
  EVENT_CRASHED: 'runtime.crashed',
  EVENT_QUERY: 'agent.query.event',
  EVENT_QUERY_END: 'agent.query.end',
  EVENT_QUERY_ERROR: 'agent.query.error',
  EVENT_QUERY_CALLBACK: 'agent.query.callback',
} as const

export type AgentRuntimeMethod = (typeof AGENT_RUNTIME_METHODS)[keyof typeof AGENT_RUNTIME_METHODS]
