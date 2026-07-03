/**
 * Claude Agent SDK 适配器
 *
 * 实现 AgentProviderAdapter 接口，直接透传 SDK 的 SDKMessage 流。
 * 使用 includePartialMessages: false 获取完整 JSON 对象，无需逐 chunk 翻译。
 */

import type {
  AgentQueryInput,
  AgentProviderAdapter,
  SDKUserMessageInput,
  TypedError,
  ErrorCode,
  ThinkingConfig,
  AgentEffort,
  AgentDefinition,
  JsonSchemaOutputFormat,
  SDKMessage,
  PromaPermissionMode,
} from '@proma/shared'
import {
  THINKING_SIGNATURE_ERROR_MESSAGE,
  THINKING_SIGNATURE_ERROR_TITLE,
  isThinkingSignatureError as matchesThinkingSignatureError,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'
import { TRANSIENT_NETWORK_PATTERN, isMalformedResponseError } from '../error-patterns'
import { spawn as spawnChild, execFileSync } from 'node:child_process'

/** SDK Query 对象类型（从动态导入中推断） */
type SDKQuery = ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>

/** SDK 用户消息类型 */
type SDKUserMessage = import('@anthropic-ai/claude-agent-sdk').SDKUserMessage

// ============================================================================
// 长生命周期消息通道
// ============================================================================

/**
 * 异步消息队列，作为 SDK streamInput 的持久化 AsyncGenerator。
 *
 * 解决的问题：SDK 的 streamInput() 在消费完 AsyncGenerator 后会调用 endInput()
 * 关闭 CLI 的 stdin。如果使用单次 yield 的 generator，第一轮对话结束后 stdin 即关闭，
 * 导致后续所有工具权限请求（sendRequest）因 inputClosed=true 而抛出 "Stream closed"。
 *
 * Generator 在会话期间保持活跃以支持工具权限注入。收到 result 后由 adapter 调用 close()，
 * 让 SDK 自然调用 endInput() 关闭 stdin，子进程检测到 EOF 后退出，iterator 返回 done:true。
 */
interface MessageChannel {
  /** 向队列推送消息（非阻塞） */
  enqueue: (msg: SDKUserMessage) => void
  /** 供 SDK streamInput() 消费的长生命周期 AsyncGenerator */
  generator: AsyncGenerator<SDKUserMessage>
  /** 优雅关闭：标记 generator 结束，排空剩余消息后返回，让 SDK 自然调用 endInput() 关闭 stdin */
  close: () => void
}

function createMessageChannel(signal: AbortSignal): MessageChannel {
  const queue: SDKUserMessage[] = []
  let resolver: ((value: void) => void) | null = null
  let done = signal.aborted // 防御：signal 已 aborted 时直接标记结束

  // abort 时标记结束，唤醒可能阻塞的 generator
  if (!done) {
    signal.addEventListener('abort', () => {
      done = true
      if (resolver) {
        const r = resolver
        resolver = null
        r()
      }
    }, { once: true })
  }

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else {
        // 等待新消息入队或 abort 信号
        await new Promise<void>((resolve) => { resolver = resolve })
      }
    }
    // 排空剩余消息
    while (queue.length > 0) {
      yield queue.shift()!
    }
  }

  return {
    enqueue: (msg: SDKUserMessage) => {
      queue.push(msg)
      if (resolver) {
        const r = resolver
        resolver = null
        r()
      }
    },
    generator: generator(),
    close: () => {
      done = true
      if (resolver) {
        const r = resolver
        resolver = null
        r()
      }
    },
  }
}

// ============================================================================
// Claude 适配器专用查询选项
// ============================================================================

