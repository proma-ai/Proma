import type { TranscriptTurn } from './transcript'

export interface SelectOptions {
  /** 闭区间 turn 下标 [a, b]（含两端）。 */
  range?: [number, number]
  /** 取前 N 个 turn。 */
  head?: number
  /** 取后 N 个 turn。 */
  tail?: number
  /** 从下标 offset 起。 */
  offset?: number
  /** 配合 offset，取 limit 个。 */
  limit?: number
}

/**
 * 按窗口截取 turn 子集（下标稳定）。优先级：range > head > tail > offset/limit。
 * 不传任何窗口 → 返回全部。
 */
export function selectTurns(turns: TranscriptTurn[], opts: SelectOptions = {}): TranscriptTurn[] {
  const { range, head, tail, offset, limit } = opts
  if (range) {
    const [a, b] = range
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return turns.filter((t) => t.index >= lo && t.index <= hi)
  }
  if (typeof head === 'number') return turns.slice(0, Math.max(0, head))
  if (typeof tail === 'number') return turns.slice(Math.max(0, turns.length - tail))
  if (typeof offset === 'number' || typeof limit === 'number') {
    const start = offset ?? 0
    const end = typeof limit === 'number' ? start + limit : undefined
    return turns.slice(start, end)
  }
  return turns
}
