/**
 * 瞬时网络错误模式
 *
 * 覆盖上游 API 偶发断流/抖动：API SSE 流中途 terminated、TCP 连接被重置、
 * DNS 抖动、fetch 层超时、连接被中止（undici "The operation was aborted" /
 * AbortError）、对端提前关闭等。这些错误无 HTTP 状态码，SDK HTTP 客户端层
 * 内置的 2 次重试无法完全消化时，会穿透到 Orchestrator 应用层兜底。
 * 命中此模式的错误会走「保留 resume 的自动重试」，不会清除 sdkSessionId（#903）。
 */
export const TRANSIENT_NETWORK_PATTERN =
  /terminated|socket hang up|ECONNRESET|ETIMEDOUT|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network error|connection (?:error|closed|reset)|other side closed|AbortError|(?:operation|request) was aborted|(?:request )?timed out|stream (?:closed|ended|disconnected) prematurely|premature close/i

/** 判断错误消息/stderr 是否为瞬时网络错误 */
export function isTransientNetworkError(message?: string, stderr?: string): boolean {
  if (!message && !stderr) return false
  return (
    (!!message && TRANSIENT_NETWORK_PATTERN.test(message)) ||
    (!!stderr && TRANSIENT_NETWORK_PATTERN.test(stderr))
  )
}

/**
 * 上游响应体解析失败模式
 *
 * SDK native CLI（Bun/JavaScriptCore）将上游响应解析为 JSON 失败时抛出，
 * 典型形如 "API Error: JSON Parse error: Unable to parse JSON string"。
 * 成因多为网关返回 HTML 错误页、SSE 流被截断、代理注入脏数据等瞬时异常，
 * 与瞬时网络错误同属上游抖动，重试通常即可恢复。
 * 同时覆盖 V8 引擎措辞（Unexpected end of JSON input / is not valid JSON）。
 */
export const MALFORMED_RESPONSE_PATTERN =
  /JSON Parse error|Unable to parse JSON|Unexpected end of JSON input|Unexpected token.*JSON|is not valid JSON/i

/** 判断错误消息/stderr 是否为上游响应体解析失败 */
export function isMalformedResponseError(message?: string, stderr?: string): boolean {
  if (!message && !stderr) return false
  return (
    (!!message && MALFORMED_RESPONSE_PATTERN.test(message)) ||
    (!!stderr && MALFORMED_RESPONSE_PATTERN.test(stderr))
  )
}

/**
 * SDK resume 指向的会话不存在。
 *
 * Claude Agent SDK 不同版本/路径的错误文案不完全一致，线上已见到：
 * - "No conversation found with session ID: ..."
 * - "No conversation found withsessionID: ..."
 * 第二种少了空格，不能依赖逐字匹配。
 */
export function isSessionNotFoundError(...messages: Array<string | undefined>): boolean {
  return messages.some((message) => {
    if (!message) return false
    const compact = message.replace(/\s+/g, '').toLowerCase()
    return /noconversationfound(?:with)?session(?:id)?/.test(compact)
  })
}