/** Claude SDK 查询选项（扩展通用 AgentQueryInput） */
export interface ClaudeAgentQueryOptions extends AgentQueryInput {
  /** SDK native binary 路径（claude 或 claude.exe） */
  sdkCliPath: string
  /** 环境变量（含 API Key、Base URL、代理等） */
  env: Record<string, string | undefined>
  /** 最大轮次（undefined = SDK 默认） */
  maxTurns?: number
  /** SDK 权限模式（Proma 当前三种模式直接映射 SDK 原生模式） */
  sdkPermissionMode: PromaPermissionMode
  /** 是否跳过权限检查 */
  allowDangerouslySkipPermissions: boolean
  /** 自定义权限处理器（匹配 SDK CanUseTool 签名） */
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ) => Promise<PermissionResult>
  /** 只读工具白名单 */
  allowedTools?: string[]
  /** 系统提示词（字符串为自定义提示词，对象为 claude_code preset） */
  systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string }
  /** SDK session ID（用于 resume） */
  resumeSessionId?: string
  /** resume 时从指定消息 uuid 处截断（配合 forkSession 实现分叉） */
  resumeSessionAt?: string
  /** MCP 服务器配置 */
  mcpServers?: Record<string, unknown>
  /** 仅使用 Proma 显式传入的 MCP 配置，避免 SDK 从其它来源发现额外 MCP */
  strictMcpConfig?: boolean
  /** 插件配置 */
  plugins?: Array<{ type: 'local'; path: string; skipMcpDiscovery?: boolean }>
  /** stderr 回调 */
  onStderr?: (data: string) => void
  /** SDK session ID 捕获回调 */
  onSessionId?: (sdkSessionId: string) => void
  /** 模型确认回调 */
  onModelResolved?: (model: string) => void
  /** 上下文窗口缓存回调 */
  onContextWindow?: (contextWindow: number) => void

  // ===== SDK 0.2.52 ~ 0.2.63 新增选项 =====

  /** 思考模式配置（替代已废弃的 maxThinkingTokens） */
  thinking?: ThinkingConfig
  /** 推理深度等级（与 adaptive thinking 配合使用） */
  effort?: AgentEffort
  /** 自定义子代理定义 */
  agents?: Record<string, AgentDefinition>
  /** 主线程使用的代理名称（必须在 agents 中定义） */
  agent?: string
  /** 启用文件检查点（支持 rewindFiles 回退） */
  enableFileCheckpointing?: boolean
  /** 禁止使用的工具名称列表 */
  disallowedTools?: string[]
  /** 备用模型（主模型不可用时使用） */
  fallbackModel?: string
  /** 最大预算（美元），超出后停止查询 */
  maxBudgetUsd?: number
  /** 结构化 JSON 输出格式 */
  outputFormat?: JsonSchemaOutputFormat
  /** 是否持久化会话到磁盘（默认 true） */
  persistSession?: boolean
  /** resume 时是否 fork 为新会话 */
  forkSession?: boolean
  /** 指定 SDK 会话 ID（替代自动生成，与 AgentQueryInput.sessionId 区分） */
  sdkSessionId?: string
  /** 附加的外部目录（SDK additionalDirectories） */
  additionalDirectories?: string[]
}

// ============================================================================
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
// ClaudeAgentAdapter
// ============================================================================

/** 活跃的 AbortController 映射（sessionId → controller） */
const activeControllers = new Map<string, AbortController>()

/** 活跃的 SDK Query 对象映射（sessionId → query），用于队列消息注入 */
const activeQueries = new Map<string, SDKQuery>()

/** 活跃的消息通道映射（sessionId → channel），供后续消息注入 */
const activeChannels = new Map<string, MessageChannel>()

/** Query 就绪 Promise（在 SDK init 完成前缓冲队列消息） */
const queryReadyPromises = new Map<string, Promise<void>>()
const queryReadyResolvers = new Map<string, () => void>()

/** SDK init 超时时间（毫秒） */
const QUERY_READY_TIMEOUT_MS = 60_000

/**
 * 活跃会话的 claude 子进程 PID 映射（sessionId → pid）
 *
 * 通过 spawnClaudeCodeProcess hook 在子进程启动时记录。
 * 异常场景下 SDK 自身的 2s SIGTERM + 5s SIGKILL 兜底可能失效（见 Issue #357 残留分析），
 * abort() / dispose() 在 close 后再做一轮平台差异化 force-kill 兜底。
 */
const pidMap = new Map<string, number>()

/** 延时 force-kill 的 timer 句柄，用于 dispose / 重复 abort 时取消 */
const forceKillTimers = new Map<string, NodeJS.Timeout>()

