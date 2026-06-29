/**
 * 渠道连接测试错误归一化
 *
 * 设计原则：
 * - HTTP 语义是标准化的，分类以「状态码」为主轴；文本匹配只用于消解三个
 *   真正存在歧义的状态（400 / 403 / 429），而不是作为主判据。这样新增
 *   Provider 时不需要再堆叠正则，长期可维护性远好于「文本优先」方案。
 * - 纯函数、无 Electron 依赖，可独立单元测试。
 * - 安全与资源边界：限制错误响应体读取大小、截断摘要、脱敏凭证。
 *
 * 修复 #770：此前部分 Provider 把「收到任何 HTTP 响应」等同于「连接成功」，
 * 导致 403 / 404 / 429 / 额度不足 / 5xx 被误判为成功。这里统一约定：
 * 仅 HTTP 2xx 才算连接成功。
 */

import type { ChannelTestErrorType, ChannelTestResult } from '@proma/shared'

/** 脱敏后原始错误摘要的最大长度 */
const MAX_DETAIL_LENGTH = 500
/** 错误响应体最多读取的字节数，避免异常端点返回超大内容造成额外内存占用 */
const MAX_ERROR_BODY_BYTES = 16 * 1024

/** 各分类对应的用户可读提示（已带处置建议） */
const ERROR_LABELS: Record<ChannelTestErrorType, string> = {
  auth: '认证失败，请检查 API Key',
  permission: '权限不足，当前 Key 无访问权限',
  not_found: '资源不存在，请检查 Base URL 或模型',
  rate_limit: '请求频率受限，请稍后重试',
  quota: '额度不足，请检查账户余额',
  bad_request: '请求无效，请检查渠道配置',
  server: '供应商服务异常，请稍后重试',
  network: '网络连接失败，请检查网络或代理',
  timeout: '连接超时，请检查网络或代理',
  unknown: '连接测试失败',
}

/**
 * 仅用于消解「歧义状态」的两个文本特征：
 * - 400 / 403 可能表达「Key 无效」而非「请求错误 / 无权限」（如 Google）。
 * - 429 可能表达「额度不足」而非「限流」（如 OpenAI 的 insufficient_quota）。
 * 除此之外的状态全部由状态码直接决定，无需文本。
 */
const AUTH_TEXT =
  /invalid[_\s-]?(?:api[_\s-]?)?key|api[_\s-]?key[_\s-]?(?:not[_\s-]?valid|invalid)|incorrect api key|unauthorized|authentication|invalid token|密钥无效|凭证无效|未认证/i
const QUOTA_TEXT =
  /insufficient[_\s-]?quota|exceeded your current quota|out of credit|billing|payment[_\s-]?required|余额不足|额度不足|欠费|充值/i

/** 异常（无 HTTP 响应）阶段使用的文本特征 */
const TIMEOUT_TEXT = /timeout|timed out|etimedout|超时/i
const INVALID_URL_TEXT =
  /invalid url|failed to parse url|unsupported protocol|only absolute urls|invalid protocol|无效的 url/i

/** 凭证脱敏规则：Bearer Token、sk-* Key、常见 key=/token: 字段与查询参数 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/gi, replacement: '[REDACTED]' },
  {
    pattern:
      /(["']?(?:api[_-]?key|x-api-key|access[_-]?token|token|authorization|key)["']?\s*[:=]\s*["']?)[^"',&\s}]+/gi,
    replacement: '$1[REDACTED]',
  },
]

/**
 * 按 HTTP 状态码分类。文本仅用于消解 400 / 403 / 429 三个歧义状态。
 *
 * @param status   HTTP 状态码
 * @param bodyText 错误响应体文本（仅用于歧义消解，可为空）
 */
export function classifyHttpStatus(status: number, bodyText = ''): ChannelTestErrorType {
  // 5xx：无论响应体如何，都是供应商侧故障
  if (status >= 500) return 'server'

  switch (status) {
    case 401:
      return 'auth'
    case 402:
      return 'quota'
    case 403:
      // 多数 Provider 用 403 表示「禁止 / 无权限」；
      // 但 Google 等会用 403 表达 Key 无效 —— 借文本消解。
      return AUTH_TEXT.test(bodyText) ? 'auth' : 'permission'
    case 404:
      return 'not_found'
    case 408:
      return 'timeout'
    case 429:
      // OpenAI 用 429 表达 insufficient_quota —— 借文本区分「欠费」与「限流」。
      return QUOTA_TEXT.test(bodyText) ? 'quota' : 'rate_limit'
    case 400:
      // Google 用 400「API key not valid」表达 Key 无效 —— 借文本消解。
      return AUTH_TEXT.test(bodyText) ? 'auth' : 'bad_request'
    case 405:
    case 409:
    case 413:
    case 415:
    case 422:
      return 'bad_request'
    default:
      return 'unknown'
  }
}

