/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，负责：
 * - 并发守卫（同一会话不允许并行请求）
 * - 渠道查找 + API Key 解密
 * - 环境变量构建 + SDK 路径解析
 * - 用户/助手消息持久化
 * - 事件流遍历 + 文本累积 + 事件持久化
 * - 错误处理 + 部分内容保存
 * - 自动标题生成
 *
 * 通过 EventBus 分发 AgentEvent，通过 SessionCallbacks 发送控制信号，
 * 完全解耦 Electron IPC，可独立测试（mock Adapter + EventBus）。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { app, BrowserWindow } from 'electron'
import type { AgentSendInput, AgentEvent, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, TypedError, RetryAttempt } from '@proma/shared'
import { SAFE_TOOLS, CLOUD_IPC_CHANNELS } from '@proma/shared'
import type { PermissionRequest, PromaPermissionMode, AskUserRequest } from '@proma/shared'
import type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById, listChannels } from './channel-manager'
import { getSystemApiKey, clearSystemKeyCache } from './cloud-channel-service'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { getAdapter, fetchTitle } from '@proma/core'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendAgentMessage, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest, getWorkspacePermissionMode } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath } from './config-paths'
import { getRuntimeStatus } from './runtime-init'
import { getSettings } from './settings-service'
import { buildSystemPromptAppend, buildDynamicContext } from './agent-prompt-builder'
import { permissionService } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { getMemoryConfig } from './memory-service'
import { searchMemory, addMemory, formatSearchResult } from './memos-client'
import {
  findTeamLeadInboxPath,
  pollInboxWithRetry,
  markInboxAsRead,
  formatInboxPrompt,
  formatSummaryFallbackPrompt,
  areAllWorkersIdle,
  INBOX_RETRY_CONFIG,
  type TaskNotificationSummary,
} from './agent-team-reader'

// ===== 类型定义 =====

/**
 * 会话控制信号回调
 *
 * 解耦 Electron webContents，使 Orchestrator 可独立测试。
 * agent-service.ts 负责将这些回调绑定到 webContents.send()。
 */
export interface SessionCallbacks {
  /** 发送流式错误 */
  onError: (error: string) => void
  /** 发送流式完成（携带已持久化的消息列表） */
  onComplete: (messages?: AgentMessage[]) => void
  /** 发送标题更新 */
  onTitleUpdated: (title: string) => void
}

// ===== 工具函数 =====

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}"
  const jsonMatch = stderr.match(/(\d{3})\s+(\{[^}]*"error"[^}]*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败，继续尝试其他模式
    }
  }

  // 模式 2：API error 格式 - "API error (attempt X/Y): 401 401 {...}"
  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*?\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败
    }
  }

  // 模式 3：直接的状态码 + 消息
  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',      // overloaded 映射为 provider_error
  'service_error',
  'service_unavailable',
  'network_error',
])

/** 判断 typed_error 事件是否可自动重试 */
function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式） */
function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
): boolean {
  if (apiError) {
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  return false
}

/** 最大自动重试次数 */
const MAX_AUTO_RETRIES = 3

/** 计算重试延迟（指数退避：1s, 2s, 4s） */
function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000)
}

/**
 * 可中断的定时器
 *
 * 等待指定毫秒，如果 signal 被中止则立即 resolve。
 */
function timerWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const tid = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(tid); resolve() }, { once: true })
  })
}

/**
 * 解析 SDK cli.js 路径
 *
 * SDK 作为 esbuild external 依赖，require.resolve 可在运行时解析实际路径。
 * 多种策略降级：createRequire → 全局 require → node_modules 手动查找
 *
 * 打包环境下：asar 内的路径需要转换为 asar.unpacked 路径，
 * 因为子进程 (bun) 无法读取 asar 归档内的文件。
 */
function resolveSDKCliPath(): string {
  let cliPath: string | null = null

  // 策略 1：createRequire（标准 ESM/CJS 互操作）
  try {
    const cjsRequire = createRequire(__filename)
    const sdkEntryPath = cjsRequire.resolve('@anthropic-ai/claude-agent-sdk')
    cliPath = join(dirname(sdkEntryPath), 'cli.js')
    console.log(`[Agent 编排] SDK CLI 路径 (createRequire): ${cliPath}`)
  } catch (e) {
    console.warn('[Agent 编排] createRequire 解析 SDK 路径失败:', e)
  }

  // 策略 2：全局 require（esbuild CJS bundle 可能保留）
  if (!cliPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdkEntryPath = require.resolve('@anthropic-ai/claude-agent-sdk')
      cliPath = join(dirname(sdkEntryPath), 'cli.js')
      console.log(`[Agent 编排] SDK CLI 路径 (require.resolve): ${cliPath}`)
    } catch (e) {
      console.warn('[Agent 编排] require.resolve 解析 SDK 路径失败:', e)
    }
  }

  // 策略 3：从项目根目录手动查找
  if (!cliPath) {
    cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    console.log(`[Agent 编排] SDK CLI 路径 (手动): ${cliPath}`)
  }

  // 打包环境：将 .asar/ 路径转换为 .asar.unpacked/
  if (app.isPackaged && cliPath.includes('.asar')) {
    cliPath = cliPath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
    console.log(`[Agent 编排] 转换为 asar.unpacked 路径: ${cliPath}`)
  }

  return cliPath
}

/**
 * 获取 Agent SDK 运行时可执行文件
 *
 * 优先级：Node.js → Bun → 降级到字符串 'node'
 */
function getAgentExecutable(): { type: 'node' | 'bun'; path: string } {
  const status = getRuntimeStatus()

  if (status?.node?.available && status.node.path) {
    return { type: 'node', path: status.node.path }
  }

  if (status?.bun?.available && status.bun.path) {
    return { type: 'bun', path: status.bun.path }
  }

  return { type: 'node', path: 'node' }
}

/**
 * 确保打包环境下 ripgrep 可被 SDK CLI 找到
 *
 * 通过 symlink 桥接 extraResources → SDK 的 vendor 目录。
 */
