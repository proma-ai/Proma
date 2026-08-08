/**
 * Pi-only Agent runtime 的通用错误映射与终态判定。
 *
 * 这些规则属于 Proma 产品层，不依赖具体 Agent SDK。
 */

import type { ErrorCode, TypedError } from '@proma/shared'
import {
  THINKING_SIGNATURE_ERROR_MESSAGE,
  THINKING_SIGNATURE_ERROR_TITLE,
  isThinkingSignatureError as matchesThinkingSignatureError,
} from '@proma/shared'
import { TRANSIENT_NETWORK_PATTERN, isMalformedResponseError } from './error-patterns'

// SDK 错误消息友好化
// ============================================================================

/** 已知 SDK 错误 → 用户友好提示映射 */
const FRIENDLY_ERROR_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /not logged in|please run \/login/i,
    message: '请检查是否选择了正确的 Proma 供应渠道和模型',
  },
  {
    pattern: /validation error/i,
    message: 'API 请求格式校验失败，请重试或开启新会话',
  },
]

/** 错误消息最大保留长度（超出部分截断，防止存储膨胀） */
const MAX_ERROR_MESSAGE_LENGTH = 5000

/** 将 SDK 原始错误消息转换为用户友好的提示（无匹配则返回原文） */
export function friendlyErrorMessage(raw: string): string {
  const isLong = raw.length > MAX_ERROR_MESSAGE_LENGTH
  const sample = isLong ? raw.slice(0, MAX_ERROR_MESSAGE_LENGTH) : raw
  for (const { pattern, message } of FRIENDLY_ERROR_MESSAGES) {
    if (pattern.test(sample)) return message
  }
  return isLong
    ? sample + `\n\n[错误详情过长 (${(raw.length / 1024).toFixed(0)}KB)，已截断]`
    : raw
}

// ============================================================================
// Terminal reason 白名单
// ============================================================================

/**
 * 表示"本轮结束但会话应继续"的 terminal_reason 白名单。
 *
 * SDK 0.2.96+ 在 SDKResultMessage 引入 `terminal_reason` 字段后，某些值并不代表
 * 会话真正结束，而是期望 host 保留 stdin 通道、驱动下一轮：
 * - `aborted_streaming` / `aborted_tools`：query.interrupt() 软中断，等队列续轮
 * - `tool_deferred`：工具被延迟执行（配套 result.deferred_tool_use），等异步回填
 * - `hook_stopped` / `stop_hook_prevented`：hook 层面的暂停，host 可继续注入消息
 *
 * 未列在此集合中的 terminal_reason（含 `undefined` 的旧版行为、`completed`、
 * `max_turns`、`prompt_too_long`、各类 error 等）一律按"本轮结束 + 关闭通道"处理。
 */
export const CONTINUABLE_TERMINAL_REASONS: ReadonlySet<string> = new Set([
  'aborted_streaming',
  'aborted_tools',
  'tool_deferred',
  'hook_stopped',
  'stop_hook_prevented',
])

/** 判断 result.terminal_reason 是否应保留消息通道以等待下一轮 */
export function shouldKeepChannelOpen(terminalReason: string | undefined): boolean {
  return terminalReason != null && CONTINUABLE_TERMINAL_REASONS.has(terminalReason)
}

// ============================================================================
// 错误映射
// ============================================================================

/** Prompt too long 错误关键词匹配 */
const PROMPT_TOO_LONG_PATTERNS = [
  'prompt is too long',
  'prompt_too_long',
  'input is too long',
  'context_length_exceeded',
  'maximum context length',
  'token limit',
  'exceeds the model',
] as const

/** 检测错误消息是否为 prompt too long 类型 */
export function isPromptTooLongError(...messages: string[]): boolean {
  const combined = messages.join(' ').toLowerCase()
  return PROMPT_TOO_LONG_PATTERNS.some((p) => combined.includes(p))
}

export function isThinkingSignatureError(...messages: string[]): boolean {
  return matchesThinkingSignatureError(...messages)
}

/** 从 assistant.error 文本中兜底提取 HTTP 状态码 */
function extractHttpStatusFromErrorText(...messages: string[]): number | null {
  const combined = messages.filter(Boolean).join('\n')
  const patterns = [
    /API Error:\s*(\d{3})/i,
    /API error[^:]*:\s+(\d{3})/i,
    /\b(?:HTTP|status|statusCode)\s*[:=]?\s*(\d{3})\b/i,
    /\b(\d{3})\s+\{[^}]*"error"/is,
  ]

  for (const pattern of patterns) {
    const match = combined.match(pattern)
    const statusCode = match?.[1] ? parseInt(match[1], 10) : NaN
    if (statusCode >= 400 && statusCode < 600) return statusCode
  }

  return null
}

