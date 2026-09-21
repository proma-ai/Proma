/**
 * Pi 0.86 将 ToolResultMessage.details 收紧为 JSON 兼容值。
 * 产品工具仍可能返回 BigInt、undefined 或循环引用；在写入 Pi transcript 前统一归一化，
 * 避免工具已执行成功后因持久化结果失败而中断 Agent turn。
 */

export type PiToolResultJson = null | boolean | number | string | PiToolResultJson[] | { [key: string]: PiToolResultJson }

export interface SerializedPiToolResultPayload {
  details: PiToolResultJson
  text: string
}

export function normalizePiToolResultDetails(value: unknown): PiToolResultJson {
  return normalize(value, new WeakSet<object>())
}

export function serializePiToolResultPayload(value: unknown): SerializedPiToolResultPayload {
  const details = normalizePiToolResultDetails(value)
  return { details, text: JSON.stringify(details) }
}

function normalize(value: unknown, ancestors: WeakSet<object>): PiToolResultJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return null

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[Circular]'
    ancestors.add(value)
    const normalized = value.map((item) => normalize(item, ancestors))
    ancestors.delete(value)
    return normalized
  }

  if (typeof value === 'object') {
    if (ancestors.has(value)) return '[Circular]'
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return '[Unsupported object]'

    ancestors.add(value)
    const normalized: Record<string, PiToolResultJson> = {}
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      normalized[key] = descriptor && 'value' in descriptor
        ? normalize(descriptor.value, ancestors)
        : '[Accessor]'
    }
    ancestors.delete(value)
    return normalized
  }

  return null
}