function ensureRipgrepAvailable(cliPath: string): void {
  if (!app.isPackaged) return

  try {
    const sdkDir = dirname(cliPath)
    const arch = process.arch
    const platform = process.platform
    const expectedDir = join(sdkDir, 'vendor', 'ripgrep', `${arch}-${platform}`)
    const resourcesRipgrep = join(process.resourcesPath, 'vendor', 'ripgrep')

    if (existsSync(expectedDir)) return

    if (!existsSync(resourcesRipgrep)) {
      console.warn(`[Agent 编排] ripgrep 资源不存在: ${resourcesRipgrep}`)
      return
    }

    mkdirSync(join(sdkDir, 'vendor', 'ripgrep'), { recursive: true })
    symlinkSync(resourcesRipgrep, expectedDir, 'junction')
    console.log(`[Agent 编排] ripgrep symlink 创建成功: ${expectedDir} → ${resourcesRipgrep}`)
  } catch (error) {
    console.warn('[Agent 编排] ripgrep symlink 创建失败:', error)
  }
}

/** 最大回填消息条数 */
const MAX_CONTEXT_MESSAGES = 20

/**
 * 构建带历史上下文的 prompt
 *
 * 当 resume 不可用时，将最近消息拼接为上下文注入 prompt，
 * 让新 SDK 会话保留对话记忆。仅取 user/assistant 角色的文本内容。
 */
