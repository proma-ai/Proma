/**
 * Claude Agent SDK 适配器
 *
 * 实现 AgentProviderAdapter 接口，将 Claude Agent SDK 的 SDKMessage 流
 * 翻译为 Proma 的 AgentEvent 流。所有 SDK 消息类型在此统一处理，
 * 不再有"一部分在这里翻译，一部分在外面翻译"的问题。
 */

import type {
  AgentEvent,
  AgentQueryInput,
  AgentProviderAdapter,
  TypedError,
  ErrorCode,
  ThinkingConfig,
  AgentEffort,
  AgentDefinition,
  SdkBeta,
  JsonSchemaOutputFormat,
} from '@proma/shared'
import {
  ToolIndex,
  extractToolStarts,
  extractToolResults,
  SUBAGENT_TOOL_NAMES,
  type ContentBlock,
} from '@proma/shared'
import type { CanUseToolOptions, PermissionResult } from '../agent-permission-service'

interface SDKAssistantMessage {
  type: 'assistant'
  message: {
    content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>
    usage?: { input_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
  parent_tool_use_id: string | null
  error?: { message: string; errorType?: string }
  isReplay?: boolean
}

interface SDKUserMessage {
  type: 'user'
  message?: { content?: unknown[] }
  parent_tool_use_id: string | null
  tool_use_result?: unknown
  isReplay?: boolean
}

interface SDKStreamEvent {
  type: 'stream_event'
  event: {
    type: string
    message?: { id?: string }
    delta?: { type: string; text?: string; stop_reason?: string }
    content_block?: { type: string; id: string; name: string; input?: Record<string, unknown> }
  }
  parent_tool_use_id: string | null
}

interface SDKResultMessage {
  type: 'result'
  subtype: 'success' | 'error'
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  total_cost_usd?: number
  modelUsage?: Record<string, { contextWindow?: number }>
  errors?: string[]
}

interface SDKToolProgressMessage {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds?: number
  /** Agent Teams: 所属 teammate 任务 ID */
  task_id?: string
}

type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKStreamEvent
  | SDKResultMessage
  | SDKToolProgressMessage
  | { type: string; parent_tool_use_id?: string | null; [key: string]: unknown }

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
  /** SDK 权限模式 */
  sdkPermissionMode: 'bypassPermissions' | 'default'
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
  /** 系统提示词 */
  systemPrompt: { type: 'preset'; preset: 'claude_code'; append: string }
  /** SDK session ID（用于 resume） */
  resumeSessionId?: string
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
// 错误映射（从 agent-service.ts 迁移）
// ============================================================================

function mapSDKErrorToTypedError(
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
    ],
    canRetry: mapped.canRetry,
    retryDelayMs: mapped.canRetry ? 1000 : undefined,
    originalError,
  }
}

// ============================================================================
// ClaudeAgentAdapter
// ============================================================================

/** 活跃的 AbortController 映射（sessionId → controller） */
const activeControllers = new Map<string, AbortController>()

export class ClaudeAgentAdapter implements AgentProviderAdapter {