/** abort 后等待 SDK 自身兜底（2s+5s）再检测并强杀的延时 */
const FORCE_KILL_GRACE_MS = 10_000

/**
 * 后台任务挂起时，无任何活动则释放子进程的空闲上限（1 小时）。
 * 与 SDK 自动唤醒机制的时限上界对齐：ScheduleWakeup 最长 3600s、非持久 Monitor 最长 3600000ms。
 * 超过此窗口无任何 task_notification/活动，说明 persistent Monitor 已无事件，安全释放子进程。
 */
const BACKGROUND_IDLE_TIMEOUT_MS = 60 * 60 * 1000

/**
 * 平台差异化强制终止：macOS/Linux 用 SIGKILL，Windows 用 taskkill /F /T 级联杀子孙
 *
 * Windows 备注：Node 的 process.kill 对原生 binary 只发 TerminateProcess，且不级联子进程，
 * 必须用 taskkill /T 才能杀掉 claude.exe 下挂的 bash / MCP 等孙进程。
 */
export function forceKillClaudeProcess(pid: number): void {
  try {
    // 存活探测：dead 会抛 ESRCH
    process.kill(pid, 0)
  } catch {
    return
  }
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
    console.warn(`[Claude 适配器] force-killed residual claude pid=${pid}`)
  } catch (error) {
    console.warn(`[Claude 适配器] force-kill pid=${pid} 失败:`, error)
  }
}

function scheduleForceKill(sessionId: string, pid: number): void {
  // 取消旧 timer 防止累积（快速重复 abort 同一 session 的场景）
  const old = forceKillTimers.get(sessionId)
  if (old) clearTimeout(old)

  const timer = setTimeout(() => {
    forceKillTimers.delete(sessionId)
    // 仍是同一个 pid 才杀（防止期间 SDK 自己已清理、又被其他会话复用 pid）
    if (pidMap.get(sessionId) === pid) {
      forceKillClaudeProcess(pid)
      pidMap.delete(sessionId)
    }
  }, FORCE_KILL_GRACE_MS)
  timer.unref?.()
  forceKillTimers.set(sessionId, timer)
}

export class ClaudeAgentAdapter implements AgentProviderAdapter {

  abort(sessionId: string): void {
    // 先调用 query.close() 强制终止 CLI 子进程及其所有子进程（包括正在运行的 bash 命令）
    const query = activeQueries.get(sessionId)
    if (query) {
      try {
        query.close()
      } catch {
        // query 可能已关闭或子进程已退出，忽略
      }
      activeQueries.delete(sessionId)
    }

    activeChannels.delete(sessionId)

    const controller = activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      activeControllers.delete(sessionId)
    }