function buildContextPrompt(sessionId: string, currentUserMessage: string): string {
  const allMessages = getAgentSessionMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => `[${m.role}]: ${m.content}`)

  if (lines.length === 0) return currentUserMessage

  return `<conversation_history>\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}

/** 标题生成 Prompt */
const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。\n\n用户消息：'

/** 标题最大长度 */
const MAX_TITLE_LENGTH = 20

/** 默认会话标题（用于判断是否需要自动生成） */
const DEFAULT_SESSION_TITLE = '新 Agent 会话'

/** Proma 官方渠道标题生成专用模型（轻量、快速、低成本） */
const PROMA_TITLE_MODEL = 'openai/gpt-oss-120b'

/** 默认模型 ID */
const DEFAULT_MODEL_ID = 'claude-sonnet-4-5-20250929'

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private activeSessions = new Set<string>()

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  /**
   * 构建 SDK 环境变量
   *
   * 注入 API Key、Base URL、代理、Shell 配置等。
   */
  private async buildSdkEnv(
    apiKey: string,
    baseUrl: string | undefined,
    useAuthToken = false,
  ): Promise<Record<string, string | undefined>> {
    const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'

    // 从 process.env 继承系统变量，但清理所有 ANTHROPIC_ 前缀的变量，
    // 防止本地开发环境（如 ANTHROPIC_AUTH_TOKEN、ANTHROPIC_API_KEY、
    // ANTHROPIC_BASE_URL 等）干扰 SDK 的认证和请求目标。
    // 即使 index.ts 启动时已清理过一次，initializeRuntime() 中的
    // loadShellEnv() 可能从 shell 配置文件（~/.zshrc 等）重新注入这些变量。
    const cleanEnv: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('ANTHROPIC_')) {
        cleanEnv[key] = value
      }
    }

    const sdkEnv: Record<string, string | undefined> = {
      ...cleanEnv,
      // 注入认证凭证：Proma 官方渠道使用 AUTH_TOKEN（Bearer），其他渠道使用 API_KEY（x-api-key）
      ...(useAuthToken
        ? { ANTHROPIC_AUTH_TOKEN: apiKey }
        : { ANTHROPIC_API_KEY: apiKey }
      ),
      // 提升输出 token 上限，避免 "exceeded 32000 output token maximum" 错误
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
      // 启用 Agent Teams（实验性多 Agent 协作）
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      // 启用 Tasks 功能
      CLAUDE_CODE_ENABLE_TASKS: 'true',
    }

    // 显式控制 ANTHROPIC_BASE_URL：仅在用户配置了自定义 Base URL 时注入
    if (baseUrl && baseUrl !== DEFAULT_ANTHROPIC_URL) {
      sdkEnv.ANTHROPIC_BASE_URL = baseUrl
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/v\d+\/messages$/, '')
        .replace(/\/v\d+$/, '')
    }

    const proxyUrl = await getEffectiveProxyUrl()
    if (proxyUrl) {
      sdkEnv.HTTPS_PROXY = proxyUrl
      sdkEnv.HTTP_PROXY = proxyUrl
    }

    // Windows 平台：配置 Shell 环境
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus) {
        if (shellStatus.gitBash?.available && shellStatus.gitBash.path) {
          sdkEnv.CLAUDE_CODE_SHELL = shellStatus.gitBash.path
          console.log(`[Agent 编排] 配置 Shell 环境: Git Bash (${shellStatus.gitBash.path})`)
        } else if (shellStatus.wsl?.available) {
          sdkEnv.CLAUDE_CODE_SHELL = 'wsl'
          console.log(`[Agent 编排] 配置 Shell 环境: WSL ${shellStatus.wsl.version} (${shellStatus.wsl.defaultDistro})`)
        } else {
          console.warn('[Agent 编排] Windows 平台未检测到可用的 Shell 环境（Git Bash / WSL）')
        }
        sdkEnv.CLAUDE_BASH_NO_LOGIN = '1'
      }
    }

    return sdkEnv
  }

  /**
   * 构建工作区 MCP 服务器配置
   */
  private buildMcpServers(workspaceSlug: string | undefined): Record<string, Record<string, unknown>> {
    const mcpServers: Record<string, Record<string, unknown>> = {}
    if (!workspaceSlug) return mcpServers

    const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
    for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
      if (!entry.enabled) continue
      if (name === 'memos-cloud') continue

      if (entry.type === 'stdio' && entry.command) {
        const mergedEnv: Record<string, string> = {
          ...(process.env.PATH && { PATH: process.env.PATH }),
          ...entry.env,
        }
        mcpServers[name] = {
          type: 'stdio',
          command: entry.command,
          ...(entry.args && entry.args.length > 0 && { args: entry.args }),
          ...(Object.keys(mergedEnv).length > 0 && { env: mergedEnv }),
          required: false,
          startup_timeout_sec: entry.timeout ?? 30,
        }
      } else if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
        mcpServers[name] = {
          type: entry.type,
          url: entry.url,
          ...(entry.headers && Object.keys(entry.headers).length > 0 && { headers: entry.headers }),
          required: false,
        }
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
    }

    return mcpServers
  }

  /**
   * 注入 SDK 内置记忆工具（全局，不依赖工作区）
   */
  private async injectMemoryTools(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
    mcpServers: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const memoryConfig = getMemoryConfig()
    const memUserId = memoryConfig.userId?.trim() || 'proma-user'
    if (!memoryConfig.enabled || !memoryConfig.apiKey) return

    try {
      const { z } = await import('zod')
      const memosServer = sdk.createSdkMcpServer({
        name: 'mem',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'recall_memory',
            'Search user memories (facts and preferences) from MemOS Cloud. Use this to recall relevant context about the user.',
            { query: z.string().describe('Search query for memory retrieval'), limit: z.number().optional().describe('Max results (default 6)') },
            async (args) => {
              const result = await searchMemory(
                { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
                args.query,
                args.limit,
              )
              return { content: [{ type: 'text' as const, text: formatSearchResult(result) }] }
            },
            { annotations: { readOnlyHint: true } },
          ),
          sdk.tool(
            'add_memory',
            'Store a conversation message pair into MemOS Cloud for long-term memory. Call this after meaningful exchanges worth remembering.',
            {
              userMessage: z.string().describe('The user message to store'),
              assistantMessage: z.string().optional().describe('The assistant response to store'),
              conversationId: z.string().optional().describe('Conversation ID for grouping'),
              tags: z.array(z.string()).optional().describe('Tags for categorization'),
            },
            async (args) => {
              await addMemory(
                { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
                args,
              )
              return { content: [{ type: 'text' as const, text: 'Memory stored successfully.' }] }
            },
          ),
        ],
      })
      mcpServers['mem'] = memosServer as unknown as Record<string, unknown>
      console.log(`[Agent 编排] 已注入内置记忆工具 (mem)`)
    } catch (err) {
      console.error(`[Agent 编排] 注入记忆工具失败:`, err)
    }
  }

  /**
   * 生成 Agent 会话标题
   *
   * 使用 Provider 适配器系统，支持所有渠道。任何错误返回 null。
   */
  async generateTitle(input: AgentGenerateTitleInput): Promise<string | null> {
    const { userMessage, channelId, modelId } = input
    console.log('[Agent 标题生成] 开始生成标题:', { channelId, modelId, userMessage: userMessage.slice(0, 50) })

    try {
      const channels = listChannels()
      const channel = channels.find((c) => c.id === channelId)
      if (!channel) {
        console.warn('[Agent 标题生成] 渠道不存在:', channelId)
        return null
      }

      let apiKey: string
      let baseUrl: string
      if (channel.provider === 'proma') {
        // Proma 官方渠道：使用缓存的 auth token（同步，轻量）
        const token = getAuthToken()
        if (!token) {
          console.warn('[Agent 标题生成] 未找到 Proma auth token，请检查登录状态')
          return null
        }
        apiKey = token
        baseUrl = getCloudApiConfig().baseUrl
      } else {
        apiKey = decryptApiKey(channelId)
        baseUrl = channel.baseUrl
      }

      // Proma 官方渠道使用轻量 Chat 模型（快速且低成本）
      const titleModelId = channel.provider === 'proma' ? PROMA_TITLE_MODEL : modelId

      const providerAdapter = getAdapter(channel.provider)
      const proxyUrl = await getEffectiveProxyUrl()
      const fetchFn = getFetchFn(proxyUrl)

      const doFetch = async (key: string): Promise<string | null> => {
        const request = providerAdapter.buildTitleRequest({
          baseUrl,
          apiKey: key,
          modelId: titleModelId,
          prompt: TITLE_PROMPT + userMessage,
        })
        return fetchTitle(request, providerAdapter, fetchFn)
      }

      let title = await doFetch(apiKey)

      // Proma 渠道：token 过期时尝试刷新后重试一次
      if (!title && channel.provider === 'proma') {
        const newToken = await tryRefreshAuthToken()
        if (newToken) {
          console.log('[Agent 标题生成] Token 已刷新，重试...')
          title = await doFetch(newToken)
        }
      }

      if (!title) {
        console.warn('[Agent 标题生成] API 返回空标题')
        return null
      }

      const cleaned = title.trim().replace(/^["'""''「《]+|["'""''」》]+$/g, '').trim()
      const result = cleaned.slice(0, MAX_TITLE_LENGTH) || null

      console.log(`[Agent 标题生成] 生成标题成功: "${result}"`)
      return result
    } catch (error) {
      console.warn('[Agent 标题生成] 生成失败:', error)
      return null
    }
  }

  /**
   * 流完成后自动生成标题
   *
   * 如果会话标题仍为默认值，自动调用标题生成并通过回调通知。
   */
  private async autoGenerateTitle(
    sessionId: string,
    userMessage: string,
    channelId: string,
    modelId: string,
    callbacks: SessionCallbacks,
  ): Promise<void> {
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (!meta || meta.title !== DEFAULT_SESSION_TITLE) return

      const title = await this.generateTitle({ userMessage, channelId, modelId })
      if (!title) return

      updateAgentSessionMeta(sessionId, { title })
      callbacks.onTitleUpdated(title)
      console.log(`[Agent 编排] 自动标题生成完成: "${title}"`)
    } catch (error) {
      console.warn('[Agent 编排] 自动标题生成失败:', error)
    }
  }

  /**
   * 持久化助手消息（累积的文本 + 事件）
   */
  private persistAssistantMessage(
    sessionId: string,
    accumulatedText: string,
    accumulatedEvents: AgentEvent[],
    resolvedModel: string,
  ): void {
    if (!accumulatedText && accumulatedEvents.length === 0) return

    const assistantMsg: AgentMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: accumulatedText,
      createdAt: Date.now(),
      model: resolvedModel,
      events: accumulatedEvents,
    }
    appendAgentMessage(sessionId, assistantMsg)
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const { sessionId, userMessage, channelId, modelId, workspaceId, additionalDirectories } = input
    const stderrChunks: string[] = []

    // 0. 并发保护
    if (this.activeSessions.has(sessionId)) {
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      return
    }

    // 1. Windows 平台：检查 Shell 环境可用性
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
        const errorMsg = `Windows 平台需要 Git Bash 或 WSL 环境才能运行 Agent。

当前状态：
- Git Bash: ${shellStatus.gitBash?.error || '未检测到'}
- WSL: ${shellStatus.wsl?.error || '未检测到'}

解决方案：
1. 安装 Git for Windows（推荐）: https://git-scm.com/download/win
2. 或启用 WSL: https://learn.microsoft.com/zh-cn/windows/wsl/install