/** 判断对象（排除数组与 null） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/**
 * 从错误响应体中提取可读消息。
 * 兼容 OpenAI / Anthropic / Google 的 `{ error: { message } }` 结构，
 * 也兼容顶层 `{ message }`；非 JSON（纯文本 / HTML）原样返回。
 */
export function extractErrorMessage(bodyText: string): string {
  const trimmed = bodyText.trim()
  if (!trimmed) return ''

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return trimmed

    const target = isRecord(parsed.error) ? parsed.error : parsed
    const message = readString(target, 'message')
    if (message) return message

    const code =
      readString(target, 'code') || readString(target, 'type') || readString(target, 'status')
    return code || trimmed
  } catch {
    return trimmed
  }
}

/**
 * 对错误摘要脱敏、压缩空白并截断到上限。
 */
export function summarizeDetail(text: string): string | undefined {
  const redacted = SENSITIVE_PATTERNS.reduce(
    (acc, { pattern, replacement }) => acc.replace(pattern, replacement),
    text,
  )
  const normalized = redacted.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > MAX_DETAIL_LENGTH
    ? `${normalized.slice(0, MAX_DETAIL_LENGTH)}…`
    : normalized
}

function buildFailure(
  errorType: ChannelTestErrorType,
  detail: string,
  statusCode?: number,
): ChannelTestResult {
  const summary = summarizeDetail(detail)
  const statusPart = statusCode == null ? '' : ` (${statusCode})`
  const detailPart = summary ? `：${summary}` : ''

  return {
    success: false,
    message: `${ERROR_LABELS[errorType]}${statusPart}${detailPart}`,
    errorType,
    ...(statusCode == null ? {} : { statusCode }),
    ...(summary ? { detail: summary } : {}),
  }
}

/**
 * 在字节上限内读取错误响应体，避免把超大错误页全部读进内存。
 */
async function readBoundedText(response: Response): Promise<string> {
  const body = response.body
  if (!body) {
    try {
      return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES)
    } catch {
      return ''
    }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0

  try {
    while (bytes < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break

      const remaining = MAX_ERROR_BODY_BYTES - bytes
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      out += decoder.decode(chunk, { stream: true })
      bytes += chunk.byteLength

      if (chunk.byteLength < value.byteLength) break
    }
    out += decoder.decode()
  } catch {
    // 读取中断：返回已读部分
  } finally {
    await reader.cancel().catch(() => {})
  }

  return out
}

function collectErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const parts = [error.name, error.message]
  if (error.cause instanceof Error) {
    parts.push(error.cause.name, error.cause.message)
  } else if (error.cause != null) {
    parts.push(String(error.cause))
  }
  return parts.filter(Boolean).join(': ')
}

/**
 * 归一化一个 HTTP 响应：仅 2xx 视为成功，其余按状态码分类并附脱敏摘要。
 */
export async function normalizeHttpResponse(response: Response): Promise<ChannelTestResult> {
  if (response.ok) {
    return { success: true, message: '连接成功' }
  }

  const bodyText = await readBoundedText(response)
  const errorType = classifyHttpStatus(response.status, bodyText)
  const detail = extractErrorMessage(bodyText) || response.statusText
  return buildFailure(errorType, detail, response.status)
}

/**
 * 归一化一个请求异常（无 HTTP 响应）：超时 / 非法 URL / 网络。
 * fetch 抛出但非以上两类时，绝大多数是连通性问题，归类为 network。
 */
export function normalizeRequestError(error: unknown): ChannelTestResult {
  const detail = collectErrorText(error)

  if (
    (error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
    TIMEOUT_TEXT.test(detail)
  ) {
    return buildFailure('timeout', detail)
  }

  if (INVALID_URL_TEXT.test(detail)) {
    return buildFailure('bad_request', detail)
  }

  return buildFailure('network', detail)
}
