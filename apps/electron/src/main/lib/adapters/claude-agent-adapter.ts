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
  SdkBeta,
  JsonSchemaOutputFormat,
  SDKMessage,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'

/** SDK Query 对象类型（从动态导入中推断） */
type SDKQuery = ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>

// ============================================================================
// Claude 适配器专用查询选项
// ============================================================================

/** Claude SDK 查询选项（扩展通用 AgentQueryInput） */
export interface ClaudeAgentQueryOptions extends AgentQueryInput {
  /** SDK CLI 路径 */
  sdkCliPath: string
  /** 运行时可执行文件 */
  executable: { type: 'node' | 'bun'; path: string }
  /** 运行时额外参数 */
  executableArgs: string[]
  /** 环境变量（含 API Key、Base URL、代理等） */
  env: Record<string, string | undefined>
  /** 最大轮次（undefined = SDK 默认） */
  maxTurns?: number
  /** SDK 权限模式（直接使用 SDK 原生模式） */
  sdkPermissionMode: 'acceptEdits' | 'bypassPermissions' | 'plan'
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
  /** 插件配置 */
  plugins?: Array<{ type: 'local'; path: string }>
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
  /** Beta 特性（如 1M context window） */
  betas?: SdkBeta[]
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
]

/** 将 SDK 原始错误消息转换为用户友好的提示（无匹配则返回原文） */
export function friendlyErrorMessage(raw: string): string {
  for (const { pattern, message } of FRIENDLY_ERROR_MESSAGES) {
    if (pattern.test(raw)) return message
  }
  return raw
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

/** 将 SDK 错误映射为 TypedError */
export function mapSDKErrorToTypedError(
  errorCode: string,
  detailedMessage: string,
  originalError: string,
): TypedError {
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
    'prompt_too_long': {
      code: 'prompt_too_long',
      title: '上下文过长',
      message: '当前对话的上下文已超出模型限制，请压缩上下文或开启新会话',
      canRetry: false,
    },
  }

  const mapped = errorMap[errorCode] || {
    code: 'unknown_error' as ErrorCode,
    title: '',
    message: detailedMessage || errorCode,
    canRetry: false,
  }

  return {
    code: mapped.code,
    title: mapped.title,
    message: detailedMessage || mapped.message,
    actions: [
      { key: 's', label: '设置', action: 'settings' },
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

/** Query 就绪 Promise（在 SDK init 完成前缓冲队列消息） */
const queryReadyPromises = new Map<string, Promise<void>>()
const queryReadyResolvers = new Map<string, () => void>()

/** SDK init 超时时间（毫秒） */
const QUERY_READY_TIMEOUT_MS = 60_000

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

    const controller = activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      activeControllers.delete(sessionId)
    }
  }

  dispose(): void {
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
    activeControllers.clear()
    activeQueries.clear()
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

    try {
      // 动态导入 SDK
      const sdk = await import('@anthropic-ai/claude-agent-sdk')

      // SDK options 构建
      const sdkOptions = {
        // 基础字段
        pathToClaudeCodeExecutable: options.sdkCliPath,
        executable: options.executable.type,
        executableArgs: options.executableArgs,
        model: options.model || 'claude-sonnet-4-5-20250929',
        ...(options.maxTurns != null && { maxTurns: options.maxTurns }),
        permissionMode: options.sdkPermissionMode,
        allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
        // 关键：false 获取完整消息，与 v2 stream() 返回格式一致
        includePartialMessages: false,
        promptSuggestions: true,
        cwd: options.cwd,
        abortController: controller,
        env: options.env,
        systemPrompt: options.systemPrompt,
        // 不加载 user 级别的 ~/.claude/settings.json
        settingSources: ['user', 'project'],

        // 条件字段
        ...(options.canUseTool && { canUseTool: options.canUseTool }),
        ...(options.allowedTools && { allowedTools: options.allowedTools }),
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.resumeSessionAt && { resumeSessionAt: options.resumeSessionAt }),
        ...(options.mcpServers && Object.keys(options.mcpServers).length > 0 && {
          mcpServers: options.mcpServers as Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig>,
        }),
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
        ...(options.betas && { betas: options.betas }),
        ...(options.persistSession != null && { persistSession: options.persistSession }),
        ...(options.forkSession != null && { forkSession: options.forkSession }),
        ...(options.sdkSessionId && { sessionId: options.sdkSessionId }),
        ...(options.additionalDirectories && options.additionalDirectories.length > 0 && {
          additionalDirectories: options.additionalDirectories,
        }),
        // 强制顺序执行工具，防止并发 tool_use 导致 400 错误
        // 根因：多个 tool_use 并发时若结果未完整批量提交会触发 invalid_request_error
        toolUseConcurrency: 1,
      } as import('@anthropic-ai/claude-agent-sdk').Options

      // 将初始 prompt 包装为 AsyncIterable<SDKUserMessage>，
      // 启用 SDK 的流式输入模式，使 Query.streamInput() 可用于后续队列消息注入。
      // 如果用 string prompt，SDK 以单次输入模式运行，streamInput() 不可用。
      async function* initialPromptStream(): AsyncGenerator<import('@anthropic-ai/claude-agent-sdk').SDKUserMessage> {
        yield {
          type: 'user' as const,
          session_id: options.sessionId,
          message: {
            role: 'user' as const,
            content: options.prompt,
          },
          parent_tool_use_id: null,
        }
      }

      const queryIterator = sdk.query({
        prompt: initialPromptStream(),
        options: sdkOptions,
      })

      // 保存 Query 引用，供队列消息注入使用
      activeQueries.set(options.sessionId, queryIterator)

      // 通知 Query 已就绪，解除 sendQueuedMessage 的等待
      const resolveReady = queryReadyResolvers.get(options.sessionId)
      if (resolveReady) {
        resolveReady()
        queryReadyResolvers.delete(options.sessionId)
      }

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

        // 捕获 result 中的 contextWindow
        if (msg.type === 'result') {
          const resultMsg = msg as { modelUsage?: Record<string, { contextWindow?: number }> }
          if (resultMsg.modelUsage) {
            const firstEntry = Object.values(resultMsg.modelUsage)[0]
            if (firstEntry?.contextWindow) {
              options.onContextWindow?.(firstEntry.contextWindow)
            }
          }
        }

        yield sdkMessage as SDKMessage
      }
    } finally {
      activeControllers.delete(options.sessionId)
      activeQueries.delete(options.sessionId)
      queryReadyPromises.delete(options.sessionId)
      queryReadyResolvers.delete(options.sessionId)
    }
  }

  /**
   * 向活跃查询注入队列消息
   *
   * 通过 SDK Query.streamInput() 方法在查询进行中注入用户消息。
   * 如果 SDK 尚未完成初始化，会自动等待（带超时保护）。
   */
  async sendQueuedMessage(sessionId: string, message: SDKUserMessageInput): Promise<void> {
    // 等待 Query 就绪（SDK init 可能需要几秒）
    const readyPromise = queryReadyPromises.get(sessionId)
    if (readyPromise) {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('[Claude 适配器] 等待 SDK 初始化超时，请稍后重试')), QUERY_READY_TIMEOUT_MS)
      )
      await Promise.race([readyPromise, timeoutPromise])
    }

    const query = activeQueries.get(sessionId)
    if (!query) {
      throw new Error(`[Claude 适配器] 无活跃查询可注入队列消息: ${sessionId}`)
    }
    // 构造单元素 AsyncIterable 注入消息
    async function* singleMessage() {
      yield message as import('@anthropic-ai/claude-agent-sdk').SDKUserMessage
    }
    await query.streamInput(singleMessage())
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
   * 典型场景：Plan 模式审批通过后切换到 bypassPermissions 或 acceptEdits。
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