安装完成后请重启应用。`

        callbacks.onError(errorMsg)
        return
      }
    }

    // 2. 获取渠道信息并解密 API Key
    const channel = getChannelById(channelId)
    if (!channel) {
      callbacks.onError('渠道不存在')
      return
    }

    let apiKey: string
    if (channel.provider === 'proma') {
      // Proma 官方渠道：使用系统 API Key（由 Cloud 服务管理）
      try {
        apiKey = await getSystemApiKey()
      } catch {
        // token 可能过期，尝试刷新后重试一次
        const newToken = await tryRefreshAuthToken()
        if (newToken) {
          try {
            clearSystemKeyCache()
            apiKey = await getSystemApiKey()
            console.log('[Agent 编排] Token 已刷新，System API Key 重新获取成功')
          } catch {
            callbacks.onError('获取 Proma 官方渠道 API Key 失败，请检查登录状态')
            return
          }
        } else {
          callbacks.onError('登录已过期，请重新登录')
          return
        }
      }
    } else {
      try {
        apiKey = decryptApiKey(channelId)
      } catch {
        callbacks.onError('解密 API Key 失败')
        return
      }
    }

    // 3. 构建环境变量（Proma 官方渠道使用 Cloud API 根 URL）
    // getCloudApiConfig().baseUrl 形如 https://api.proma.cool/api/v1
    // 需去掉 /api/v1 得到根 URL，SDK 子进程会自动拼接 /v1/messages
    const sdkBaseUrl = channel.provider === 'proma'
      ? getCloudApiConfig().baseUrl.replace(/\/api\/v\d+\/?$/, '')
      : channel.baseUrl
    // 同步凭证到 process.env（SDK in-process 代码可能直接读取 process.env）
    // 参考 craft-agents-oss: 先清理再注入，确保 SDK 无论从 env 选项还是 process.env 都拿到正确值
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    if (channel.provider === 'proma') {
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey
    } else {
      process.env.ANTHROPIC_API_KEY = apiKey
    }
    if (sdkBaseUrl) {
      process.env.ANTHROPIC_BASE_URL = sdkBaseUrl
    }

    const sdkEnv = await this.buildSdkEnv(apiKey, sdkBaseUrl, channel.provider === 'proma')

    // 诊断日志：记录关键认证参数
    if (channel.provider === 'proma') {
      const keyPrefix = apiKey.slice(0, 8)
      const resolvedBaseUrl = sdkEnv.ANTHROPIC_BASE_URL || '(未设置，使用默认)'
      console.log(`[Agent 编排] Proma 认证参数: key=${keyPrefix}..., baseUrl=${resolvedBaseUrl}, authMethod=AUTH_TOKEN`)
    }

    // 4. 读取已有的 SDK session ID（用于 resume）
    const sessionMeta = getAgentSessionMeta(sessionId)
    let existingSdkSessionId = sessionMeta?.sdkSessionId
    console.log(`[Agent 编排] 会话 resume 状态: sdkSessionId=${existingSdkSessionId || '无'}`)

    // 5. 持久化用户消息
    const userMsg: AgentMessage = {
      id: randomUUID(),
      role: 'user',
      content: userMessage,
      createdAt: Date.now(),
    }
    appendAgentMessage(sessionId, userMsg)

    // 6. 注册活跃会话
    this.activeSessions.add(sessionId)

    // 7. 状态初始化
    let accumulatedText = ''
    const accumulatedEvents: AgentEvent[] = []
    let resolvedModel = modelId || DEFAULT_MODEL_ID
    let agentExec: { type: 'node' | 'bun'; path: string } | undefined
    let agentCwd: string | undefined
    let workspaceSlug: string | undefined
    let workspace: import('@proma/shared').AgentWorkspace | undefined

    try {
      // 8. 动态导入 SDK
      const sdk = await import('@anthropic-ai/claude-agent-sdk')

      // 9. 构建 SDK query
      const cliPath = resolveSDKCliPath()
      agentExec = getAgentExecutable()

      if (!existsSync(cliPath)) {
        const errMsg = `SDK CLI 文件不存在: ${cliPath}`
        console.error(`[Agent 编排] ${errMsg}`)
        callbacks.onError(errMsg)
        return
      }

      ensureRipgrepAvailable(cliPath)

      console.log(
        `[Agent 编排] 启动 SDK — CLI: ${cliPath}, 运行时: ${agentExec.type} (${agentExec.path}), 模型: ${modelId || DEFAULT_MODEL_ID}, resume: ${existingSdkSessionId ?? '无'}`,
      )

      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const executableArgs = agentExec.type === 'bun' ? [`--env-file=${nullDevice}`] : []

      // 确定 Agent 工作目录
      agentCwd = homedir()
      workspaceSlug = undefined
      workspace = undefined
      if (workspaceId) {
        const ws = getAgentWorkspace(workspaceId)
        if (ws) {
          agentCwd = getAgentSessionWorkspacePath(ws.slug, sessionId)
          workspaceSlug = ws.slug
          workspace = ws
          console.log(`[Agent 编排] 使用 session 级别 cwd: ${agentCwd} (${ws.name}/${sessionId})`)

          ensurePluginManifest(ws.slug, ws.name)

          if (existingSdkSessionId) {
            console.log(`[Agent 编排] 将尝试 resume: ${existingSdkSessionId}`)
          } else {
            console.log(`[Agent 编排] 无 sdkSessionId，将作为新会话启动（回填历史上下文）`)
          }
        }
      }

      // 9.5 验证 sdkSessionId 是否仍然有效（SDK 0.2.53 listSessions）
      if (existingSdkSessionId) {
        try {
          const sessions = await sdk.listSessions({ dir: agentCwd })
          const isValid = sessions.some((s: { sessionId: string }) => s.sessionId === existingSdkSessionId)
          if (!isValid) {
            console.log(`[Agent 编排] sdkSessionId 已失效 (${existingSdkSessionId})，将使用上下文注入`)
            existingSdkSessionId = undefined
            updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
          }
        } catch {
          // 验证失败不阻塞主流程
          console.warn(`[Agent 编排] listSessions 验证失败，继续使用现有 sessionId`)
        }
      }

      // 10. 构建 MCP 服务器配置 + 记忆工具
      const mcpServers = this.buildMcpServers(workspaceSlug)
      await this.injectMemoryTools(sdk, mcpServers)

      // 11. 构建动态上下文和最终 prompt
      const dynamicCtx = buildDynamicContext({
        workspaceName: workspace?.name,
        workspaceSlug,
        agentCwd,
      })
      const contextualMessage = `${dynamicCtx}\n\n${userMessage}`

      const isCompactCommand = userMessage.trim() === '/compact'
      const finalPrompt = isCompactCommand
        ? '/compact'
        : existingSdkSessionId
          ? contextualMessage
          : buildContextPrompt(sessionId, contextualMessage)

      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${existingSdkSessionId}`)
      } else if (finalPrompt !== contextualMessage) {
        console.log(`[Agent 编排] 无 resume，已回填历史上下文（最近 ${MAX_CONTEXT_MESSAGES} 条消息）`)
      }

      // 12. 读取应用设置 + 获取权限模式
      const appSettings = getSettings()
      const permissionMode: PromaPermissionMode = workspaceSlug
        ? getWorkspacePermissionMode(workspaceSlug)
        : (appSettings.agentPermissionMode ?? 'smart')
      console.log(`[Agent 编排] 权限模式: ${permissionMode}`)

      const canUseTool = permissionMode !== 'auto'
        ? permissionService.createCanUseTool(
            sessionId,
            permissionMode,
            (request: PermissionRequest) => {
              const event: AgentEvent = { type: 'permission_request', request }
              this.eventBus.emit(sessionId, event)
            },
            (sid, toolInput, signal, sendAskUser) => askUserService.handleAskUserQuestion(sid, toolInput, signal, sendAskUser),
            (request: AskUserRequest) => {
              const event: AgentEvent = { type: 'ask_user_request', request }
              this.eventBus.emit(sessionId, event)
            },
          )
        : undefined

      // 13. 构建 Adapter 查询选项
      const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0
        ? appSettings.agentMaxTurns
        : undefined
      const queryOptions: ClaudeAgentQueryOptions = {
        sessionId,
        prompt: finalPrompt,
        model: modelId || DEFAULT_MODEL_ID,
        cwd: agentCwd,
        sdkCliPath: cliPath,
        executable: agentExec,
        executableArgs,
        env: sdkEnv,
        ...(maxTurns != null && { maxTurns }),
        sdkPermissionMode: permissionMode === 'auto' ? 'bypassPermissions' : 'default',
        // 始终为 true：Worker 子代理使用 SDK 内部 mailbox 通信，
        // 若不跳过权限检查会导致 Worker 阻塞超时并提前停止
        allowDangerouslySkipPermissions: true,
        ...(canUseTool && { canUseTool }),
        ...(permissionMode !== 'auto' && { allowedTools: [...SAFE_TOOLS] }),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: buildSystemPromptAppend({
            workspaceName: workspace?.name,
            workspaceSlug,
            sessionId,
            permissionMode,
          }),
        },
        resumeSessionId: existingSdkSessionId,
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(workspaceSlug && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(workspaceSlug) }] }),
        ...(additionalDirectories && additionalDirectories.length > 0 && { additionalDirectories }),
        // SDK 0.2.52+ 新增选项（从 settings 读取）
        ...(appSettings.agentThinking && { thinking: appSettings.agentThinking }),
        ...(appSettings.agentEffort && { effort: appSettings.agentEffort }),
        ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && {
          maxBudgetUsd: appSettings.agentMaxBudgetUsd,
        }),
        onStderr: (data: string) => {
          stderrChunks.push(data)
          console.error(`[Agent SDK stderr] ${data}`)
        },
        onSessionId: (sdkSessionId: string) => {
          capturedSdkSessionId = sdkSessionId
          if (sdkSessionId !== existingSdkSessionId) {
            try {
              updateAgentSessionMeta(sessionId, { sdkSessionId })
              console.log(`[Agent 编排] 已保存 SDK session_id: ${sdkSessionId}`)
            } catch {
              // 索引更新失败不影响主流程
            }
          }
        },
        onModelResolved: (model: string) => {
          resolvedModel = model
          console.log(`[Agent 编排] SDK 确认模型: ${resolvedModel}`)
        },
        onContextWindow: (cw: number) => {
          console.log(`[Agent 编排] 缓存 contextWindow: ${cw}`)
        },
      }

      console.log(`[Agent 编排] 开始通过 Adapter 遍历事件流...`)

      // 14. 遍历 Adapter 产出的 AgentEvent 流（含自动重试 + Watchdog 死锁检测）
      let lastRetryableError: string | undefined
      let retrySucceeded = false

      // Agent Teams 追踪
      const startedTaskIds = new Set<string>()
      const completedTaskIds = new Set<string>()
      const taskNotificationSummaries: TaskNotificationSummary[] = []
      /** 捕获到的 SDK session ID（用于 auto-resume 的 inbox 查找） */
      let capturedSdkSessionId = existingSdkSessionId
      /** Watchdog 触发标记（死锁被检测到时设为 true） */
      let abortedByWatchdog = false

      for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
        // 非首次尝试：等待 + 发送重试事件到 UI
        if (attempt > 1) {
          const delayMs = getRetryDelayMs(attempt - 1)
          const delaySec = delayMs / 1000
          const attemptData: RetryAttempt = {
            attempt: attempt - 1,
            timestamp: Date.now(),
            reason: lastRetryableError ?? '未知错误',
            errorMessage: lastRetryableError ?? '',
            delaySeconds: delaySec,
          }

          this.eventBus.emit(sessionId, {
            type: 'retrying',
            attempt: attempt - 1,
            maxAttempts: MAX_AUTO_RETRIES,
            delaySeconds: delaySec,
            reason: lastRetryableError ?? '未知错误',
          })
          this.eventBus.emit(sessionId, { type: 'retry_attempt', attemptData })

          console.log(`[Agent 编排] 第 ${attempt - 1} 次重试，等待 ${delaySec}s...`)
          await new Promise((r) => setTimeout(r, delayMs))

          // 等待期间如果会话被中止，退出
          if (!this.activeSessions.has(sessionId)) {
            this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
            callbacks.onComplete(getAgentSessionMessages(sessionId))
            return
          }
        }

        let shouldRetryFromTypedError = false

        try {
          // 获取异步迭代器（手动 .next() 以支持 Promise.race 中断）
          const queryIterable = this.adapter.query(queryOptions)
          const queryIterator = queryIterable[Symbol.asyncIterator]()

          // Watchdog 控制器（用于死锁检测后中断事件循环）
          const loopAbort = new AbortController()
          abortedByWatchdog = false

          // 启动 Watchdog（每 5 秒检查是否所有 Worker 已 idle 但 Task 工具仍在等待）
          const WATCHDOG_INTERVAL_MS = 5_000
          const watchdogDone = (async () => {
            while (!loopAbort.signal.aborted) {
              await timerWithAbort(WATCHDOG_INTERVAL_MS, loopAbort.signal)
              if (loopAbort.signal.aborted) break

              // 仅在有 Worker 启动且未全部完成时检查
              if (
                startedTaskIds.size > 0 &&
                completedTaskIds.size < startedTaskIds.size &&
                capturedSdkSessionId
              ) {
                const allIdle = await areAllWorkersIdle(capturedSdkSessionId, startedTaskIds.size)
                if (allIdle) {
                  console.log(
                    `[Agent 编排] Watchdog: 所有 ${startedTaskIds.size} 个 Worker 已 idle，` +
                    `Task 工具仍在等待 — 中断以触发 auto-resume`,
                  )
                  abortedByWatchdog = true
                  loopAbort.abort()
                  break
                }
              }
            }
          })()

          // 手动事件循环：Promise.race（事件 vs Watchdog 中断）
          let pendingNext: Promise<IteratorResult<AgentEvent>> | null = null
          // Teams 活跃时延迟 complete 事件，避免前端提前标记 teammates 为 stopped
          let deferredCompleteEvent: AgentEvent | null = null

          while (!loopAbort.signal.aborted) {
            if (!pendingNext) {
              pendingNext = queryIterator.next()
            }

            const abortPromise = new Promise<null>((resolve) => {
              if (loopAbort.signal.aborted) { resolve(null); return }
              loopAbort.signal.addEventListener('abort', () => resolve(null), { once: true })
            })

            const raceResult = await Promise.race([
              pendingNext.then((r) => ({ kind: 'event' as const, result: r })),
              abortPromise.then(() => ({ kind: 'abort' as const, result: null })),
            ])

            if (raceResult.kind === 'abort') {
              // Watchdog 触发：终止事件循环，但不中止 SDK 会话
              // 注意：pending .next() 可能因 SDK 阻塞而永远不返回，
              // 因此 .return() 也会排队挂起 — 不能 await，用超时保护
              pendingNext?.catch(() => {})  // 防止未处理 rejection
              pendingNext = null
              const returnPromise = queryIterator.return?.(undefined as never).catch(() => {})
              // 最多等 1 秒，超时则放弃（generator 稍后 GC 清理）
              await Promise.race([
                returnPromise,
                new Promise<void>((r) => setTimeout(r, 1000)),
              ])
              console.log(`[Agent 编排] Watchdog 中断：已退出事件循环`)
              break
            }

            const iterResult = raceResult.result
            if (!iterResult || iterResult.done) break

            pendingNext = null
            const event = iterResult.value

            // typed_error：判断是否可自动重试
            if (event.type === 'typed_error') {
              // Proma 官方渠道认证失败：刷新 token + 重获取 System Key 后重试
              if (event.error.code === 'invalid_api_key' && channel.provider === 'proma' && attempt <= MAX_AUTO_RETRIES) {
                console.log(`[Agent 编排] Proma 认证失败: ${event.error.message}`)
                console.log(`[Agent 编排] 原始错误: ${event.error.originalError}`)
                try {
                  const newToken = await tryRefreshAuthToken()
                  if (newToken) {
                    clearSystemKeyCache()
                    const newApiKey = await getSystemApiKey()
                    // 更新 SDK 环境变量（下次 adapter.query 使用新凭证）
                    const env = queryOptions.env as Record<string, string | undefined>
                    env.ANTHROPIC_AUTH_TOKEN = newApiKey
                    lastRetryableError = '认证失败，已刷新凭证'
                    console.log(`[Agent 编排] Proma 凭证已刷新: key=${newApiKey.slice(0, 8)}...`)
                  } else {
                    lastRetryableError = event.error.message
                    console.warn('[Agent 编排] Proma token 刷新失败')
                  }
                } catch (refreshError) {
                  lastRetryableError = event.error.message
                  console.warn('[Agent 编排] Proma 凭证刷新异常:', refreshError)
                }
                this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
                accumulatedText = ''
                accumulatedEvents.length = 0
                shouldRetryFromTypedError = true
                break
              }

              if (isAutoRetryableTypedError(event.error) && attempt <= MAX_AUTO_RETRIES) {
                lastRetryableError = event.error.title
                  ? `${event.error.title}: ${event.error.message}`
                  : event.error.message
                console.log(`[Agent 编排] 可重试错误 (typed_error): ${event.error.code} - ${lastRetryableError}`)
                // 保存部分内容后准备重试
                this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
                accumulatedText = ''
                accumulatedEvents.length = 0
                shouldRetryFromTypedError = true
                break  // 跳出事件循环，进入下一次 retry 循环
              }

              // 不可重试 → 走原有终止逻辑
              this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)

              const errorMsg: AgentMessage = {
                id: randomUUID(),
                role: 'status',
                content: event.error.title
                  ? `${event.error.title}: ${event.error.message}`
                  : event.error.message,
                createdAt: Date.now(),
                errorCode: event.error.code,
                errorTitle: event.error.title,
                errorDetails: event.error.details,
                errorOriginal: event.error.originalError,
                errorCanRetry: event.error.canRetry,
                errorActions: event.error.actions,
              }
              appendAgentMessage(sessionId, errorMsg)
              console.log(`[Agent 编排] 已保存 TypedError 消息: ${event.error.code} - ${event.error.title}`)

              // 如果之前有重试记录，发送 retry_failed
              if (attempt > 1 && lastRetryableError) {
                this.eventBus.emit(sessionId, {
                  type: 'retry_failed',
                  finalAttempt: {
                    attempt: attempt - 1,
                    timestamp: Date.now(),
                    reason: lastRetryableError,
                    errorMessage: event.error.message,
                    delaySeconds: 0,
                  },
                })
              }

              this.eventBus.emit(sessionId, event)
              // 清理 Watchdog
              if (!loopAbort.signal.aborted) loopAbort.abort()
              await watchdogDone
              try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
              callbacks.onComplete(getAgentSessionMessages(sessionId))
              return
            }

            // 正常事件处理
            if (event.type === 'text_delta') {
              accumulatedText += event.text
            }
            accumulatedEvents.push(event)

            // Agent Teams: 当有 teammate 活跃时，延迟 complete 事件
            // 避免前端收到 complete → 标记所有 teammates 为 stopped → 建议不渲染
            if (event.type === 'complete' && startedTaskIds.size > 0) {
              console.log(`[Agent 编排] 延迟 complete 事件（${startedTaskIds.size} 个 teammate 活跃）`)
              deferredCompleteEvent = event
              // 不发射到 eventBus，继续等待 auto-resume
            } else {
              this.eventBus.emit(sessionId, event)
            }

            // Agent Teams: 追踪 teammate 任务状态
            if (event.type === 'task_started') {
              startedTaskIds.add(event.taskId)
            } else if (event.type === 'task_notification') {
              completedTaskIds.add(event.taskId)
              if (event.summary) {
                taskNotificationSummaries.push({
                  taskId: event.taskId,
                  status: event.status,
                  summary: event.summary,
                  outputFile: event.outputFile,
                })
              }
            }
          }

          // 清理 Watchdog（事件循环正常结束或被 Watchdog 中断）
          if (!loopAbort.signal.aborted) loopAbort.abort()
          await watchdogDone

          if (abortedByWatchdog) {
            console.log(`[Agent 编排] Watchdog 中断了事件循环，将触发 auto-resume`)
          }

          // typed_error break 触发了 → 继续循环
          if (shouldRetryFromTypedError) {
            continue
          }

          // 正常完成 — 如果之前有重试，发送 retry_cleared
          if (attempt > 1) {
            this.eventBus.emit(sessionId, { type: 'retry_cleared' })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)

          // 16. Agent Teams Auto-Resume：teammates 完成后自动收集结果并汇总
          //     触发条件：有 teammate 启动过（正常完成或 Watchdog 中断均适用）
          console.log(`[Agent 编排] Auto-resume 条件检查: startedTasks=${startedTaskIds.size}, sdkSession=${!!capturedSdkSessionId}, active=${this.activeSessions.has(sessionId)}`)
          if (startedTaskIds.size > 0 && capturedSdkSessionId && this.activeSessions.has(sessionId)) {
            console.log(`[Agent 编排] Agent Teams 检测到 ${startedTaskIds.size} 个 teammate，启动 auto-resume`)

            // 通知前端：正在收集 teammate 结果
            this.eventBus.emit(sessionId, {
              type: 'waiting_resume',
              message: '正在收集 teammate 工作结果...',
            })

            // 构造 resume prompt（优先 inbox，fallback 到 summaries）
            let resumePrompt: string | null = null

            const inboxInfo = await findTeamLeadInboxPath(capturedSdkSessionId)
            console.log(`[Agent 编排] Inbox 查找结果: ${inboxInfo ? `team=${inboxInfo.teamName}` : '未找到 team'}`)
            if (inboxInfo) {
              const unreadMessages = await pollInboxWithRetry(
                inboxInfo.inboxPath,
                INBOX_RETRY_CONFIG,
              )
              if (unreadMessages.length > 0) {
                await markInboxAsRead(inboxInfo.inboxPath)
                resumePrompt = formatInboxPrompt(unreadMessages)
                console.log(`[Agent 编排] 使用 ${unreadMessages.length} 条 inbox 消息构建 resume prompt`)
              }
            }

            // Fallback：用 task_notification summaries
            if (!resumePrompt && taskNotificationSummaries.length > 0) {
              console.log(`[Agent 编排] Inbox 为空，使用 ${taskNotificationSummaries.length} 条 task summaries 作为 fallback`)
              resumePrompt = formatSummaryFallbackPrompt(taskNotificationSummaries)
            }

            if (resumePrompt && this.activeSessions.has(sessionId)) {
              const resumeMessageId = randomUUID()
              this.eventBus.emit(sessionId, { type: 'resume_start', messageId: resumeMessageId })

              // 创建 resume 查询（使用相同的 SDK session ID）
              let resumeText = ''
              const resumeEvents: AgentEvent[] = []

              try {
                const resumeOptions: ClaudeAgentQueryOptions = {
                  ...queryOptions,
                  prompt: resumePrompt,
                  resumeSessionId: capturedSdkSessionId,
                }

                for await (const event of this.adapter.query(resumeOptions)) {
                  if (!this.activeSessions.has(sessionId)) break

                  if (event.type === 'text_delta') {
                    resumeText += event.text
                  }
                  resumeEvents.push(event)
                  this.eventBus.emit(sessionId, event)
                }

                // 持久化 resume 助手消息
                if (resumeText || resumeEvents.length > 0) {
                  this.persistAssistantMessage(sessionId, resumeText, resumeEvents, resolvedModel)
                }

                console.log(`[Agent 编排] Auto-resume 完成，输出 ${resumeText.length} 字符`)
              } catch (resumeError) {
                console.error('[Agent 编排] Auto-resume 失败:', resumeError)
                // 已流式的部分内容已保存，继续完成流程
              }
            } else if (!resumePrompt) {
              console.log('[Agent 编排] 无可用的 resume 内容（inbox 和 summaries 均为空）')
            }
          }
          try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }

          // 发射延迟的 complete 事件（auto-resume 已完成，前端可安全处理）
          if (deferredCompleteEvent) {
            console.log(`[Agent 编排] 发射延迟的 complete 事件`)
            this.eventBus.emit(sessionId, deferredCompleteEvent)
          }

          // 发送完成信号
          callbacks.onComplete(getAgentSessionMessages(sessionId))

          // 异步生成标题
          this.autoGenerateTitle(sessionId, userMessage, channelId, resolvedModel, callbacks)
            .catch((err) => console.error('[Agent 编排] 标题生成未捕获异常:', err))

          break  // 成功完成，退出重试循环

        } catch (error) {
          // 打印 stderr
          const fullStderr = stderrChunks.join('').trim()
          if (fullStderr) {
            console.error(`[Agent 编排] 完整 stderr 输出 (${fullStderr.length} 字符):`)
            console.error(fullStderr)
          } else {
            console.error(`[Agent 编排] stderr 为空`)
          }

          // 用户主动中止
          if (!this.activeSessions.has(sessionId)) {
            console.log(`[Agent 编排] 会话 ${sessionId} 已被用户中止`)
            this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
            callbacks.onComplete(getAgentSessionMessages(sessionId))
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''

          // Proma 官方渠道 401：刷新凭证后重试
          if (apiError?.statusCode === 401 && channel.provider === 'proma' && attempt <= MAX_AUTO_RETRIES) {
            console.log(`[Agent 编排] Proma 401 错误 (catch): ${apiError.message}`)
            console.log(`[Agent 编排] stderr 输出: ${stderrOutput.slice(0, 500)}`)
            try {
              const newToken = await tryRefreshAuthToken()
              if (newToken) {
                clearSystemKeyCache()
                const newApiKey = await getSystemApiKey()
                const env = queryOptions.env as Record<string, string | undefined>
                env.ANTHROPIC_AUTH_TOKEN = newApiKey
                lastRetryableError = `API Error 401: ${apiError.message}（已刷新凭证）`
                console.log(`[Agent 编排] Proma 凭证已刷新: key=${newApiKey.slice(0, 8)}...`)
              } else {
                lastRetryableError = `API Error 401: ${apiError.message}`
              }
            } catch {
              lastRetryableError = `API Error 401: ${apiError.message}`
            }
            this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
            accumulatedText = ''
            accumulatedEvents.length = 0
            stderrChunks.length = 0
            continue
          }

          // Proma 官方渠道 402：额度不足，广播事件触发充值对话框
          if (apiError?.statusCode === 402 && channel.provider === 'proma') {
            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED)
            })
            console.log(`[Agent 编排] Proma 额度不足 (402)，已广播事件`)
          }

          // 判断是否可重试
          if (isAutoRetryableCatchError(apiError, rawErrorMessage) && attempt <= MAX_AUTO_RETRIES) {
            lastRetryableError = apiError
              ? `API Error ${apiError.statusCode}: ${apiError.message}`
              : (error instanceof Error ? error.message : '未知错误')
            console.log(`[Agent 编排] 可重试错误 (catch): ${lastRetryableError}`)
            // 保存部分内容
            this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
            accumulatedText = ''
            accumulatedEvents.length = 0
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 不可重试 — 走原有终止逻辑
          const errorMessage = error instanceof Error ? error.message : '未知错误'
          console.error(`[Agent 编排] 执行失败:`, error)

          // 保存已累积的部分内容
          if (accumulatedText || accumulatedEvents.length > 0) {
            try {
              this.persistAssistantMessage(sessionId, accumulatedText, accumulatedEvents, resolvedModel)
              console.log(`[Agent 编排] 已保存部分执行结果 (${accumulatedText.length} 字符, ${accumulatedEvents.length} 事件)`)
            } catch (saveError) {
              console.error('[Agent 编排] 保存部分内容失败:', saveError)
            }
          }

          let userFacingError: string
          if (apiError) {
            userFacingError = `API 错误 (${apiError.statusCode}):\n${apiError.message}`
          } else {
            // 没有解析到 API 错误时，把 stderr 内容附加上去（便于诊断 Windows exit code 1 等问题）
            const stderrSummary = stderrOutput
              ? `\n\n诊断信息:\n${stderrOutput.slice(0, 500)}${stderrOutput.length > 500 ? '...' : ''}`
              : ''
            userFacingError = errorMessage + stderrSummary
          }

          // 保存错误消息到 JSONL
          try {
            const errMsg: AgentMessage = {
              id: randomUUID(),
              role: 'status',
              content: userFacingError,
              createdAt: Date.now(),
              errorCode: 'unknown_error',
              errorTitle: '执行错误',
              errorOriginal: error instanceof Error ? error.stack : String(error),
            }
            appendAgentMessage(sessionId, errMsg)
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有重试记录，发送 retry_failed
          if (attempt > 1 && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              type: 'retry_failed',
              finalAttempt: {
                attempt: attempt - 1,
                timestamp: Date.now(),
                reason: lastRetryableError,
                errorMessage: userFacingError,
                delaySeconds: 0,
              },
            })
          }

          callbacks.onError(userFacingError)
          callbacks.onComplete(getAgentSessionMessages(sessionId))

          // 根据错误类型决定是否保留 sdkSessionId
          const shouldClearSession = !apiError || apiError.statusCode >= 500
          if (existingSdkSessionId && shouldClearSession) {
            try {
              updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
              console.log(`[Agent 编排] 已清除失效的 sdkSessionId`)
            } catch { /* 忽略 */ }
          } else if (existingSdkSessionId && !shouldClearSession) {
            console.log(`[Agent 编排] 保留 sdkSessionId (API 错误 ${apiError?.statusCode})`)
          }

          throw error
        }
      }

      // 重试循环结束（达到最大次数仍失败）
      if (!retrySucceeded && lastRetryableError) {
        this.eventBus.emit(sessionId, {
          type: 'retry_failed',
          finalAttempt: {
            attempt: MAX_AUTO_RETRIES,
            timestamp: Date.now(),
            reason: lastRetryableError,
            errorMessage: `重试 ${MAX_AUTO_RETRIES} 次后仍然失败`,
            delaySeconds: 0,
          },
        })

        // 保存错误消息
        const retryErrorMsg: AgentMessage = {
          id: randomUUID(),
          role: 'status',
          content: `重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`,
          createdAt: Date.now(),
          errorCode: 'unknown_error',
          errorTitle: '重试失败',
        }
        appendAgentMessage(sessionId, retryErrorMsg)

        callbacks.onError(`重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`)
        callbacks.onComplete(getAgentSessionMessages(sessionId))
      }

    } finally {
      this.activeSessions.delete(sessionId)
      permissionService.clearSessionPending(sessionId)
      askUserService.clearSessionPending(sessionId)
    }
  }

  /**
   * 中止指定会话的 Agent 执行
   *
   * 先从 activeSessions 移除（供 sendMessage catch 块检测用户中止），
   * 再调用 adapter.abort() 中止底层 SDK 进程。
   */
  stop(sessionId: string): void {
    this.activeSessions.delete(sessionId)
    this.adapter.abort(sessionId)
    console.log(`[Agent 编排] 已中止会话: ${sessionId}`)
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.activeSessions.size === 0) return
    console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    this.adapter.dispose()
    this.activeSessions.clear()
  }
}