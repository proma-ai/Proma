/**
 * 单进程异步 TTL 缓存。
 *
 * 相同 generation 内的并发读取共用一个 Promise；失效后即使旧请求仍在
 * 飞行，也会为新 generation 发起一条新读取，避免扣费完成后回填旧余额。
 */
export class AsyncTtlCache<T> {
  private cached: { value: T; expiresAt: number } | null = null
  private generation = 0
  private pending: { generation: number; promise: Promise<T> } | null = null

  constructor(private readonly ttlMs: number) {
    if (ttlMs <= 0) throw new Error('ttlMs 必须为正数')
  }

  getOrLoad(loader: () => Promise<T>): Promise<T> {
    const now = Date.now()
    if (this.cached && this.cached.expiresAt > now) return Promise.resolve(this.cached.value)

    const generation = this.generation
    if (this.pending?.generation === generation) return this.pending.promise

    const promise = loader().then((value) => {
      if (this.generation === generation) {
        this.cached = { value, expiresAt: Date.now() + this.ttlMs }
      }
      return value
    }).finally(() => {
      if (this.pending?.promise === promise) this.pending = null
    })
    this.pending = { generation, promise }
    return promise
  }

  invalidate(): void {
    this.generation += 1
    this.cached = null
  }
}