/** 将 SDK 错误映射为 TypedError */
export function mapSDKErrorToTypedError(
  errorCode: string,
  detailedMessage: string,
  originalError: string,
): TypedError {
  if (isThinkingSignatureError(detailedMessage, originalError)) {
    return {
      code: 'thinking_signature_invalid',
      title: THINKING_SIGNATURE_ERROR_TITLE,
      message: THINKING_SIGNATURE_ERROR_MESSAGE,
      actions: [
        { key: 'n', label: '在新对话继续', action: 'retry_in_new_session' },
        { key: 'r', label: '重试', action: 'retry' },
      ],
      canRetry: true,
      retryDelayMs: 1000,
      originalError,
    }
  }

  const errorMap: Record<string, { code: ErrorCode; title: string; message: string; canRetry: boolean }> = {
    'authentication_failed': {
      code: 'invalid_api_key',
      title: '认证失败',
      message: '无法通过 API 认证，API Key 可能无效或已过期',
      canRetry: true,
    },
    'billing_error': {
      code: 'billing_error',
      title: '账单错误',
      message: '您的账户存在账单问题',
      canRetry: false,
    },
    'model_not_found': {
      code: 'invalid_model',
      title: '模型不可用',
      message: '当前渠道无法使用所选模型，请检查模型名称或切换模型',
      canRetry: false,
    },
    'invalid_request': {
      code: 'invalid_request',
      title: '请求无效',
      message: 'API 请求参数无效，请检查当前渠道与模型配置',
      canRetry: false,
    },
    'rate_limit': {
      code: 'rate_limited',
      title: '请求频率限制',
      message: '请求过于频繁，请稍后再试',
      canRetry: true,
    },
    'rate_limited': {
      code: 'rate_limited',
      title: '请求频率限制',
      message: '请求过于频繁，请稍后再试',
      canRetry: true,
    },
    'overloaded': {
      code: 'provider_error',
      title: '服务繁忙',
      message: 'API 服务当前过载，请稍后再试',
      canRetry: true,
    },
    'provider_error': {
      code: 'provider_error',
      title: '服务繁忙',
      message: 'API 服务当前过载或暂时异常，请稍后再试',
      canRetry: true,
    },
    'service_error': {
      code: 'service_error',
      title: '服务错误',
      message: 'API 服务暂时异常，请稍后再试',
      canRetry: true,
    },
    'api_error': {
      code: 'service_error',
      title: '服务错误',
      message: 'API 服务暂时异常，请稍后再试',
      canRetry: true,
    },
    'service_unavailable': {
      code: 'service_unavailable',
      title: '服务暂时不可用',
      message: 'API 服务暂时不可用，请稍后再试',
      canRetry: true,
    },
    'server_error': {
      code: 'service_error',
      title: '服务错误',
      message: 'API 服务暂时异常，请稍后再试',
      canRetry: true,
    },
    'prompt_too_long': {
      code: 'prompt_too_long',
      title: '上下文过长',
      message: '当前对话的上下文已超出模型限制，请压缩上下文或开启新会话',
      canRetry: false,
    },
  }

  // 瞬时网络错误（terminated / ECONNRESET / socket hang up 等）：
  // assistant.error 路径下，SDK 常常把这类错误标记为 errorType='unknown'，
  // 这里从 detailedMessage / originalError 兜底匹配，归类为可重试的 network_error。
  const looksLikeNetwork =
    (!errorMap[errorCode]) &&
    (TRANSIENT_NETWORK_PATTERN.test(detailedMessage ?? '') || TRANSIENT_NETWORK_PATTERN.test(originalError ?? ''))
  if (looksLikeNetwork) {
    return {
      code: 'network_error',
      title: '网络异常',
      message: detailedMessage || '上游 API 连接中断',
      actions: [
        { key: 's', label: '设置', action: 'settings' },
        { key: 'r', label: '重试', action: 'retry' },
      ],
      canRetry: true,
      retryDelayMs: 1000,
      originalError,
    }
  }

  // 上游响应体解析失败（JSON Parse error: Unable to parse JSON string 等）：
  // 网关返回 HTML 错误页 / SSE 流截断 / 代理注入脏数据导致 SDK 解析非 JSON 体失败，
  // SDK 常标记为 errorType='unknown'。归类为可重试的 service_error（已在重试白名单内）。
  const looksLikeMalformedResponse =
    (!errorMap[errorCode]) &&
    isMalformedResponseError(detailedMessage, originalError)
  if (looksLikeMalformedResponse) {
    return {
      code: 'service_error',
      title: '响应解析失败',
      message: '上游返回了无法解析的响应，通常为网关瞬时异常，正在重试',
      actions: [
        { key: 's', label: '设置', action: 'settings' },
        { key: 'r', label: '重试', action: 'retry' },
      ],
      canRetry: true,
      retryDelayMs: 1000,
      originalError,
    }
  }

  const httpStatus = extractHttpStatusFromErrorText(detailedMessage, originalError)
  if (httpStatus != null && (httpStatus === 429 || httpStatus >= 500)) {
    const isRateLimited = httpStatus === 429
    const isUnavailable = httpStatus === 503
    const isOverloaded = httpStatus === 529
    const isBadGateway = httpStatus === 502
    return {
      code: isRateLimited
        ? 'rate_limited'
        : (isOverloaded ? 'provider_error' : (isUnavailable ? 'service_unavailable' : 'service_error')),
      title: isRateLimited
        ? '请求频率限制'
        : (isOverloaded ? '服务繁忙' : (isUnavailable ? '服务暂时不可用' : (isBadGateway ? '网关异常' : '服务错误'))),
      message: detailedMessage || (
        isRateLimited
          ? '请求过于频繁，请稍后再试'
          : isOverloaded
            ? 'API 服务当前过载 (529)，通常很快恢复'
            : isBadGateway
              ? 'API 网关暂时异常 (502)，通常很快恢复'
              : `API 服务暂时异常 (${httpStatus})，请稍后再试`
      ),
      actions: [
        { key: 's', label: '设置', action: 'settings' },
        { key: 'r', label: '重试', action: 'retry' },
      ],
      canRetry: true,
      retryDelayMs: 1000,
      originalError,
    }
  }

  const mapped = errorMap[errorCode] || {
    code: 'unknown_error' as ErrorCode,
    title: '',
    message: detailedMessage || errorCode,
    canRetry: false,
  }

  // “未选择正确渠道/模型”场景：友好化后的文案已固定，无法登录多半是渠道或模型配置有误，
  // 引导用户直接重新选择模型，而非跳转设置页面
  const isInvalidChannelOrModel = /请检查是否选择了正确的 Proma 供应渠道和模型/.test(mapped.message)

  return {
    code: mapped.code,
    title: mapped.title,
    message: detailedMessage || mapped.message,
    actions: [
      isInvalidChannelOrModel
        ? { key: 'm', label: '重新选择模型', action: 'select_model' }
        : { key: 's', label: '设置', action: 'settings' },
      ...(mapped.canRetry ? [{ key: 'r', label: '重试', action: 'retry' }] : []),
      ...(mapped.code === 'prompt_too_long' ? [{ key: 'c', label: '压缩上下文', action: 'compact' }] : []),
    ],
    canRetry: mapped.canRetry,
    retryDelayMs: mapped.canRetry ? 1000 : undefined,
    originalError,
  }
}

/** 从 assistant 错误消息中提取详细信息 */
export function extractErrorDetails(msg: { error?: { message: string }; message?: { content?: Array<Record<string, unknown>> } }): { detailedMessage: string; originalError: string } {
  let detailedMessage = msg.error?.message ?? '未知错误'
  let originalError = msg.error?.message ?? '未知错误'

  try {
    const content = msg.message?.content
    if (Array.isArray(content) && content.length > 0) {
      const textBlock = content.find((block) => block.type === 'text')
      if (textBlock && 'text' in textBlock && typeof textBlock.text === 'string') {
        const fullText = textBlock.text
        originalError = fullText

        const apiErrorMatch = fullText.match(/API Error:\s*\d+\s*(\{.*\})/s)
        if (apiErrorMatch?.[1]) {
          try {
            const apiErrorObj = JSON.parse(apiErrorMatch[1])
            if (apiErrorObj.error?.message) {
              detailedMessage = apiErrorObj.error.message
            }
          } catch {
            detailedMessage = fullText
          }
        } else {
          detailedMessage = fullText
        }
      }
    }
  } catch {
    // 提取失败，使用原始 error 字段
  }

  return { detailedMessage, originalError }
}

// ============================================================================
