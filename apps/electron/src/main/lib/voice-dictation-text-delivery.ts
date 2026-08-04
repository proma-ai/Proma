interface PendingDelivery {
  resolve: (delivered: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * Tracks the renderer acknowledgement for a final text delivery.
 * A missing acknowledgement is treated as an undelivered target so callers
 * can provide a recoverable fallback instead of claiming success.
 */
export class VoiceDictationTextDeliveryTracker {
  private readonly pending = new Map<string, PendingDelivery>()

  waitFor(sessionId: string, timeoutMs: number): Promise<boolean> {
    this.acknowledge(sessionId, false)

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const current = this.pending.get(sessionId)
        if (!current) return
        this.pending.delete(sessionId)
        current.resolve(false)
      }, timeoutMs)
      this.pending.set(sessionId, { resolve, timeout })
    })
  }

  acknowledge(sessionId: string, delivered: boolean): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(sessionId)
    pending.resolve(delivered)
  }
}