    // 兜底 force-kill：SDK 内部有 2s SIGTERM + 5s SIGKILL，但某些场景仍会残留（见 Issue #357）
    // 给 SDK 足够时间自行清理，超时后仍存活则按平台差异强杀
    const pid = pidMap.get(sessionId)
    if (pid) {
      scheduleForceKill(sessionId, pid)
    }
  }

  /**
   * 软中断当前 turn（用户流式追加并要求立即打断时使用）。
   *
   * 调用 SDK 的 query.interrupt()：停止当前 turn 但保留子进程与消息通道。
   * 调用后 SDK 会 yield 一条 result（subtype: 'interrupt'），随后从 channel
   * 继续读取下一条用户输入——此方法通常紧跟 sendQueuedMessage() 使用。
   *
   * 若查询已不存在（如已经 abort 过），静默返回。
   */
  async interruptQuery(sessionId: string): Promise<void> {
    const query = activeQueries.get(sessionId)
    if (!query) return
    try {
      await query.interrupt()
      console.log(`[Claude 适配器] 已软中断当前 turn: sessionId=${sessionId}`)
    } catch (error) {
      console.warn(`[Claude 适配器] 软中断失败: sessionId=${sessionId}`, error)
    }
  }

  dispose(): void {
    for (const timer of forceKillTimers.values()) {
      clearTimeout(timer)
    }
    forceKillTimers.clear()
    for (const [, query] of activeQueries) {
      try {
        query.close()
      } catch {
        // 忽略已关闭的 query
      }
    }
    for (const [, controller] of activeControllers) {
      controller.abort()
    }

    // 应用退出场景：对所有已知 PID 立即强杀（不等 10s grace）
    // dispose() 通常由 stopAll / before-quit 调用，用户已经决定清场
    for (const [sessionId, pid] of pidMap) {
      forceKillClaudeProcess(pid)
      pidMap.delete(sessionId)
    }

    activeControllers.clear()
    activeQueries.clear()
    activeChannels.clear()
    queryReadyPromises.clear()
    queryReadyResolvers.clear()
  }

  /**
   * 发起查询，返回 SDKMessage 异步迭代流
   *
   * 使用 includePartialMessages: false 获取完整 JSON 对象，直接透传。
   */
  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const options = input as ClaudeAgentQueryOptions

    // 创建 AbortController
    const controller = new AbortController()
    activeControllers.set(options.sessionId, controller)

    // 创建 Query 就绪 Promise（队列消息会等待此 Promise）
    const readyPromise = new Promise<void>((resolve) => {
      queryReadyResolvers.set(options.sessionId, resolve)
    })
    queryReadyPromises.set(options.sessionId, readyPromise)

    // 后台任务等待态：本轮结束时若仍有 background_tasks/session_crons 在飞行，
    // 保持消息通道开启（不 close），让 SDK 子进程存活、在任务完成时自动 yield
    // task_notification 驱动新一轮 turn。idleTimer 是兜底：超过空闲上限无任何活动则释放子进程。
    // 声明在 try 外，使 finally 也能 clearIdleTimer。
    let backgroundTasksPending = false
    let idleTimer: NodeJS.Timeout | null = null
    const clearIdleTimer = (): void => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    }

    try {
      // 动态导入 SDK
      const sdk = await import('@anthropic-ai/claude-agent-sdk')

      // armIdleTimer 闭包引用下方创建的 channel，故定义在 try 内（channel 在作用域内）。
      const armIdleTimer = (): void => {
        clearIdleTimer()
        idleTimer = setTimeout(() => {
          console.warn(`[Claude 适配器] 后台任务空闲超时 (${BACKGROUND_IDLE_TIMEOUT_MS}ms)，释放子进程: ${options.sessionId}`)
          channel.close()
        }, BACKGROUND_IDLE_TIMEOUT_MS)
        idleTimer.unref?.()
      }

      // SDK options 构建
      const sdkOptions = {
        // 基础字段
        pathToClaudeCodeExecutable: options.sdkCliPath,
        model: options.model || 'claude-sonnet-5',
        ...(options.maxTurns != null && { maxTurns: options.maxTurns }),
        permissionMode: options.sdkPermissionMode,
        allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
        // 关键：false 获取完整消息，与 v2 stream() 返回格式一致
        includePartialMessages: false,
        // 关闭 SDK 自动 prompt_suggestion：它在每轮 result 之后才到达，是旧版「收到 result 后
        // 仍需等 2s 尾部消息」约束的根源。关闭后 result 即本轮最后一条消息，adapter 可在 result
        // 后立即主动终止 iterator（见下方终止分支）。Plan 模式的「请执行该计划」建议由
        // orchestrator 自行注入，不依赖此选项，故功能不受影响。
        promptSuggestions: false,
        cwd: options.cwd,
        abortController: controller,
        env: options.env,
        systemPrompt: options.systemPrompt,
        // 不加载 local 级别的 .claude/settings.local.json
        settingSources: ['user', 'project'],

        // 条件字段
        ...(options.canUseTool && { canUseTool: options.canUseTool }),
        ...(options.allowedTools && { allowedTools: options.allowedTools }),
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.resumeSessionAt && { resumeSessionAt: options.resumeSessionAt }),
        ...(options.mcpServers && Object.keys(options.mcpServers).length > 0 && {
          mcpServers: options.mcpServers as Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig>,
        }),
        ...(options.strictMcpConfig != null && { strictMcpConfig: options.strictMcpConfig }),
        ...(options.plugins && { plugins: options.plugins }),
        ...(options.onStderr && { stderr: options.onStderr }),

        // SDK 0.2.52+ 新增选项透传
        ...(options.thinking && { thinking: options.thinking }),
        ...(options.effort && { effort: options.effort }),
        ...(options.agents && { agents: options.agents }),
        ...(options.agent && { agent: options.agent }),
        ...(options.enableFileCheckpointing != null && { enableFileCheckpointing: options.enableFileCheckpointing }),
        ...(options.disallowedTools && { disallowedTools: options.disallowedTools }),
        ...(options.fallbackModel && { fallbackModel: options.fallbackModel }),
        ...(options.maxBudgetUsd != null && { maxBudgetUsd: options.maxBudgetUsd }),
        ...(options.outputFormat && { outputFormat: options.outputFormat }),
        ...(options.persistSession != null && { persistSession: options.persistSession }),
        ...(options.forkSession != null && { forkSession: options.forkSession }),
        ...(options.sdkSessionId && { sessionId: options.sdkSessionId }),
        ...(options.additionalDirectories && options.additionalDirectories.length > 0 && {
          additionalDirectories: options.additionalDirectories,
        }),
        // 强制顺序执行工具，防止并发 tool_use 导致 400 错误
        // 根因：多个 tool_use 并发时若结果未完整批量提交会触发 invalid_request_error
        toolUseConcurrency: 1,

        // Stop hook 观察者：读取本轮结束时仍在飞行的后台任务/定时任务集合。
        // background_tasks（run_in_background bash / Monitor / subagent）与 session_crons
        // （ScheduleWakeup / CronCreate）是 SDK 权威信息，且 Stop hook 走控制协议、
        // 在 result 消息发到 host 之前完成，故 result 处理时 backgroundTasksPending 已是最新。
        // 仅观察、绝不返回 decision:'block'（那会强制模型继续输出）。
        hooks: {
          Stop: [{
            hooks: [async (input: unknown) => {
              const bt = (input as { background_tasks?: unknown[] }).background_tasks
              const crons = (input as { session_crons?: unknown[] }).session_crons
              backgroundTasksPending =
                (Array.isArray(bt) && bt.length > 0) ||
                (Array.isArray(crons) && crons.length > 0)
              return { continue: true }
            }],
          }],
        },

        // 自定义 spawn：记录 PID 以供 abort/dispose 做 force-kill 兜底（Issue #357）
        // 注意：一旦提供 spawnClaudeCodeProcess，SDK 会完全绕过 spawnLocalProcess，
        // 因此 options.stderr 回调需要在这里手动转发，否则 extractApiError / 重试判断全部失效
        spawnClaudeCodeProcess: (spawnOpts: import('@anthropic-ai/claude-agent-sdk').SpawnOptions) => {
          const child = spawnChild(spawnOpts.command, spawnOpts.args, {
            cwd: spawnOpts.cwd,
            env: spawnOpts.env,
            signal: spawnOpts.signal,
            stdio: ['pipe', 'pipe', 'pipe'],
            // 与 SDK 默认 spawnLocalProcess 保持一致，避免 Windows 上为 claude.exe 创建独立控制台。
            windowsHide: true,
          })
          // 手动转发 stderr（SDK 默认在 spawnLocalProcess 里做，自定义 spawn 需自己做）
          // 同时必须消费 stderr 流避免缓冲区满（默认 64KB）导致子进程挂起
          if (options.onStderr) {
            const onStderr = options.onStderr
            child.stderr?.on('data', (chunk: Buffer) => {
              try { onStderr(chunk.toString()) } catch { /* 用户回调异常不影响流 */ }
            })
          } else {
            // 即便上层不关心，也要 resume() 流否则缓冲会阻塞
            child.stderr?.resume()
          }
          if (child.pid) {
            pidMap.set(options.sessionId, child.pid)
            child.once('exit', () => {
              // 仅当当前记录就是这个 pid 时才清理，防止并发会话误删
              if (pidMap.get(options.sessionId) === child.pid) {
                pidMap.delete(options.sessionId)
              }
            })
          }
          return child as unknown as import('@anthropic-ai/claude-agent-sdk').SpawnedProcess
        },
      } as import('@anthropic-ai/claude-agent-sdk').Options

      // 使用持久化消息通道：在查询期间保持 generator 活跃以支持工具权限注入，
      // 收到 result 后调用 channel.close() 让 SDK 自然关闭 stdin 并退出子进程。
      const channel = createMessageChannel(controller.signal)

      // 将初始 prompt 入队
      channel.enqueue({
        type: 'user' as const,
        session_id: options.sessionId,
        message: {
          role: 'user' as const,
          content: options.prompt,
        },
        parent_tool_use_id: null,
      } as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage)

      const queryIterator = sdk.query({
        prompt: channel.generator,
        options: sdkOptions,
      })

      // 保存 Query 和 Channel 引用，供后续消息注入使用
      activeQueries.set(options.sessionId, queryIterator)
      activeChannels.set(options.sessionId, channel)

      // 通知 Query 已就绪，解除 sendQueuedMessage 的等待
      const resolveReady = queryReadyResolvers.get(options.sessionId)
      if (resolveReady) {
        resolveReady()
        queryReadyResolvers.delete(options.sessionId)
      }

      // 终止标记：收到非 keep-open 的 terminal result 后置 true，yield 该 result 后主动 break。
      // SDK 0.3.185 把会话终止逻辑挪进了 cleanup()，而 cleanup() 只在 iterator.return() 被调用时
      // 触发（旧版「关 stdin → 子进程 EOF 退出 → 输出流自然 done」的链路已废弃，见 Transport.close
      // 注释 "eliminating need for endInput"）。for-await 的 break 会自动对 SDK iterator 调
      // .return()，进而触发 cleanup（内部 Promise.race([waitForExit(), 2s]) 有界），让子进程退出、
      // 输出流结束。这样 orchestrator 的 next() 立即拿到 done:true 走自然退出路径，无需再依赖其
      // 2s drain timeout 兜底。promptSuggestions 已关闭，result 即本轮最后一条消息，break 不会丢消息。
      let terminateAfterTerminalResult = false

      for await (const sdkMessage of queryIterator) {
        if (controller.signal.aborted) break

        const msg = sdkMessage as Record<string, unknown>

        // 捕获 SDK session_id
        if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
          options.onSessionId?.(msg.session_id)
        }

        // 捕获 system init 中的模型确认
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (typeof msg.model === 'string') {
            options.onModelResolved?.(msg.model)
          }
        }

        // 后台任务等待期间收到任意 task 活动消息：重置空闲计时器，避免误释放子进程。
        if (msg.type === 'system' && idleTimer != null) {
          const sub = msg.subtype
          if (sub === 'task_started' || sub === 'task_progress' || sub === 'task_notification') {
            armIdleTimer()
          }
        }

        // 捕获 result 中的 contextWindow
        // 多 entry 场景（Task 子 Agent 等）：取最大 contextWindow 作为分母，
        // 避免子 Agent 的小窗口覆盖主模型的大窗口、导致 UI 指示器飘忽。
        if (msg.type === 'result') {
          const resultMsg = msg as {
            modelUsage?: Record<string, { contextWindow?: number }>
            terminal_reason?: string
          }
          if (resultMsg.modelUsage) {
            let bestWindow: number | undefined
            for (const info of Object.values(resultMsg.modelUsage)) {
              if (info?.contextWindow && (bestWindow === undefined || info.contextWindow > bestWindow)) {
                bestWindow = info.contextWindow
              }
            }
            if (bestWindow != null) {
              options.onContextWindow?.(bestWindow)
            }
          }
          // 被软中断 / 延迟工具 / hook 暂停等场景产生的 result：不关闭通道，
          // 让 SDK 继续读取通道中已排队（或后续注入）的消息并开启新一轮 turn。
          // 完整白名单见 CONTINUABLE_TERMINAL_REASONS。
          //
          // 注意：keep-open 场景本身就是"等待用户决策"（权限审批、Exit Plan、AskUser 等），
          // 不在此处加闲置超时——用户离开再回来继续交互是合法的，强行超时会破坏体验。
          // 若用户关闭 Tab，TabBar/GlobalShortcuts 会主动调 stopAgent → abort() 终止子进程。
          const keepForReason = shouldKeepChannelOpen(resultMsg.terminal_reason)
          // terminal_reason 无法区分"真完成"与"完成但有后台任务挂起"，
          // 后者由 Stop hook 观察者刷新的 backgroundTasksPending 标识。
          const keepForTasks = backgroundTasksPending

          if (keepForTasks && !keepForReason) {
            // 本轮主体结束、但仍有后台任务/定时任务在飞行：保持通道开启，
            // 子进程存活并在任务完成时自动 yield task_notification 驱动新一轮。
            // 给消息打注解，让 orchestrator 走"轻量完成"（UI 空闲但保留会话）而非彻底释放。
            ;(msg as Record<string, unknown>)._keepChannelOpenForTasks = true
            armIdleTimer()
          } else if (keepForReason) {
            // 既有"可继续"路径（abort/defer/hook，对应权限/ExitPlan/AskUser 等待）：
            // 保持通道开启。本轮并非真正空闲——SDK 会继续驱动新一轮，故不打
            // _keepChannelOpenForTasks 注解（不让 UI 进软空闲态，否则会与"继续中"的真实状态冲突）。
            // 但若此时同时有后台任务在飞行（keepForTasks），仍 arm idle timer 作为安全网：
            // 任务活动会持续重置计时器，仅在长时间彻底静默时兜底释放子进程，避免叠加场景下子进程泄漏。
            if (keepForTasks) armIdleTimer()
          } else {
            // result 表示本轮真正结束。先关闭消息通道（让 SDK 不再读取新输入），
            // 再标记 terminateAfterTerminalResult，在 yield 本条 result 后主动 break 出循环。
            // break 会对 SDK iterator 调 .return() → 触发 SDK cleanup（关闭 in-process MCP 传输 +
            // 有界等待子进程退出），输出流随即结束。SDK 0.3.185 已不再走「stdin EOF → 自然 done」
            // 链路（见 Transport.close 注释），必须由 .return() 驱动终止，否则会挂在 next() 上、
            // 只能靠 orchestrator 的 2s drain timeout 兜底。promptSuggestions 已关闭，result 即
            // 本轮最后一条消息，break 不会丢失尾部消息。
            clearIdleTimer()
            channel.close()
            terminateAfterTerminalResult = true
          }
        }

        yield sdkMessage as SDKMessage

        // terminal result 已 yield，主动结束循环触发 SDK iterator 的优雅清理
        if (terminateAfterTerminalResult) break
      }
    } finally {
      // 注意：pidMap 的清理由 child.on('exit') 触发，不在这里清除
      // 原因：finally 可能先于子进程真正退出执行，此时仍需保留 PID 以便 abort/dispose 兜底
      clearIdleTimer()
      activeControllers.delete(options.sessionId)
      activeQueries.delete(options.sessionId)
      activeChannels.delete(options.sessionId)
      queryReadyPromises.delete(options.sessionId)
      queryReadyResolvers.delete(options.sessionId)
    }
  }

  /**
   * 向活跃查询注入队列消息
   *
   * 通过持久化消息通道直接入队，由 SDK streamInput() 的长生命周期 generator 消费。
   * 不再单独调用 query.streamInput()，避免触发 endInput() 关闭 CLI stdin。
   */
  async sendQueuedMessage(sessionId: string, message: SDKUserMessageInput): Promise<void> {
    // 等待 Query 就绪（SDK init 可能需要几秒）
    const readyPromise = queryReadyPromises.get(sessionId)
    if (readyPromise) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('[Claude 适配器] 等待 SDK 初始化超时，请稍后重试')), QUERY_READY_TIMEOUT_MS)
      })
      try {
        await Promise.race([readyPromise, timeoutPromise])
      } finally {
        clearTimeout(timeoutHandle)
      }
    }

    const channel = activeChannels.get(sessionId)
    if (!channel) {
      throw new Error(`[Claude 适配器] 无活跃消息通道可注入队列消息: ${sessionId}`)
    }
    // 通过消息通道入队，generator 会自动 yield 给 SDK
    channel.enqueue(message as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage)
    console.log(`[Claude 适配器] 队列消息已注入: sessionId=${sessionId}, uuid=${message.uuid}, priority=${message.priority}`)
  }

  /**
   * 取消队列中的待发送消息
   *
   * 通过构造 cancel_async_message 控制消息注入，
   * 由 SDK 内部匹配 uuid 并从命令队列中移除。
   */
  async cancelQueuedMessage(sessionId: string, messageUuid: string): Promise<void> {
    const query = activeQueries.get(sessionId)
    if (!query) return
    // cancel_async_message 需要通过 streamInput 传递一个特殊的控制消息
    // SDK Query 对象本身没有直接的 cancel 方法，但 streamInput 接受 SDKUserMessage
    // 此处我们通过重新注入一个 'now' 优先级的空消息来间接触发
    // 实际上 SDK 的 cancel_async_message 是 control_request，暂时在 orchestrator 层管理
    console.log(`[Claude 适配器] 队列消息取消请求: sessionId=${sessionId}, uuid=${messageUuid}`)
  }

  /**
   * 动态切换活跃查询的权限模式
   *
   * 通过 SDK Query.setPermissionMode() 方法在查询进行中切换权限模式。
   * 典型场景：Plan 模式审批通过后切换到 bypassPermissions 或 auto。
   */
  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    const query = activeQueries.get(sessionId)
    if (!query) {
      console.warn(`[Claude 适配器] 无活跃查询，跳过权限模式切换: ${sessionId}`)
      return
    }
    await (query as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>).setPermissionMode(
      mode as import('@anthropic-ai/claude-agent-sdk').PermissionMode,
    )
    console.log(`[Claude 适配器] 权限模式已切换: sessionId=${sessionId}, mode=${mode}`)
  }
}

