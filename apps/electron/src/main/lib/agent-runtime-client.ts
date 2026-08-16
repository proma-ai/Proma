import { join } from 'node:path'
import {
  MessageChannelMain,
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from 'electron'
import {
  AGENT_RUNTIME_BOOTSTRAP_ID,
  AGENT_RUNTIME_METHODS,
  AGENT_RUNTIME_PROTOCOL_VERSION,
  createAgentRuntimeRequest,
  createAgentRuntimeResponse,
  isAgentRuntimeEnvelope,
  serializeAgentRuntimeError,
  type AgentRuntimeEnvelope,
  type AgentRuntimeError,
  type AgentRuntimeEvent,
  type AgentRuntimeHandshakePayload,
  type AgentRuntimePortTransfer,
  type AgentRuntimeRequest,
  type AgentRuntimeResponse,
  type AgentRuntimeState,
} from '@proma/shared'

type RuntimePort = Pick<MessagePortMain, 'close' | 'postMessage' | 'start'> & {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

type RuntimeRequestHandler = (request: AgentRuntimeRequest) => Promise<unknown>

export interface AgentRuntimeClientOptions {
  sessionId: string
  entryPath?: string
  env?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
  requestTimeoutMs?: number
}

export interface AgentRuntimeRequestOptions {
  queryId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

/**
 * One client owns exactly one Pi utility process. Keeping this unit per session
 * prevents a busy Agent from sharing a Node event loop with another Agent.
 */
export class AgentRuntimeClient {
  private readonly sessionId: string
  private readonly entryPath: string
  private readonly env: NodeJS.ProcessEnv | undefined
  private readonly startupTimeoutMs: number
  private readonly requestTimeoutMs: number
  private runtimeProcess: UtilityProcess | undefined
  private port: RuntimePort | undefined
  private generation = 0
  private startPromise: Promise<AgentRuntimeState> | undefined
  private stopPromise: Promise<void> | undefined
  private bootId = AGENT_RUNTIME_BOOTSTRAP_ID
  private state: AgentRuntimeState = {
    status: 'stopped',
    bootId: AGENT_RUNTIME_BOOTSTRAP_ID,
    pid: null,
    active: false,
    pendingRequests: 0,
  }
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: AgentRuntimeEvent) => void>()
  private requestHandler: RuntimeRequestHandler | undefined

  constructor(options: AgentRuntimeClientOptions) {
    this.sessionId = options.sessionId
    this.entryPath = options.entryPath ?? join(__dirname, 'agent-runtime.cjs')
    this.env = options.env
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  get currentState(): AgentRuntimeState {
    return { ...this.state }
  }

  get isReady(): boolean {
    return this.state.status === 'ready' && this.port !== undefined
  }

  setRequestHandler(handler: RuntimeRequestHandler | undefined): void {
    this.requestHandler = handler
  }

  onEvent(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async start(): Promise<AgentRuntimeState> {
    if (this.isReady) return this.currentState
    if (this.stopPromise || this.state.status === 'stopping') throw new Error('Agent runtime is shutting down')
    if (this.startPromise) return this.startPromise

    this.startPromise = this.spawnAndHandshake()
    try {
      return await this.startPromise
    } catch (error) {
      this.port?.close()
      this.port = undefined
      this.runtimeProcess?.kill()
      this.runtimeProcess = undefined
      this.rejectPending(error instanceof Error ? error : new Error(String(error)))
      this.state = {
        status: 'crashed',
        bootId: AGENT_RUNTIME_BOOTSTRAP_ID,
        pid: null,
        active: false,
        pendingRequests: 0,
        lastError: serializeAgentRuntimeError(error, 'runtime.start_failed'),
      }
      throw error
    } finally {
      this.startPromise = undefined
    }
  }

  async call<Result = unknown, Payload = unknown>(
    method: string,
    payload?: Payload,
    options: AgentRuntimeRequestOptions = {},
  ): Promise<Result> {
    await this.start()
    return this.sendRequest<Result>(method, payload, options)
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    if (!this.runtimeProcess && !this.startPromise) return

    const pendingStart = this.startPromise
    this.stopPromise = (async () => {
      const currentGeneration = this.generation
      this.state = { ...this.state, status: 'stopping' }
      try {
        if (this.port && this.state.status === 'stopping') {
          await this.sendRequest(AGENT_RUNTIME_METHODS.SHUTDOWN, undefined, { timeoutMs: 5_000 }).catch(() => {})
        }
      } finally {
        if (currentGeneration === this.generation) this.generation++
        this.port?.close()
        this.port = undefined
        this.runtimeProcess?.kill()
        this.runtimeProcess = undefined
        this.rejectPending(new Error('Agent runtime stopped'))
        this.state = {
          status: 'stopped',
          bootId: AGENT_RUNTIME_BOOTSTRAP_ID,
          pid: null,
          active: false,
          pendingRequests: 0,
        }
        await pendingStart?.catch(() => {})
      }
    })()

    try {
      await this.stopPromise
    } finally {
      this.stopPromise = undefined
    }
  }

  private async spawnAndHandshake(): Promise<AgentRuntimeState> {
    const generation = ++this.generation
    this.state = { ...this.state, status: 'starting', lastError: undefined }
    const runtimeProcess = utilityProcess.fork(this.entryPath, [], {
      env: { ...process.env, ...this.env, PROMA_AGENT_SESSION_ID: this.sessionId },
    })
    this.runtimeProcess = runtimeProcess
    const processEvents = runtimeProcess as unknown as {
      on(event: 'exit', listener: (code: number) => void): void
    }
    processEvents.on('exit', (code) => {
      if (generation !== this.generation || this.runtimeProcess !== runtimeProcess) return
      this.handleProcessExit(code)
    })
    runtimeProcess.on('error', (type, location, report) => {
      if (generation !== this.generation || this.runtimeProcess !== runtimeProcess) return
      this.handleRuntimeFailure({
        code: 'runtime.process_error',
        message: `Agent runtime fatal error: ${type}`,
        details: { location, report },
      })
    })

    const channel = new MessageChannelMain()
    const port = channel.port2 as unknown as RuntimePort
    this.port = port
    port.on('message', (event) => {
      if (generation !== this.generation || this.runtimeProcess !== runtimeProcess || this.port !== port) return
      this.handlePortMessage(event.data)
    })
    port.start()

    const transfer: AgentRuntimePortTransfer = {
      type: 'proma-agent-runtime-port',
      protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    }
    runtimeProcess.postMessage(transfer, [channel.port1])

    const handshake = await this.sendRequest<AgentRuntimeHandshakePayload>(
      AGENT_RUNTIME_METHODS.HANDSHAKE,
      { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION },
      { timeoutMs: this.startupTimeoutMs },
    )
    if (generation !== this.generation || this.runtimeProcess !== runtimeProcess || this.port !== port) {
      throw new Error('Agent runtime stopped during handshake')
    }
    this.bootId = handshake.state.bootId
    this.state = { ...handshake.state, status: 'ready' }
    return this.currentState
  }

  private sendRequest<Result, Payload = unknown>(
    method: string,
    payload?: Payload,
    options: AgentRuntimeRequestOptions = {},
  ): Promise<Result> {
    const port = this.port
    if (!port) return Promise.reject(new Error('Agent runtime port is not connected'))

    const request = createAgentRuntimeRequest(method, payload, {
      sessionId: this.sessionId,
      queryId: options.queryId,
    }, method === AGENT_RUNTIME_METHODS.HANDSHAKE ? AGENT_RUNTIME_BOOTSTRAP_ID : this.bootId)
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs

    return new Promise<Result>((resolve, reject) => {
      let removeAbortListener = (): void => {}
      const cleanup = (): void => {
        clearTimeout(timer)
        removeAbortListener()
      }
      const timer = setTimeout(() => {
        if (!this.pendingRequests.delete(request.requestId)) return
        cleanup()
        this.state = { ...this.state, pendingRequests: this.pendingRequests.size }
        reject(new Error(`Agent runtime request timed out: ${method}`))
      }, timeoutMs)
      const pending: PendingRequest = {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
        timer,
        cleanup,
      }
      this.pendingRequests.set(request.requestId, pending)
      this.state = { ...this.state, pendingRequests: this.pendingRequests.size }

      if (options.signal) {
        const abort = (): void => {
          if (!this.pendingRequests.delete(request.requestId)) return
          cleanup()
          this.state = { ...this.state, pendingRequests: this.pendingRequests.size }
          reject(new Error(`Agent runtime request aborted: ${method}`))
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
        this.pendingRequests.delete(request.requestId)
        cleanup()
        this.state = { ...this.state, pendingRequests: this.pendingRequests.size }
        reject(error)
      }
    })
  }

  private handlePortMessage(rawMessage: unknown): void {
    if (!isAgentRuntimeEnvelope(rawMessage)) return
    const message = rawMessage as AgentRuntimeEnvelope
    if (message.kind === 'request') {
      void this.handleIncomingRequest(message)
      return
    }
    if (message.kind === 'event') {
      if (message.bootId !== this.bootId && message.bootId !== AGENT_RUNTIME_BOOTSTRAP_ID) return
      if (message.method === AGENT_RUNTIME_METHODS.EVENT_STATE && message.payload) {
        this.state = { ...(message.payload as AgentRuntimeState) }
      }
      for (const listener of this.eventListeners) {
        try { listener(message) } catch (error) { console.warn('[AgentRuntime] event listener failed:', error) }
      }
      return
    }
    if (message.kind !== 'response') return
    if (message.method !== AGENT_RUNTIME_METHODS.HANDSHAKE && message.bootId !== this.bootId) return

    const pending = this.pendingRequests.get(message.requestId)
    if (!pending) return
    this.pendingRequests.delete(message.requestId)
    pending.cleanup()
    this.state = { ...this.state, pendingRequests: this.pendingRequests.size }
    if (message.ok) pending.resolve(message.payload)
    else pending.reject(this.errorFromResponse(message))
  }

  private async handleIncomingRequest(request: AgentRuntimeRequest): Promise<void> {
    if (request.bootId !== this.bootId) return
    try {
      if (!this.requestHandler) throw new Error(`No main handler for runtime method: ${request.method}`)
      const payload = await this.requestHandler(request)
      this.port?.postMessage(createAgentRuntimeResponse(request, { payload }, this.bootId))
    } catch (error) {
      this.port?.postMessage(createAgentRuntimeResponse(request, {
        error: serializeAgentRuntimeError(error, 'runtime.main_handler_failed'),
      }, this.bootId))
    }
  }

  private errorFromResponse(response: AgentRuntimeResponse): Error {
    const runtimeError = response.error ?? { code: 'runtime.request_failed', message: `Agent runtime request failed: ${response.method}` }
    const error = new Error(runtimeError.message)
    Object.assign(error, runtimeError)
    return error
  }

  private handleRuntimeFailure(error: AgentRuntimeError): void {
    if (this.state.status === 'stopping' || this.state.status === 'stopped') return
    this.state = { ...this.state, status: 'crashed', lastError: error, active: false }
    this.rejectPending(Object.assign(new Error(error.message), error))
    for (const listener of this.eventListeners) {
      listener({
        protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
        bootId: this.bootId,
        kind: 'event',
        method: AGENT_RUNTIME_METHODS.EVENT_CRASHED,
        sessionId: this.sessionId,
        payload: error,
      })
    }
  }

  private handleProcessExit(code: number): void {
    if (this.state.status === 'stopping' || this.state.status === 'stopped') return
    this.handleRuntimeFailure({
      code: 'runtime.process_exit',
      message: `Agent runtime exited (code=${code})`,
      retryable: true,
      details: { code, sessionId: this.sessionId },
    })
    this.port?.close()
    this.port = undefined
    this.runtimeProcess = undefined
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pendingRequests.clear()
    this.state = { ...this.state, pendingRequests: 0 }
  }
}