  abort(sessionId: string): void {
    const controller = activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      activeControllers.delete(sessionId)
    }
  }

  dispose(): void {
    for (const [, controller] of activeControllers) {
      controller.abort()
    }
    activeControllers.clear()
  }

  /**
   * 翻译单条 SDK 消息为 AgentEvent 列表
   *
   * 统一处理所有 SDK 消息类型，包括之前散落在 runAgent 循环中的
   * system、prompt_suggestion、usage_update 逻辑。
   */
  private translateMessage(
    message: SDKMessage,
    toolIndex: ToolIndex,
    emittedToolStarts: Set<string>,
    activeParentTools: Set<string>,
    pendingText: { value: string | null },
    pendingParentToolUseId: { value: string | null },
    turnId: { value: string | null },
    cachedContextWindow: { value: number | undefined },
  ): AgentEvent[] {
    const events: AgentEvent[] = []

    switch (message.type) {
      case 'assistant': {
        const msg = message as SDKAssistantMessage

        // SDK 级别错误（如 authentication_failed）
        if (msg.error) {
          const { detailedMessage, originalError } = this.extractErrorDetails(msg)
          const errorCode = msg.error.errorType || 'unknown_error'
          const typedError = mapSDKErrorToTypedError(errorCode, detailedMessage, originalError)
          events.push({ type: 'typed_error', error: typedError })
          break
        }

        if (msg.isReplay) break

        // 主链 usage 追踪（之前在 runAgent 循环中直接处理）
        if (!msg.parent_tool_use_id && msg.message.usage) {
          const u = msg.message.usage
          const inputTokens = u.input_tokens
            + (u.cache_read_input_tokens ?? 0)
            + (u.cache_creation_input_tokens ?? 0)
          events.push({
            type: 'usage_update',
            usage: { inputTokens, contextWindow: cachedContextWindow.value },
          })
        }

        // 工具启动事件提取
        const content = msg.message.content
        const toolStartEvents = extractToolStarts(
          content as ContentBlock[],
          msg.parent_tool_use_id,
          toolIndex,
          emittedToolStarts,
          turnId.value || undefined,
          activeParentTools,
        )
        for (const evt of toolStartEvents) {
          if (evt.type === 'tool_start' && SUBAGENT_TOOL_NAMES.has(evt.toolName)) {
            activeParentTools.add(evt.toolUseId)
          }
        }
        events.push(...toolStartEvents)

        // 文本累积
        let textContent = ''
        for (const block of content) {
          if (block.type === 'text' && 'text' in block) {
            textContent += block.text
          }
        }
        if (textContent) {
          pendingText.value = textContent
          pendingParentToolUseId.value = msg.parent_tool_use_id || null
        }
        break
      }

      case 'stream_event':
        this.translateStreamEvent(message as SDKStreamEvent, events, toolIndex, emittedToolStarts, activeParentTools, pendingText, pendingParentToolUseId, turnId)
        break

      case 'user':
        this.translateUserMessage(message as SDKUserMessage, events, toolIndex, activeParentTools, turnId)
        break

      case 'tool_progress':
        this.translateToolProgress(message as SDKToolProgressMessage, events, toolIndex, emittedToolStarts, activeParentTools, turnId)
        break

      case 'result':
        this.translateResult(message as SDKResultMessage, events, cachedContextWindow)
        break

      case 'system':
        this.translateSystem(message, events, turnId)
        break

      case 'prompt_suggestion':
        this.translatePromptSuggestion(message, events)
        break

      case 'tool_use_summary': {
        const summaryMsg = message as { type: 'tool_use_summary'; summary?: string; preceding_tool_use_ids?: string[] }
        if (summaryMsg.summary) {
          events.push({
            type: 'tool_use_summary',
            summary: summaryMsg.summary,
            precedingToolUseIds: summaryMsg.preceding_tool_use_ids ?? [],
          })
        }
        break
      }

      default:
        console.log(`[ClaudeAgentAdapter] 忽略消息类型: ${message.type}`)
        break
    }

    return events
  }

  private translateStreamEvent(
    msg: SDKStreamEvent,
    events: AgentEvent[],
    toolIndex: ToolIndex,
    emittedToolStarts: Set<string>,
    activeParentTools: Set<string>,
    pendingText: { value: string | null },
    pendingParentToolUseId: { value: string | null },
    turnId: { value: string | null },
  ): void {
    const streamEvent = msg.event

    // 捕获 turn ID
    if (streamEvent.type === 'message_start' && streamEvent.message?.id) {
      turnId.value = streamEvent.message.id
    }

    // message_delta 包含 stop_reason — 刷新 pending 文本
    if (streamEvent.type === 'message_delta') {
      const stopReason = streamEvent.delta?.stop_reason
      if (pendingText.value) {
        events.push({
          type: 'text_complete',
          text: pendingText.value,
          isIntermediate: stopReason === 'tool_use',
          turnId: turnId.value || undefined,
          parentToolUseId: msg.parent_tool_use_id || undefined,
        })
        pendingText.value = null
        pendingParentToolUseId.value = null
      }
    }

    // 流式文本增量
    if (streamEvent.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta') {
      events.push({
        type: 'text_delta',
        text: streamEvent.delta.text || '',
        turnId: turnId.value || undefined,
        parentToolUseId: msg.parent_tool_use_id || undefined,
      })
    }

    // 流式工具启动
    if (streamEvent.type === 'content_block_start' && streamEvent.content_block?.type === 'tool_use') {
      const toolBlock = streamEvent.content_block
      const streamBlocks: ContentBlock[] = [{
        type: 'tool_use' as const,
        id: toolBlock.id,
        name: toolBlock.name,
        input: (toolBlock.input ?? {}) as Record<string, unknown>,
      }]
      const streamEvents = extractToolStarts(
        streamBlocks, msg.parent_tool_use_id, toolIndex,
        emittedToolStarts, turnId.value || undefined, activeParentTools,
      )
      for (const evt of streamEvents) {
        if (evt.type === 'tool_start' && SUBAGENT_TOOL_NAMES.has(evt.toolName)) {
          activeParentTools.add(evt.toolUseId)
        }
      }
      events.push(...streamEvents)
    }
  }

  private translateUserMessage(
    msg: SDKUserMessage,
    events: AgentEvent[],
    toolIndex: ToolIndex,
    activeParentTools: Set<string>,
    turnId: { value: string | null },
  ): void {
    if (msg.isReplay) return

    if (msg.tool_use_result !== undefined || msg.message) {
      const msgContent = msg.message
        ? ((msg.message as { content?: unknown[] }).content ?? [])
        : []
      const contentBlocks = (Array.isArray(msgContent) ? msgContent : []) as ContentBlock[]

      const resultEvents = extractToolResults(
        contentBlocks, msg.parent_tool_use_id,
        msg.tool_use_result, toolIndex, turnId.value || undefined,
      )
      for (const evt of resultEvents) {
        if (evt.type === 'tool_result' && evt.toolName && SUBAGENT_TOOL_NAMES.has(evt.toolName)) {
          activeParentTools.delete(evt.toolUseId)
        }
      }
      events.push(...resultEvents)
    }
  }

  private translateToolProgress(
    msg: SDKToolProgressMessage,
    events: AgentEvent[],
    toolIndex: ToolIndex,
    emittedToolStarts: Set<string>,
    activeParentTools: Set<string>,
    turnId: { value: string | null },
  ): void {
    if (msg.elapsed_time_seconds !== undefined) {
      events.push({
        type: 'task_progress',
        toolUseId: msg.parent_tool_use_id || msg.tool_use_id,
        elapsedSeconds: msg.elapsed_time_seconds,
        turnId: turnId.value || undefined,
        // Agent Teams: 透传 taskId 和 toolName（区分 teammate 内的工具进度 vs 普通工具计时）
        ...(msg.task_id && { taskId: msg.task_id, lastToolName: msg.tool_name }),
      })
    }

    // 如果还没见过这个工具，发出 tool_start
    if (!emittedToolStarts.has(msg.tool_use_id)) {
      const progressBlocks: ContentBlock[] = [{
        type: 'tool_use' as const,
        id: msg.tool_use_id,
        name: msg.tool_name,
        input: {},
      }]
      const progressEvents = extractToolStarts(
        progressBlocks, msg.parent_tool_use_id, toolIndex,
        emittedToolStarts, turnId.value || undefined, activeParentTools,
      )
      for (const evt of progressEvents) {
        if (evt.type === 'tool_start' && SUBAGENT_TOOL_NAMES.has(evt.toolName)) {
          activeParentTools.add(evt.toolUseId)
        }
      }
      events.push(...progressEvents)
    }
  }

  private translateResult(
    msg: SDKResultMessage,
    events: AgentEvent[],
    cachedContextWindow: { value: number | undefined },
  ): void {
    const modelUsageEntries = Object.values(msg.modelUsage || {})
    const primaryModelUsage = modelUsageEntries[0]

    // 缓存 contextWindow
    if (primaryModelUsage?.contextWindow) {
      cachedContextWindow.value = primaryModelUsage.contextWindow
    }

    const usage = {
      inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
      outputTokens: msg.usage.output_tokens,
      costUsd: msg.total_cost_usd,
      contextWindow: primaryModelUsage?.contextWindow,
    }

    if (msg.subtype === 'success') {
      events.push({ type: 'complete', usage })
    } else {
      const errorMsg = msg.errors ? msg.errors.join(', ') : 'Agent 查询失败'
      events.push({ type: 'error', message: errorMsg })
      events.push({ type: 'complete', usage })
    }
  }

  /** 翻译 system 类型消息（之前在 runAgent 循环中直接处理） */
  private translateSystem(
    message: SDKMessage,
    events: AgentEvent[],
    turnId: { value: string | null },
  ): void {
    const msg = message as {
      type: 'system'; subtype?: string; status?: string
      task_id?: string; tool_use_id?: string; description?: string; task_type?: string
      // Agent Teams: task_progress 扩展字段
      last_tool_name?: string; usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
      // Agent Teams: task_notification 扩展字段
      summary?: string; output_file?: string
    }

    if (msg.subtype === 'compact_boundary') {
      events.push({ type: 'compact_complete' })
    } else if (msg.subtype === 'status' && msg.status === 'compacting') {
      events.push({ type: 'compacting' })
    } else if (msg.subtype === 'task_started' && msg.task_id) {
      events.push({
        type: 'task_started',
        taskId: msg.task_id,
        toolUseId: msg.tool_use_id,
        description: msg.description || `Task ${msg.task_id}`,
        taskType: msg.task_type,
        turnId: turnId.value || undefined,
      })
    } else if (msg.subtype === 'task_progress' && msg.task_id) {
      // Agent Teams: teammate 任务进度（区别于 tool_progress 的计时事件）
      events.push({
        type: 'task_progress',
        taskId: msg.task_id,
        toolUseId: msg.tool_use_id || msg.task_id,
        // 不设 elapsedSeconds — system task_progress 无真实计时，避免覆盖 tool_progress 的值
        description: msg.description,
        lastToolName: msg.last_tool_name,
        usage: msg.usage ? {
          totalTokens: msg.usage.total_tokens ?? 0,
          toolUses: msg.usage.tool_uses ?? 0,
          durationMs: msg.usage.duration_ms ?? 0,
        } : undefined,
        turnId: turnId.value || undefined,
      })
    } else if (msg.subtype === 'task_notification' && msg.task_id) {
      // Agent Teams: teammate 任务完成/失败/停止
      events.push({
        type: 'task_notification',
        taskId: msg.task_id,
        toolUseId: msg.tool_use_id,
        status: (msg.status as 'completed' | 'failed' | 'stopped') || 'completed',
        summary: msg.summary || '',
        outputFile: msg.output_file,
        usage: msg.usage ? {
          totalTokens: msg.usage.total_tokens ?? 0,
          toolUses: msg.usage.tool_uses ?? 0,
          durationMs: msg.usage.duration_ms ?? 0,
        } : undefined,
        turnId: turnId.value || undefined,
      })
    }
  }

  /** 翻译 prompt_suggestion 消息（之前在 runAgent 循环中直接处理） */
  private translatePromptSuggestion(message: SDKMessage, events: AgentEvent[]): void {
    const msg = message as { type: 'prompt_suggestion'; suggestion?: string }
    if (msg.suggestion) {
      events.push({ type: 'prompt_suggestion', suggestion: msg.suggestion })
    }
  }

  /** 从 assistant 错误消息中提取详细信息 */
  private extractErrorDetails(msg: SDKAssistantMessage): { detailedMessage: string; originalError: string } {
    let detailedMessage = msg.error!.message
    let originalError = msg.error!.message

    try {
      const content = msg.message?.content
      if (Array.isArray(content) && content.length > 0) {
        const textBlock = content.find((block: Record<string, unknown>) => block.type === 'text')
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

  /**
   * 发起查询，返回 AgentEvent 异步迭代流
   *
   * 内部完成：SDK 加载 → query 创建 → 消息遍历 → 翻译为 AgentEvent
   * 外部只需遍历返回的 AsyncIterable，无需了解 SDK 细节。
   */
  async *query(input: AgentQueryInput): AsyncIterable<AgentEvent> {
    const options = input as ClaudeAgentQueryOptions

    // 创建 AbortController
    const controller = new AbortController()
    activeControllers.set(options.sessionId, controller)

    // 查询级私有状态（不再暴露给外部）
    const toolIndex = new ToolIndex()
    const emittedToolStarts = new Set<string>()
    const activeParentTools = new Set<string>()
    const pendingText = { value: null as string | null }
    const pendingParentToolUseId = { value: null as string | null }
    const turnId = { value: null as string | null }
    const cachedContextWindow = { value: undefined as number | undefined }

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
        includePartialMessages: true,
        promptSuggestions: true,
        cwd: options.cwd,
        abortController: controller,
        env: options.env,
        systemPrompt: options.systemPrompt,
        // 不加载 user 级别的 ~/.claude/settings.json，防止其中的 env 字段
        // （如 ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL）覆盖我们注入的凭证。
        // 保留 project 级别以支持 CLAUDE.md 加载。
        settingSources: ['project'],

        // 条件字段
        ...(options.canUseTool && { canUseTool: options.canUseTool }),
        ...(options.allowedTools && { allowedTools: options.allowedTools }),
        ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
        ...(options.mcpServers && Object.keys(options.mcpServers).length > 0 && {
          mcpServers: options.mcpServers as Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig>,
        }),
        ...(options.plugins && { plugins: options.plugins }),
        ...(options.onStderr && { stderr: options.onStderr }),

        // ===== SDK 0.2.52+ 新增选项透传 =====
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
      } as import('@anthropic-ai/claude-agent-sdk').Options

      const queryIterator = sdk.query({
        prompt: options.prompt,
        options: sdkOptions,
      })

      for await (const sdkMessage of queryIterator) {
        if (controller.signal.aborted) break

        const msg = sdkMessage as SDKMessage

        // 捕获 SDK session_id
        if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
          options.onSessionId?.(msg.session_id as string)
        }

        // 捕获 system init 中的模型确认
        if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
          const initMsg = msg as { model?: string }
          if (typeof initMsg.model === 'string') {
            options.onModelResolved?.(initMsg.model)
          }
        }

        // 统一翻译
        const events = this.translateMessage(
          msg, toolIndex, emittedToolStarts,
          activeParentTools, pendingText, pendingParentToolUseId, turnId, cachedContextWindow,
        )

        // 上下文窗口回调
        if (cachedContextWindow.value !== undefined) {
          options.onContextWindow?.(cachedContextWindow.value)
        }

        for (const event of events) {
          yield event
        }
      }

      // 流结束时刷新 pendingText（修复静默丢弃问题）
      if (pendingText.value) {
        yield {
          type: 'text_complete' as const,
          text: pendingText.value,
          isIntermediate: false,
          turnId: turnId.value || undefined,
          parentToolUseId: pendingParentToolUseId.value || undefined,
        }
      }
    } finally {
      activeControllers.delete(options.sessionId)
    }
  }
}
