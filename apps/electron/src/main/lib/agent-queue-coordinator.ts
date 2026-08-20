import type { WebContents } from 'electron'
import type {
  AgentDeferredQueueMessageInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessageControlInput,
  AgentQueuedMessageStatus,
} from '@proma/shared'

interface QueueEntry {
  input: AgentDeferredQueueMessageInput
}

export interface AgentQueueCoordinatorOptions {
  isActive: (sessionId: string) => boolean
  getWebContents: (sessionId: string) => WebContents | null
  startRun: (input: AgentDeferredQueueMessageInput, webContents: WebContents) => Promise<void>
  sendStarted: (webContents: WebContents, status: AgentQueuedMessageStatus) => void
}

/** 主进程持有 deferred queue；renderer 只保留展示投影。 */
export class AgentQueueCoordinator {
  private readonly queues = new Map<string, QueueEntry[]>()
  private readonly dispatching = new Map<string, string>()

  constructor(private readonly options: AgentQueueCoordinatorOptions) {}

  enqueue(input: AgentDeferredQueueMessageInput): void {
    const queue = this.queues.get(input.sessionId) ?? []
    if (queue.some((entry) => entry.input.queueMessageId === input.queueMessageId)) return
    queue.push({ input })
    this.queues.set(input.sessionId, queue)
    this.tryDispatch(input.sessionId)
  }

  cancel(input: AgentQueuedMessageControlInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue) return false
    const index = queue.findIndex((entry) => entry.input.queueMessageId === input.messageId)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.queues.delete(input.sessionId)
    return true
  }

  move(input: AgentMoveQueuedMessageInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue || input.sourceId === input.targetId) return false
    const sourceIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.sourceId)
    const targetIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    if (sourceIndex < 0 || targetIndex < 0) return false
    const [source] = queue.splice(sourceIndex, 1)
    if (!source) return false
    const adjustedTarget = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    const insertIndex = input.placement === 'after' ? adjustedTarget + 1 : adjustedTarget
    queue.splice(insertIndex, 0, source)
    return true
  }

  onRunComplete(
    sessionId: string,
    queueMessageId: string | undefined,
    backgroundTasksPending: boolean,
    stoppedByUser: boolean,
  ): void {
    if (queueMessageId && this.dispatching.get(sessionId) === queueMessageId) {
      this.dispatching.delete(sessionId)
    }
    if (backgroundTasksPending || stoppedByUser) return
    this.tryDispatch(sessionId)
  }

  onBackgroundTaskComplete(sessionId: string): void {
    this.tryDispatch(sessionId)
  }

  isDispatching(sessionId: string): boolean {
    return this.dispatching.has(sessionId)
  }

  hasPending(sessionId: string): boolean {
    return this.dispatching.has(sessionId) || (this.queues.get(sessionId)?.length ?? 0) > 0
  }

  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.dispatching.delete(sessionId)
  }

  private tryDispatch(sessionId: string): void {
    if (this.dispatching.has(sessionId) || this.options.isActive(sessionId)) return
    const queue = this.queues.get(sessionId)
    const entry = queue?.shift()
    if (!entry) return
    if (queue?.length === 0) this.queues.delete(sessionId)

    const messageId = entry.input.queueMessageId
    this.dispatching.set(sessionId, messageId)
    const webContents = this.options.getWebContents(sessionId)
    if (!webContents || webContents.isDestroyed()) {
      queue?.unshift(entry)
      if (queue) this.queues.set(sessionId, queue)
      this.dispatching.delete(sessionId)
      return
    }
    const startedAt = Date.now()
    this.options.sendStarted(webContents, {
        sessionId,
        messageId,
        status: 'started',
        userMessage: entry.input.userMessage,
        rawUserMessage: entry.input.rawUserMessage,
        startedAt,
    })
    void this.options.startRun({ ...entry.input, startedAt, userMessageUuid: messageId }, webContents)
      .finally(() => {
        if (this.dispatching.get(sessionId) === messageId) this.dispatching.delete(sessionId)
      })
  }
}