/**
 * 扫描并强杀所有孤儿 claude-agent-sdk 子进程（应用退出最后兜底）
 *
 * 使用场景：app.on('before-quit') 里 stopAllAgents() 之后调用。
 * 针对 pidMap 未覆盖、child 'exit' 事件未触发、dispose 漏杀等极端场景的最后一道防线。
 *
 * 匹配条件：父进程是当前进程 + 命令行含 "claude-agent-sdk"
 *
 * - macOS/Linux: `pgrep -P <pid>` 找所有子进程，再用 ps 过滤匹配的再 SIGKILL
 * - Windows: PowerShell 查 ParentProcessId + CommandLine 匹配后 Stop-Process
 *   （wmic 在 Win11 已被 deprecated，部分版本不再预装）
 *
 * 所有 execFileSync 都加 3s timeout，防止在异常进程表 / 权限不足等场景挂死 before-quit
 */
export function scanAndKillOrphanedClaudeSubprocesses(): void {
  const parentPid = process.pid
  const SCAN_TIMEOUT_MS = 3_000
  try {
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -like '*claude-agent-sdk*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: 'ignore', timeout: SCAN_TIMEOUT_MS },
      )
    } else {
      let childPids: string
      try {
        childPids = execFileSync('pgrep', ['-P', String(parentPid)], {
          encoding: 'utf8',
          timeout: SCAN_TIMEOUT_MS,
        })
      } catch {
        return // 无子进程 / pgrep 未安装 / 超时
      }
      for (const line of childPids.split('\n')) {
        const pid = parseInt(line.trim(), 10)
        if (!pid) continue
        try {
          const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
            encoding: 'utf8',
            timeout: SCAN_TIMEOUT_MS,
          })
          if (cmd.includes('claude-agent-sdk')) {
            process.kill(pid, 'SIGKILL')
            console.warn(`[Claude 适配器] 退出扫描: 强杀孤儿 claude 子进程 pid=${pid}`)
          }
        } catch {
          // ps 失败 / 进程已退出 / 超时，跳过
        }
      }
    }
  } catch (error) {
    console.warn('[Claude 适配器] 退出扫描执行失败:', error)
  }
}
