import type { WebContents } from 'electron'
import type {
  AgentDeferredQueueMessageInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessage,
  AgentQueuedMessageControlInput,
  AgentQueuedMessageStatus,
  AgentQueueMessageInput,
} from '@proma/shared'

interface DeferredQueueEntry {
  input: AgentDeferredQueueMessageInput
  webContents: WebContents
}

export interface AgentQueueCoordinatorOptions {
  isActive: (sessionId: string) => boolean
  startRun: (input: AgentDeferredQueueMessageInput, webContents: WebContents) => Promise<void>
  injectMessage: (
    input: AgentQueueMessageInput,
    webContents: WebContents,
  ) => Promise<string>
  sendStatus: (webContents: WebContents, status: AgentQueuedMessageStatus) => void
}

/**
 * 管理等待当前 Agent run 结束后发送的用户消息。
 *
 * 这里保存的是一次性的发送参数和 UI 快照，不保存流式消息，也不写磁盘。
 * renderer 只负责展示投影；真正的“何时启动下一轮”由主进程 active slot 决定。
 */
export class AgentQueueCoordinator {
  private readonly queues = new Map<string, DeferredQueueEntry[]>()
  private readonly dispatching = new Set<string>()
  private readonly options: AgentQueueCoordinatorOptions

  constructor(options: AgentQueueCoordinatorOptions) {
    this.options = options
  }

  enqueue(input: AgentDeferredQueueMessageInput, webContents: WebContents): void {
    const current = this.queues.get(input.sessionId) ?? []
    if (current.some((entry) => entry.input.queueMessageId === input.queueMessageId)) return

    current.push({ input, webContents })
    this.queues.set(input.sessionId, current)
    this.emit(webContents, input, 'queued')
    this.tryDispatch(input.sessionId)
  }

  cancel(input: AgentQueuedMessageControlInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue) return false
    const index = queue.findIndex((entry) => entry.input.queueMessageId === input.messageId)
    if (index < 0) return false

    const entry = queue[index]
    if (!entry) return false
    queue.splice(index, 1)
    this.deleteEmptyQueue(input.sessionId)
    this.emit(entry.webContents, entry.input, 'cancelled')
    return true
  }

  move(input: AgentMoveQueuedMessageInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue || input.sourceId === input.targetId) return false

    const sourceIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.sourceId)
    if (sourceIndex < 0) return false
    const source = queue[sourceIndex]
    if (!source) return false
    queue.splice(sourceIndex, 1)
    const targetIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    if (targetIndex < 0) {
      queue.splice(sourceIndex, 0, source)
      return false
    }

    const insertIndex = input.placement === 'after' ? targetIndex + 1 : targetIndex
    queue.splice(insertIndex, 0, source)
    return true
  }

  /**
   * 用户点击“立即发送”时：
   * - 当前 run 仍在执行：复用原有 SDK queue injection；
   * - 当前 run 已结束：直接启动一轮新的 Agent。
   */
  async promote(input: AgentQueuedMessageControlInput & { interrupt?: boolean }): Promise<boolean> {
    if (this.dispatching.has(input.sessionId)) return false
    const entry = this.removeEntry(input)
    if (!entry) return false

    this.emit(entry.webContents, entry.input, 'started')
    if (this.options.isActive(input.sessionId)) {
      const queueInput: AgentQueueMessageInput = {
        sessionId: entry.input.sessionId,
        userMessage: entry.input.userMessage,
        rawUserMessage: entry.input.rawUserMessage,
        uuid: entry.input.queueMessageId,
        interrupt: input.interrupt,
        mentionedSkills: entry.input.mentionedSkills,
        mentionedMcpServers: entry.input.mentionedMcpServers,
        mentionedSessionIds: entry.input.mentionedSessionIds,
        mentionedTodoIds: entry.input.mentionedTodoIds,
        mentionedCalendarEventIds: entry.input.mentionedCalendarEventIds,
      }
      try {
        await this.options.injectMessage(queueInput, entry.webContents)
      } catch (error) {
        this.restoreEntry(input.sessionId, entry)
        this.emit(entry.webContents, entry.input, 'failed', error)
      }
      return true
    }

    this.dispatching.add(input.sessionId)
    void this.options.startRun({
      ...entry.input,
      startedAt: Date.now(),
    }, entry.webContents)
      .catch((error) => {
        this.restoreEntry(input.sessionId, entry)
        this.emit(entry.webContents, entry.input, 'failed', error)
      })
      .finally(() => {
        this.dispatching.delete(input.sessionId)
      })
    return true
  }

  onRunComplete(sessionId: string, backgroundTasksPending: boolean): void {
    this.dispatching.delete(sessionId)
    if (backgroundTasksPending) return
    this.tryDispatch(sessionId)
  }

  list(sessionId?: string): AgentQueuedMessage[] {
    if (sessionId) {
      return (this.queues.get(sessionId) ?? []).map((entry) => entry.input.displayMessage)
    }
    return [...this.queues.values()].flatMap((queue) => queue.map((entry) => entry.input.displayMessage))
  }

  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.dispatching.delete(sessionId)
  }

  private tryDispatch(sessionId: string): void {
    if (this.dispatching.has(sessionId) || this.options.isActive(sessionId)) return
    const queue = this.queues.get(sessionId)
    const entry = queue?.[0]
    if (!entry) return

    queue!.shift()
    this.deleteEmptyQueue(sessionId)
    this.dispatching.add(sessionId)
    this.emit(entry.webContents, entry.input, 'started')
    void this.options.startRun({
      ...entry.input,
      startedAt: Date.now(),
    }, entry.webContents)
      .catch((error) => {
        this.restoreEntry(sessionId, entry)
        this.emit(entry.webContents, entry.input, 'failed', error)
      })
      .finally(() => {
        this.dispatching.delete(sessionId)
      })
  }

  private removeEntry(input: AgentQueuedMessageControlInput): DeferredQueueEntry | undefined {
    const queue = this.queues.get(input.sessionId)
    if (!queue) return undefined
    const index = queue.findIndex((entry) => entry.input.queueMessageId === input.messageId)
    if (index < 0) return undefined
    const entry = queue[index]
    if (!entry) return undefined
    queue.splice(index, 1)
    this.deleteEmptyQueue(input.sessionId)
    return entry
  }

  private restoreEntry(sessionId: string, entry: DeferredQueueEntry): void {
    const queue = this.queues.get(sessionId) ?? []
    if (!queue.some((item) => item.input.queueMessageId === entry.input.queueMessageId)) {
      queue.unshift(entry)
      this.queues.set(sessionId, queue)
    }
  }

  private deleteEmptyQueue(sessionId: string): void {
    const queue = this.queues.get(sessionId)
    if (queue && queue.length === 0) this.queues.delete(sessionId)
  }

  private emit(
    webContents: WebContents,
    input: AgentDeferredQueueMessageInput,
    status: AgentQueuedMessageStatus['status'],
    error?: unknown,
  ): void {
    this.options.sendStatus(webContents, {
      sessionId: input.sessionId,
      messageId: input.queueMessageId,
      status,
      message: input.displayMessage,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    })
  }
}
