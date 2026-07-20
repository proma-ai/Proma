/**
 * Bridge 日志脱敏工具。
 *
 * 外部 SDK 的错误、响应和回调载荷可能回显凭证；写入日志前必须经过这里。
 */

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY_SOURCE = 'api[-_]?key|client[-_]?secret|app[-_]?secret|(?:access|refresh)[-_]?token|authorization|authentication|credential|password|session[-_]?webhook|webhook|download[-_]?code|[a-z0-9_-]*token'
const SENSITIVE_KEY_PATTERN = new RegExp(`(?:${SENSITIVE_KEY_SOURCE})`, 'i')
const SENSITIVE_KEY_VALUE_PATTERN = new RegExp(
  `((?:["']?(?:${SENSITIVE_KEY_SOURCE})["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^,\\s}\\]]+)`,
  'gi',
)
const SENSITIVE_QUERY_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_KEY_SOURCE})=)[^&#\\s]+`,
  'gi',
)
const AUTHORIZATION_VALUE_PATTERN = /((?:authorization|authentication)\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/gi

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

/** 脱敏自由文本中的键值、Authorization header 和 URL query 参数。 */
export function redactSensitiveLogText(text: string): string {
  return text
    .replace(AUTHORIZATION_VALUE_PATTERN, `$1${REDACTED}`)
    .replace(SENSITIVE_KEY_VALUE_PATTERN, `$1${REDACTED}`)
    .replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED}`)
}

/**
 * 递归脱敏准备输出到 Bridge 日志的值。
 * 仅删除秘密字段，保留 bot ID、client ID、HTTP 状态等排障信息。
 */
export function redactSensitiveLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveLogText(value)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveLogText(value.message),
      stack: value.stack ? redactSensitiveLogText(value.stack) : undefined,
      cause: redactSensitiveLogValue(value.cause, seen),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveLogValue(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactSensitiveLogValue(item, seen),
    ]),
  )
}
