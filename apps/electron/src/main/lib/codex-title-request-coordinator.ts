export type CodexTitleJob = (signal: AbortSignal) => Promise<void>

interface ActiveCodexTitleJob {
  controller: AbortController
  completion: Promise<void>
}

/**
 * Keeps low-priority title requests out of the way of foreground Codex runs.
 * Requests are serialized per configured OAuth channel.
 */
export class CodexTitleRequestCoordinator {
  private readonly foregroundRuns = new Map<string, number>()
  private readonly queuedJobs = new Map<string, CodexTitleJob[]>()
  private readonly activeJobs = new Map<string, ActiveCodexTitleJob>()

  async beginForeground(channelId: string): Promise<void> {
    this.foregroundRuns.set(channelId, (this.foregroundRuns.get(channelId) ?? 0) + 1)

    const active = this.activeJobs.get(channelId)
    if (!active) return

    active.controller.abort()
    await active.completion
  }

  endForeground(channelId: string): void {
    const current = this.foregroundRuns.get(channelId)
    if (!current) return

    if (current === 1) {
      this.foregroundRuns.delete(channelId)
      this.startNext(channelId)
      return
    }

    this.foregroundRuns.set(channelId, current - 1)
  }

  enqueue(channelId: string, job: CodexTitleJob): void {
    const queue = this.queuedJobs.get(channelId) ?? []
    queue.push(job)
    this.queuedJobs.set(channelId, queue)
    this.startNext(channelId)
  }

  dispose(): void {
    for (const active of this.activeJobs.values()) {
      active.controller.abort()
    }
    this.activeJobs.clear()
    this.queuedJobs.clear()
    this.foregroundRuns.clear()
  }

  private startNext(channelId: string): void {
    if (this.foregroundRuns.has(channelId) || this.activeJobs.has(channelId)) return

    const queue = this.queuedJobs.get(channelId)
    const job = queue?.shift()
    if (!job) {
      this.queuedJobs.delete(channelId)
      return
    }
    if (!queue?.length) this.queuedJobs.delete(channelId)

    const controller = new AbortController()
    let active: ActiveCodexTitleJob
    const completion = Promise.resolve()
      .then(() => job(controller.signal))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('[Codex 标题] 低优先级请求失败:', error)
        }
      })
      .finally(() => {
        if (this.activeJobs.get(channelId) === active) {
          this.activeJobs.delete(channelId)
          this.startNext(channelId)
        }
      })

    active = { controller, completion }
    this.activeJobs.set(channelId, active)
  }
}
