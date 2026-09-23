interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface QueuedLookup<T> {
  key: string
  loader: () => Promise<T>
  generation: number
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/**
 * Bounded, single-flight lookup coordinator for authoritative Agent turn usage.
 * Only completed values accepted by shouldCache are retained; misses stay
 * retryable because the ledger can be written shortly after a stream finishes.
 */
export class BoundedAsyncLookupCache<T> {
  private readonly cached = new Map<string, CacheEntry<T>>()
  private readonly pending = new Map<string, Promise<T>>()
  private readonly queue: QueuedLookup<T>[] = []
  private readonly activeByGeneration = new Map<number, number>()
  private generation = 0

  constructor(
    private readonly options: {
      ttlMs: number
      maxEntries: number
      maxConcurrent: number
      shouldCache: (value: T) => boolean
    },
  ) {
    if (options.ttlMs <= 0 || options.maxEntries <= 0 || options.maxConcurrent <= 0) {
      throw new Error('lookup cache options must be positive')
    }
  }

  getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.cached.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      this.cached.delete(key)
      this.cached.set(key, cached)
      return Promise.resolve(cached.value)
    }
    if (cached) this.cached.delete(key)

    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const generation = this.generation
    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({ key, loader, generation, resolve, reject })
      this.drain()
    }).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }

  clear(): void {
    this.generation += 1
    this.cached.clear()
    // Existing requests cannot be aborted safely, but a new account must never
    // reuse their result, wait behind their single-flight entry, or consume its
    // own per-generation concurrency budget.
    this.pending.clear()
    const error = new Error('agent turn usage lookup cache was cleared')
    while (this.queue.length) this.queue.shift()?.reject(error)
  }

  private drain(): void {
    while ((this.activeByGeneration.get(this.generation) ?? 0) < this.options.maxConcurrent && this.queue.length) {
      const lookup = this.queue.shift()
      if (!lookup) return
      const active = this.activeByGeneration.get(lookup.generation) ?? 0
      this.activeByGeneration.set(lookup.generation, active + 1)
      void lookup.loader()
        .then((value) => {
          if (lookup.generation === this.generation && this.options.shouldCache(value)) {
            this.cached.set(lookup.key, { value, expiresAt: Date.now() + this.options.ttlMs })
            while (this.cached.size > this.options.maxEntries) {
              this.cached.delete(this.cached.keys().next().value as string)
            }
          }
          lookup.resolve(value)
        })
        .catch(lookup.reject)
        .finally(() => {
          const remaining = (this.activeByGeneration.get(lookup.generation) ?? 1) - 1
          if (remaining > 0) this.activeByGeneration.set(lookup.generation, remaining)
          else this.activeByGeneration.delete(lookup.generation)
          this.drain()
        })
    }
  }
}
