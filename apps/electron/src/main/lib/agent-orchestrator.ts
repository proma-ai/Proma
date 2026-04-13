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
import { existsSync, mkdirSync, symlinkSync, readFileSync, writeFileSync, accessSync, chmodSync, constants as fsConstants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { app } from 'electron'
import type { AgentSendInput, AgentEvent, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, TypedError, RetryAttempt, SDKMessage, SDKAssistantMessage, AgentStreamPayload, RewindSessionResult } from '@proma/shared'
import { SAFE_TOOLS } from '@proma/shared'
import type { PermissionRequest, PromaPermissionMode, AskUserRequest, ExitPlanModeRequest } from '@proma/shared'
import type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter'
import { isPromptTooLongError, friendlyErrorMessage, mapSDKErrorToTypedError, extractErrorDetails } from './adapters/claude-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById, listChannels } from './channel-manager'
import { getSystemApiKey, clearSystemKeyCache } from './cloud-channel-service'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { getAdapter, fetchTitle, normalizeAnthropicBaseUrlForSdk } from '@proma/core'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, getAgentSessionSDKMessages, truncateSDKMessages, resolveUserUuidFromSDK, rewindFilesFromSnapshot } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest, getWorkspacePermissionMode, setWorkspacePermissionMode } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getSdkConfigDir, getWorkspaceFilesDir } from './config-paths'
import { getWorkspaceAttachedDirectories } from './agent-workspace-manager'
import { getRuntimeStatus } from './runtime-init'
import { getSettings } from './settings-service'
import { buildSystemPrompt, buildDynamicContext, buildBuiltinAgents } from './agent-prompt-builder'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
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
import { validateToolInput } from './agent-tool-input-validator'
import { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD } from './agent-tool-token-estimator'

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
  onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string }) => void
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

/**
 * 判断错误是否为 SDK session 不存在（"No conversation found with session ID"）
 *
 * 当 resume 目标 session 已过期或被清理时，SDK 会抛出此错误。
 * 此类错误可通过清除 sdkSessionId 并切换到上下文回填模式来恢复。
 */
function isSessionNotFoundError(errorMessage: string, stderr?: string): boolean {
  const pattern = /No conversation found.*with session/i
  return pattern.test(errorMessage) || (!!stderr && pattern.test(stderr))
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
 * 优先级：Node.js（缓存）→ which node 同步查找
 *
 * 当 runtimeStatusCache 尚未初始化时（应用启动竞态），
 * 用 which/where 同步查找作为兜底，避免 SDK spawn 失败。
 * 如果 Node.js 完全不可用，抛出明确错误。
 */
function getAgentExecutable(): { type: 'node'; path: string } {
  const status = getRuntimeStatus()

  if (status?.node?.available && status.node.path) {
    return { type: 'node', path: status.node.path }
  }

  // runtimeStatusCache 未就绪时，同步查找 node 路径
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const nodePath = execFileSync(cmd, ['node'], { encoding: 'utf-8', timeout: 2000 })
      .trim()
      .split('\n')[0]
    if (nodePath && existsSync(nodePath)) {
      console.warn(`[Agent 编排] runtimeStatusCache 未就绪，同步查找 node: ${nodePath}`)
      return { type: 'node', path: nodePath }
    }
  } catch {
    // 忽略查找失败
  }

  throw new Error(
    'Node.js 运行时未找到。Agent 功能需要系统安装 Node.js (v18+)。' +
      '请访问 https://nodejs.org 下载安装后重启 Proma。',
  )
}

/**
 * 确保打包环境下 ripgrep 可被 SDK CLI 找到
 *
 * 通过 symlink 桥接 extraResources → SDK 的 vendor 目录。
 */
function ensureRipgrepAvailable(cliPath: string): void {
  try {
    const sdkDir = dirname(cliPath)
    const arch = process.arch
    const platform = process.platform
    const rgDir = join(sdkDir, 'vendor', 'ripgrep', `${arch}-${platform}`)
    const rgPath = join(rgDir, 'rg')

    // 检查 rg 是否已经可执行（而不是仅检查目录存在）
    try {
      accessSync(rgPath, fsConstants.X_OK)
      return // 已可执行，无需修复
    } catch {
      // 不可执行或不存在，继续修复
    }

    // 情况 1：rg 文件存在但缺少执行权限（pnpm 安装不保留权限）
    if (existsSync(rgPath)) {
      chmodSync(rgPath, 0o755)
      console.log(`[Agent 编排] ripgrep 权限修复成功: ${rgPath}`)
      return
    }

    // 情况 2（仅打包环境）：rg 文件不存在，通过 symlink 桥接 extraResources
    if (!app.isPackaged) return

    const resourcesRipgrep = join(process.resourcesPath, 'vendor', 'ripgrep')
    if (!existsSync(resourcesRipgrep)) {
      console.warn(`[Agent 编排] ripgrep 资源不存在: ${resourcesRipgrep}`)
      return
    }

    // 同时修复 extraResources 中 rg 的权限
    const resourcesRg = join(resourcesRipgrep, 'rg')
    if (existsSync(resourcesRg)) {
      try { chmodSync(resourcesRg, 0o755) } catch { /* 忽略 */ }
    }

    mkdirSync(join(sdkDir, 'vendor', 'ripgrep'), { recursive: true })
    symlinkSync(resourcesRipgrep, rgDir, 'junction')
    console.log(`[Agent 编排] ripgrep symlink 创建成功: ${rgDir} → ${resourcesRipgrep}`)
  } catch (error) {
    console.warn('[Agent 编排] ripgrep symlink 创建失败:', error)
  }
}

/** 最大回填消息条数 */
const MAX_CONTEXT_MESSAGES = 20

/** 单条工具摘要最大字符数 */
const MAX_TOOL_SUMMARY_LENGTH = 200

/**
 * 从 SDKMessage assistant 消息的 content 中提取工具活动摘要
 *
 * 扫描 tool_use 块，提取工具名称和关键参数，帮助新 SDK 会话理解之前做过什么。
 */
function extractSDKToolSummary(content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>): string {
  const summaries: string[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && block.name) {
      const input = block.input ?? {}
      const keyParam = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      const paramStr = keyParam ? `: ${String(keyParam).slice(0, 100)}` : ''
      summaries.push(`[tool: ${block.name}${paramStr}]`)
    }
  }
  if (summaries.length === 0) return ''
  const joined = summaries.join(' ')
  return joined.length > MAX_TOOL_SUMMARY_LENGTH
    ? joined.slice(0, MAX_TOOL_SUMMARY_LENGTH) + '...'
    : joined
}

/**
 * 构建带历史上下文的 prompt
 *
 * 当 resume 不可用时，将最近消息拼接为上下文注入 prompt，
 * 让新 SDK 会话保留对话记忆。包含文本内容和工具活动摘要。
 */
function buildContextPrompt(sessionId: string, currentUserMessage: string, sessionHint?: { agentCwd: string }): string {
  const allMessages = getAgentSessionSDKMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  // 排除最后一条（当前用户消息，刚刚才 append 的）
  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.type === 'user' || m.type === 'assistant'))
    .map((m) => {
      // 从 SDKMessage 的 message.content 中提取文本
      const content = (m as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } }).message?.content
      if (!Array.isArray(content)) return null

      const textParts = content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
      const text = textParts.join('\n')
      if (!text) return null

      let line = `[${m.type}]: ${text}`
      // assistant 消息附带工具活动摘要
      if (m.type === 'assistant') {
        const toolSummary = extractSDKToolSummary(content)
        if (toolSummary) {
          line += `\n  工具活动: ${toolSummary}`
        }
      }
      return line
    })
    .filter(Boolean)

  if (lines.length === 0) return currentUserMessage

  // 注入 session 元信息，便于 Agent 在需要时读取完整历史
  const sessionInfoBlock = sessionHint
    ? `\n<session_info>\nSession ID: ${sessionId}\nSession CWD: ${sessionHint.agentCwd}\nNote: 上方为近期对话摘要。如需更多上下文，可读取 ~/.proma/agent-sessions/${sessionId}.jsonl 获取完整历史。\n</session_info>\n`
    : ''

  console.log(`[Agent 编排] buildContextPrompt: 读取 ${allMessages.length} 条消息，注入 ${lines.length} 条历史${sessionHint ? '（含 session 元信息）' : ''}`)
  return `<conversation_history>${sessionInfoBlock}\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
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
  private activeSessions = new Map<string, number>()

  /** 队列消息本地记录（sessionId → UUID 集合，用于防重） */
  private queuedMessageUuids = new Map<string, Set<string>>()

  /** 被用户手动中止的会话集合（在 stop 中标记，catch block 中消费） */
  private stoppedBySessions = new Set<string>()

  /** 运行中会话的当前权限模式（支持运行时动态切换） */
  private sessionPermissionModes = new Map<string, PromaPermissionMode>()

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
      // 启用 Tasks 功能
      CLAUDE_CODE_ENABLE_TASKS: 'true',
      // 禁用实验性 beta 功能，使用稳定模式
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      // 配置隔离：让 SDK 使用独立的配置目录，不读取用户的 ~/.claude.json
      CLAUDE_CONFIG_DIR: getSdkConfigDir(),
    }

    // 显式控制 ANTHROPIC_BASE_URL：仅在用户配置了自定义 Base URL 时注入
    // 使用统一的 normalizeAnthropicBaseUrlForSdk 规范化，SDK 内部会自动拼接 /v1/messages
    if (baseUrl && baseUrl !== DEFAULT_ANTHROPIC_URL) {
      sdkEnv.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrlForSdk(baseUrl)
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
   * 注入 SDK 内置生图工具（Nano Banana）
   */
  private async injectNanoBananaTools(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
    mcpServers: Record<string, Record<string, unknown>>,
    sessionId: string,
    agentCwd?: string,
  ): Promise<void> {
    try {
      const { injectNanoBananaMcpServer } = await import('./chat-tools/nano-banana-mcp')
      await injectNanoBananaMcpServer(sdk, mcpServers, sessionId, agentCwd)
    } catch (err) {
      console.error(`[Agent 编排] 注入 Nano Banana MCP 失败:`, err)
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
   * Session-not-found 恢复：清除失效的 sdkSessionId，切换到上下文回填模式
   *
   * 当 resume 的目标 session 已过期/被清理时，SDK 会抛出 "No conversation found" 错误。
   * 此方法执行恢复的公共逻辑，调用方负责设置 existingSdkSessionId = undefined 和流程控制（break/continue）。
   *
   * @returns lastRetryableError 描述字符串
   */
  private prepareSessionNotFoundRecovery(
    sessionId: string,
    queryOptions: ClaudeAgentQueryOptions,
    contextualMessage: string,
    agentCwd: string,
    accumulatedMessages: SDKMessage[],
    queryStartedAt: number,
  ): string {
    console.log(`[Agent 编排] 检测到 session-not-found 错误，清除 sdkSessionId 并切换到上下文回填模式`)
    try { updateAgentSessionMeta(sessionId, { sdkSessionId: undefined }) } catch { /* 忽略 */ }
    queryOptions.resumeSessionId = undefined
    queryOptions.prompt = buildContextPrompt(sessionId, contextualMessage, { agentCwd })
    this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
    accumulatedMessages.length = 0
    return 'Session 已失效，切换到上下文回填模式'
  }

  /**
   * 持久化累积的 SDKMessage（Phase 4: 直接存储原始 SDKMessage）
   *
   * 只持久化 assistant、user、result 和 compact_boundary system 消息
   * （跳过 tool_progress、compacting 等临时消息）。
   */
  private persistSDKMessages(
    sessionId: string,
    accumulatedMessages: SDKMessage[],
    durationMs?: number,
  ): void {
    if (accumulatedMessages.length === 0) return

    const toPersist = accumulatedMessages.filter(
      (m) => m.type === 'assistant' || m.type === 'user' || m.type === 'result'
        || (m.type === 'system' && (m as import('@proma/shared').SDKSystemMessage).subtype === 'compact_boundary')
    ).filter((m) => {
      // 过滤 SDK 内部生成的 user 文本消息（如 Skill 展开 prompt），与实时流过滤逻辑一致
      if (m.type === 'user') {
        const content = (m as { message?: { content?: Array<{ type: string }> } }).message?.content
        const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
        if (!hasToolResult) return false
      }
      return true
    })

    if (toPersist.length === 0) return

    // 为没有 _createdAt 的消息补上时间戳（assistant 消息来自 SDK 原始输出，不含时间）
    const now = Date.now()
    const withTimestamps = toPersist.map((m) => {
      const msg = m as Record<string, unknown>
      if (typeof msg._createdAt === 'number') return m
      // 为 result 消息附加 _durationMs
      if (m.type === 'result' && durationMs != null) {
        return { ...m, _createdAt: now, _durationMs: durationMs } as unknown as SDKMessage
      }
      return { ...m, _createdAt: now } as unknown as SDKMessage
    })

    appendSDKMessages(sessionId, withTimestamps)
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const { sessionId, userMessage, channelId, modelId, workspaceId, additionalDirectories, customMcpServers, permissionModeOverride, mentionedSkills, mentionedMcpServers } = input
    const stderrChunks: string[] = []

    // 0. 并发保护
    if (this.activeSessions.has(sessionId)) {
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      return
    }

    // 0.5 清除上一轮中断标记
    try { updateAgentSessionMeta(sessionId, { stoppedByUser: false }) } catch { /* 会话可能已删除 */ }

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

    // 2.1 立即抢占会话槽位（在所有同步检查通过后、第一个 await 之前）
    // 防止 buildSdkEnv 等 await 期间并发调用绕过上方的检查，导致多条重复消息写入 JSONL
    // finally 块会通过 generation 匹配来安全清理，不影响正常流程
    const runGeneration = Date.now()
    this.activeSessions.set(sessionId, runGeneration)

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
      // 非 proma 渠道应用规范化逻辑，确保 process.env 与 sdkEnv 中的 URL 一致
      process.env.ANTHROPIC_BASE_URL = channel.provider === 'proma'
        ? sdkBaseUrl
        : normalizeAnthropicBaseUrlForSdk(sdkBaseUrl)
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

    // 4.1 检测回退后的 resume 截断点（快照回退功能）
    let rewindResumeAt: string | undefined
    if (sessionMeta?.resumeAtMessageUuid) {
      rewindResumeAt = sessionMeta.resumeAtMessageUuid
      // 消费一次后清除
      updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: undefined })
      console.log(`[Agent 编排] 检测到回退 resume: resumeSessionAt=${rewindResumeAt}`)
    }

    console.log(`[Agent 编排] Resume 状态: sdkSessionId=${existingSdkSessionId || '无'}, proma sessionId=${sessionId}`)

    // 5. 持久化用户消息（SDKMessage 格式）
    const userSDKMsg: SDKMessage = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: userMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: Date.now(),
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [userSDKMsg])

    // 6. 状态初始化
    const accumulatedMessages: SDKMessage[] = []
    let resolvedModel = modelId || DEFAULT_MODEL_ID
    let titleGenerationStarted = false
    let agentExec: { type: 'node'; path: string } | undefined
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

      const executableArgs: string[] = []

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

      // 9.4.1 Fork 后首次 resume：使用源 cwd 让 SDK 找到 session 文件
      // SDK forkSession() 在源 cwd 的项目哈希下创建新 session 文件，
      // 首次 resume 需要从该目录查找，之后 SDK 会在新 cwd 下创建新数据
      if (sessionMeta?.forkSourceDir) {
        agentCwd = sessionMeta.forkSourceDir
        console.log(`[Agent 编排] Fork 首次 resume: 使用源会话 cwd=${sessionMeta.forkSourceDir}`)
        // 消费一次后清除
        updateAgentSessionMeta(sessionId, { forkSourceDir: undefined })
      }

      // 9.5 确保 SDK 项目设置（plansDirectory → .context）
      {
        const claudeSettingsDir = join(agentCwd, '.claude')
        if (!existsSync(claudeSettingsDir)) mkdirSync(claudeSettingsDir, { recursive: true })
        const settingsPath = join(claudeSettingsDir, 'settings.json')
        let sdkProjectSettings: Record<string, unknown> = {}
        try {
          sdkProjectSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        } catch { /* 文件不存在或解析失败 */ }
        let needsWrite = false
        if (sdkProjectSettings.plansDirectory !== '.context') {
          sdkProjectSettings.plansDirectory = '.context'
          needsWrite = true
        }
        if (sdkProjectSettings.skipWebFetchPreflight !== true) {
          sdkProjectSettings.skipWebFetchPreflight = true
          needsWrite = true
        }
        if (needsWrite) {
          writeFileSync(settingsPath, JSON.stringify(sdkProjectSettings, null, 2))
          console.log(`[Agent 编排] 已设置 SDK settings (plansDirectory, skipWebFetchPreflight)`)
        }
      }

      // 9.6 直接信任已保存的 sdkSessionId，跳过 listSessions 预验证
      // 原因：listSessions({ dir }) 基于 cwd 路径哈希查找，但 session 级别的 cwd
      // （如 ~/.proma/agent-workspaces/workspace-xxx/sessionId）与 SDK 内部存储的路径哈希可能不匹配，
      // 导致 listSessions 始终返回 0 个会话，误杀有效的 resume。
      // SDK 本身会优雅处理无效的 resume ID（回退为新会话），无需预验证。
      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 将直接使用已保存的 sdkSessionId 进行 resume: ${existingSdkSessionId}`)
      }

      // 10. 构建 MCP 服务器配置 + 记忆工具 + 生图工具 + 自定义工具
      const mcpServers = this.buildMcpServers(workspaceSlug)
      await this.injectMemoryTools(sdk, mcpServers)
      await this.injectNanoBananaTools(sdk, mcpServers, sessionId, agentCwd)

      // 合并外部注入的自定义 MCP 服务器（如飞书群聊工具）
      if (customMcpServers) {
        Object.assign(mcpServers, customMcpServers)
        console.log(`[Agent 编排] 已合并 ${Object.keys(customMcpServers).length} 个自定义 MCP 服务器`)
      }

      // 11. 构建动态上下文和最终 prompt
      const dynamicCtx = buildDynamicContext({
        workspaceName: workspace?.name,
        workspaceSlug,
        agentCwd,
      })

      // 11.5 注入 mention 引用指令（Skill/MCP）— 仅影响 prompt，不影响持久化
      let enrichedMessage = userMessage
      if (mentionedSkills?.length || mentionedMcpServers?.length) {
        const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
        for (const slug of mentionedSkills ?? []) {
          const qualifiedName = workspaceSlug
            ? `proma-workspace-${workspaceSlug}:${slug}`
            : slug
          toolLines.push(`- Skill: ${qualifiedName}（请立即调用此 Skill）`)
        }
        for (const name of mentionedMcpServers ?? []) {
          toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
        }
        enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${userMessage}`
        console.log(`[Agent 编排] 注入 mentioned_tools: ${mentionedSkills?.length ?? 0} skills, ${mentionedMcpServers?.length ?? 0} MCP`)
      }

      const contextualMessage = `${dynamicCtx}\n\n${enrichedMessage}`

      const isCompactCommand = userMessage.trim() === '/compact'
      const finalPrompt = isCompactCommand
        ? '/compact'
        : existingSdkSessionId
          ? contextualMessage
          : buildContextPrompt(sessionId, contextualMessage, { agentCwd })

      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${existingSdkSessionId}`)
      } else if (finalPrompt !== contextualMessage) {
        console.log(`[Agent 编排] 无 resume，已回填历史上下文（最近 ${MAX_CONTEXT_MESSAGES} 条消息）`)
      }

      // 12. 读取应用设置 + 获取权限模式
      const appSettings = getSettings()
      const initialPermissionMode: PromaPermissionMode = permissionModeOverride
        ?? (workspaceSlug
          ? getWorkspacePermissionMode(workspaceSlug)
          : (appSettings.agentPermissionMode ?? 'acceptEdits'))
      // 注册到 Map，支持运行中动态切换
      this.sessionPermissionModes.set(sessionId, initialPermissionMode)
      console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

      /** 读取当前会话的实时权限模式（支持运行中切换） */
      const getPermissionMode = (): PromaPermissionMode =>
        this.sessionPermissionModes.get(sessionId) ?? initialPermissionMode

      // ExitPlanMode 拦截器：plan 模式下走 UI 审批流程
      const handleExitPlanMode = (toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> => {
        return exitPlanService.handleExitPlanMode(
          sessionId,
          toolInput,
          signal,
          (request: ExitPlanModeRequest) => {
            this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'exit_plan_mode_request', request } })
          },
        )
      }

      // 始终创建 acceptEdits 权限回调（运行中可能切换到 acceptEdits）
      const acceptEditsCanUseTool = permissionService.createCanUseTool(
        sessionId,
        (request: PermissionRequest) => {
          this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'permission_request', request } })
        },
        (sid, toolInput, signal, sendAskUser) => askUserService.handleAskUserQuestion(sid, toolInput, signal, sendAskUser),
        (request: AskUserRequest) => {
          this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
        },
      )

      /**
       * 判断 Bash 命令是否是只读的（计划模式下安全可执行）
       * 检测写操作特征：文件重定向、破坏性命令、包管理写操作、git 写操作等
       */
      const isBashCommandReadOnly = (command: string): boolean => {
        // 输出重定向：匹配未被数字或 & 前置的 > 符号（排除 2>/dev/null、&> 等 fd 重定向）
        if (/(?<![0-9&])>/.test(command)) return false
        // 破坏性文件操作
        if (/\b(rm|rmdir)\s/.test(command)) return false
        if (/\bsed\s+[^|&;]*-i/.test(command)) return false  // sed -i 原地编辑
        if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
        if (/\b(mv|cp)\s/.test(command)) return false
        if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
        // 包管理器写操作
        if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
        if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
        if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
        // Git 写操作
        if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
        // 进程控制
        if (/\b(kill|killall|pkill)\s/.test(command)) return false
        // 脚本执行（具有潜在副作用，如 node script.js / python main.py）
        if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
        return true
      }

      // Plan 模式下允许的只读工具（不包含 Write/Edit/Bash 等写操作）
      const PLAN_MODE_ALLOWED_TOOLS = new Set([
        'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
        'Agent', 'TodoRead', 'TodoWrite', 'TaskOutput',
        'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
        'ListMcpResourcesTool', 'ReadMcpResourceTool',
      ])

      /** Plan 模式是否已被 Agent 进入（初始 plan 模式时天然为 true，其他模式需 EnterPlanMode 触发） */
      let planModeEntered = initialPermissionMode === 'plan'

      // 动态 canUseTool：每次调用读取当前权限模式，支持运行中切换
      const canUseTool = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
        const currentMode = getPermissionMode()

        // ── 参数校验守卫（所有模式、所有工具，优先于权限检查） ──
        const validationFailure = validateToolInput(toolName, input)
        if (validationFailure) {
          console.warn(`[Agent 工具验证] 参数缺失: tool=${toolName}, mode=${currentMode}`)
          return validationFailure
        }

        // ── Write 大文件 token 截断防护 ──
        if (toolName === 'Write' && typeof input.content === 'string') {
          const estimatedTokens = estimateTokenCount(input.content)
          if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
            console.warn(
              `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`,
            )
            return {
              behavior: 'deny' as const,
              message:
                `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` +
                `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
            }
          }
        }

        // ── EnterPlanMode / ExitPlanMode 处理 ──

        // 完全自动模式：透明化（用户选择了完全信任 Agent）
        if (currentMode === 'bypassPermissions' && (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode')) {
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // ExitPlanMode：只有 Agent 确实进入过 Plan 模式才走审批，否则静默放行
        if (toolName === 'ExitPlanMode') {
          console.log(`[canUseTool] ExitPlanMode: signal.aborted=${options.signal.aborted}, planModeEntered=${planModeEntered}, mode=${currentMode}`)
          if (!planModeEntered) {
            return { behavior: 'allow' as const, updatedInput: input }
          }
          const result = await handleExitPlanMode(input, options.signal)
          if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
            // 更新 Map，后续 canUseTool 调用使用新模式
            this.sessionPermissionModes.set(sessionId, result.targetMode)
            planModeEntered = false
            // 同步通知 SDK 侧切换权限模式
            if (this.adapter.setPermissionMode) {
              this.adapter.setPermissionMode(sessionId, result.targetMode).catch((err: unknown) => {
                console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
              })
            }
          }
          return result
        }

        // EnterPlanMode：标记进入状态，通知渲染进程
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId } })
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // AskUserQuestion：始终走交互式问答流程，不受权限模式影响
        if (toolName === 'AskUserQuestion') {
          return askUserService.handleAskUserQuestion(
            sessionId, input, options.signal,
            (request: AskUserRequest) => {
              this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'ask_user_request', request } })
            },
          )
        }

        // ── 普通工具的权限分派 ──

        switch (currentMode) {
          case 'bypassPermissions':
            return { behavior: 'allow' as const, updatedInput: input }

          case 'plan': {
            // Plan 模式：只允许只读工具 + Write 到 .context/plan/ 目录
            if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            // 允许 Write 到 .context/plan/ 目录（Proma 自定义路径）
            // 以及 .context/ 下直接子文件 .md（SDK 生成的 plan 文件如 .context/<slug>.md）
            if (toolName === 'Write') {
              const filePath = typeof input.file_path === 'string' ? input.file_path : ''
              if (filePath.includes('.context/plan/')) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
              // SDK plan 文件：.context/<slug>.md — 仅允许直接子文件，防止 path traversal
              const ctxIdx = filePath.lastIndexOf('.context/')
              if (ctxIdx !== -1) {
                const afterCtx = filePath.substring(ctxIdx + '.context/'.length)
                if (afterCtx.endsWith('.md') && !afterCtx.includes('/') && !afterCtx.includes('..')) {
                  return { behavior: 'allow' as const, updatedInput: input }
                }
              }
            }
            // Bash 工具：只读命令（find、grep、cat 等）允许执行，写操作拒绝
            if (toolName === 'Bash') {
              const command = typeof input.command === 'string' ? input.command : ''
              if (isBashCommandReadOnly(command)) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
              return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
            }
            // MCP 工具（以 mcp__ 开头）允许调用（调研用）
            if (toolName.startsWith('mcp__')) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            // 其余工具拒绝
            return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
          }

          case 'acceptEdits':
            return acceptEditsCanUseTool(toolName, input, options)

          default:
            return { behavior: 'allow' as const, updatedInput: input }
        }
      }

      // 13. 构建 Adapter 查询选项
      // 检测用户选用的模型是否为 Claude 系列，决定 SubAgent 是否使用独立模型分层
      const claudeAvailable = (modelId || DEFAULT_MODEL_ID).toLowerCase().includes('claude')
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
        sdkPermissionMode: initialPermissionMode,
        // 当提供 canUseTool 回调时必须为 false，否则 CLI 同时收到
        // --allow-dangerously-skip-permissions 和 --permission-prompt-tool stdio
        // 两个矛盾的指令，导致 ExitPlanMode/AskUserQuestion 等交互式工具失败。
        // canUseTool 已完整处理所有权限模式（plan/acceptEdits/bypassPermissions），
        // Worker 子代理在 bypassPermissions 模式下也会被自动放行。
        allowDangerouslySkipPermissions: !canUseTool,
        canUseTool,
        ...(initialPermissionMode === 'acceptEdits' && { allowedTools: [...SAFE_TOOLS] }),
        // claude_code preset 提供基础环境信息（platform/shell/OS/git/model/知识截止日期等）
        // buildSystemPrompt 追加 Proma 特有指令（角色定义、SubAgent 策略、工作区信息等）
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: buildSystemPrompt({
            workspaceName: workspace?.name,
            workspaceSlug,
            sessionId,
            permissionMode: initialPermissionMode,
            memoryEnabled: (() => { const mc = getMemoryConfig(); return mc.enabled && !!mc.apiKey })(),
            claudeAvailable,
          }),
        },
        resumeSessionId: existingSdkSessionId,
        // 回退后 resume：从指定消息处继续（SDK 在同一 JSONL 内创建分支）
        ...(rewindResumeAt && { resumeSessionAt: rewindResumeAt }),
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(workspaceSlug && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(workspaceSlug) }] }),
        // 合并用户附加目录 + 工作区附加目录 + 工作区文件目录
        ...(() => {
          const allDirs = [...(additionalDirectories || [])]
          if (workspaceSlug) {
            // 工作区级附加目录
            const workspaceDirs = getWorkspaceAttachedDirectories(workspaceSlug)
            for (const dir of workspaceDirs) {
              if (!allDirs.includes(dir)) allDirs.push(dir)
            }
            // 工作区文件目录
            const wsFilesDir = getWorkspaceFilesDir(workspaceSlug)
            if (!allDirs.includes(wsFilesDir)) {
              allDirs.push(wsFilesDir)
            }
          }
          return allDirs.length > 0 ? { additionalDirectories: allDirs } : {}
        })(),
        // 启用文件检查点，支持 rewindFiles 回退
        enableFileCheckpointing: true,
        // SDK 0.2.52+ 新增选项（从 settings 读取）
        ...(appSettings.agentThinking && { thinking: appSettings.agentThinking }),
        effort: appSettings.agentEffort ?? 'high',
        ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && {
          maxBudgetUsd: appSettings.agentMaxBudgetUsd,
        }),
        // 内置 SubAgent 定义（code-reviewer / explorer / researcher）
        // claudeAvailable=false 时 SubAgent 省略 model 字段，自动继承主 Agent 模型
        agents: buildBuiltinAgents(claudeAvailable),
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
              // 验证保存是否成功
              const verifyMeta = getAgentSessionMeta(sessionId)
              console.log(`[Agent 编排] 验证读回: sdkSessionId=${verifyMeta?.sdkSessionId || '空'}`)
            } catch (err) {
              console.error(`[Agent 编排] 保存 SDK session_id 失败:`, err)
            }
          }

          // SDK 初始化完成后立即触发标题生成，使多会话并发时用户能快速区分
          if (!titleGenerationStarted) {
            titleGenerationStarted = true
            this.autoGenerateTitle(sessionId, userMessage, channelId, resolvedModel, callbacks)
              .catch((err) => console.error('[Agent 编排] 标题生成未捕获异常:', err))
          }
        },
        onModelResolved: (model: string) => {
          resolvedModel = model
          console.log(`[Agent 编排] SDK 确认模型: ${resolvedModel}`)
          // 通知渲染进程更新流式状态中的模型信息
          this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'model_resolved', model } })
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

      const queryStartedAt = Date.now()

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
            kind: 'proma_event',
            event: { type: 'retry', status: 'starting', attempt: attempt - 1, maxAttempts: MAX_AUTO_RETRIES, delaySeconds: delaySec, reason: lastRetryableError ?? '未知错误' },
          })
          this.eventBus.emit(sessionId, {
            kind: 'proma_event',
            event: { type: 'retry', status: 'attempt', attemptData },
          })

          console.log(`[Agent 编排] 第 ${attempt - 1} 次重试，等待 ${delaySec}s...`)
          await new Promise((r) => setTimeout(r, delayMs))

          // 等待期间如果会话被中止，退出
          if (!this.activeSessions.has(sessionId)) {
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: runGeneration })
            return
          }
        }

        let shouldRetryFromError = false

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

          // 手动事件循环：Promise.race（SDKMessage vs Watchdog 中断）
          let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
          // Teams 活跃时延迟 result 消息，避免前端提前标记 teammates 为 stopped
          let deferredResultMessage: SDKMessage | null = null
          // 捕获 result.subtype 以传递给前端（用于区分 success/error_max_turns/error_max_budget_usd）
          let capturedResultSubtype: string | undefined

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
              pendingNext?.catch(() => {})
              pendingNext = null
              const returnPromise = queryIterator.return?.(undefined as never).catch(() => {})
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
            const msg = iterResult.value

            // 检测 assistant 消息中的 SDK 错误
            if (msg.type === 'assistant') {
              const assistantMsg = msg as SDKAssistantMessage
              if (assistantMsg.error) {
                const { detailedMessage, originalError } = extractErrorDetails(assistantMsg as unknown as Parameters<typeof extractErrorDetails>[0])
                let errorCode = assistantMsg.error.errorType || 'unknown_error'
                if (isPromptTooLongError(detailedMessage, originalError)) {
                  errorCode = 'prompt_too_long'
                }
                const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

                // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
                if (isSessionNotFoundError(detailedMessage, originalError) && existingSdkSessionId && attempt <= MAX_AUTO_RETRIES) {
                  existingSdkSessionId = undefined
                  lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
                  shouldRetryFromError = true
                  break
                }

                // Proma 官方渠道认证失败：刷新 token + 重获取 System Key 后重试
                if (typedError.code === 'invalid_api_key' && channel.provider === 'proma' && attempt <= MAX_AUTO_RETRIES) {
                  console.log(`[Agent 编排] Proma 认证失败: ${typedError.message}`)
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
                      lastRetryableError = typedError.message
                      console.warn('[Agent 编排] Proma token 刷新失败')
                    }
                  } catch (refreshError) {
                    lastRetryableError = typedError.message
                    console.warn('[Agent 编排] Proma 凭证刷新异常:', refreshError)
                  }
                  this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                  accumulatedMessages.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 判断是否可自动重试
                if (isAutoRetryableTypedError(typedError) && attempt <= MAX_AUTO_RETRIES) {
                  lastRetryableError = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                  console.log(`[Agent 编排] 可重试错误 (assistant error): ${typedError.code} - ${lastRetryableError}`)
                  this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                  accumulatedMessages.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 不可重试 → 终止
                this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)

                const errorContent = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                const errorSDKMsg: SDKMessage = {
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: errorContent }],
                  },
                  parent_tool_use_id: null,
                  error: { message: typedError.message, errorType: typedError.code },
                  _createdAt: Date.now(),
                  _errorCode: typedError.code,
                  _errorTitle: typedError.title,
                  _errorDetails: typedError.details,
                  _errorCanRetry: typedError.canRetry,
                  _errorActions: typedError.actions,
                } as unknown as SDKMessage
                appendSDKMessages(sessionId, [errorSDKMsg])
                console.log(`[Agent 编排] 已保存 TypedError 消息: ${typedError.code} - ${typedError.title}`)

                // 如果之前有重试记录，发送 retry_failed
                if (attempt > 1 && lastRetryableError) {
                  this.eventBus.emit(sessionId, {
                    kind: 'proma_event',
                    event: { type: 'retry', status: 'failed', attemptData: { attempt: attempt - 1, timestamp: Date.now(), reason: lastRetryableError, errorMessage: typedError.message, delaySeconds: 0 } },
                  })
                }

                // 透传错误消息到前端
                this.eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
                // 清理 Watchdog
                if (!loopAbort.signal.aborted) loopAbort.abort()
                await watchdogDone
                try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
                callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: runGeneration })
                return
              }
            }

            // 累积 assistant 和 user 消息用于持久化
            // - 跳过 replay 消息，避免 resume 时重复写入
            // - 对 user 消息，仅累积含 tool_result 的（初始用户消息已在步骤 5 手动持久化）
            // - 对 system 消息，仅累积 compact_boundary（上下文压缩分界线需要持久化显示）
            if (msg.type === 'assistant' || msg.type === 'user' || msg.type === 'result') {
              const msgRecord = msg as Record<string, unknown>
              if (!msgRecord.isReplay) {
                if (msg.type === 'user') {
                  // 仅累积包含 tool_result 的 user 消息（跳过 SDK 重新发出的初始用户消息）
                  const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
                  const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
                  if (hasToolResult) {
                    accumulatedMessages.push(msg)
                  }
                } else {
                  // 为 assistant 消息注入渠道 modelId，确保持久化后能正确匹配模型显示名
                  if (msg.type === 'assistant' && modelId) {
                    (msg as Record<string, unknown>)._channelModelId = modelId
                  }
                  accumulatedMessages.push(msg)
                }
              }
            } else if (msg.type === 'system') {
              const sysMsg = msg as import('@proma/shared').SDKSystemMessage
              if (sysMsg.subtype === 'compact_boundary') {
                accumulatedMessages.push(msg)
              }
            }

            // Turn 结束时：持久化累积消息
            if (msg.type === 'result') {
              capturedResultSubtype = (msg as { subtype?: string }).subtype
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              accumulatedMessages.length = 0
            }

            // 过滤 SDK 内部生成的 user 消息（如 Skill 展开文本），避免在前端渲染为用户消息
            // 仅允许含 tool_result 的 user 消息通过（这些是工具调用的响应，需要展示）
            // 初始用户消息已通过前端乐观注入显示，无需 SDK 重复推送
            let shouldEmit = true
            if (msg.type === 'user') {
              const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
              const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
              if (!hasToolResult) {
                shouldEmit = false
              }
            }

            // Agent Teams: 当有 teammate 活跃时，延迟 result 消息
            if (!shouldEmit) {
              // 跳过 SDK 内部 user 消息的前端推送
            } else if (msg.type === 'result' && startedTaskIds.size > 0) {
              console.log(`[Agent 编排] 延迟 result 消息（${startedTaskIds.size} 个 teammate 活跃）`)
              deferredResultMessage = msg
            } else {
              this.eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
            }

            // Agent Teams: 追踪 teammate 任务状态（从 system 消息中）
            if (msg.type === 'system') {
              const sysMsg = msg as import('@proma/shared').SDKSystemMessage
              if (
                sysMsg.subtype === 'task_started' &&
                sysMsg.task_id &&
                (sysMsg.task_type === 'local_agent' || sysMsg.task_type === 'remote_agent')
              ) {
                startedTaskIds.add(sysMsg.task_id)
              } else if (sysMsg.subtype === 'task_notification' && sysMsg.task_id) {
                completedTaskIds.add(sysMsg.task_id)
                if (sysMsg.summary) {
                  taskNotificationSummaries.push({
                    taskId: sysMsg.task_id,
                    status: (sysMsg.status as 'completed' | 'failed' | 'stopped') || 'completed',
                    summary: sysMsg.summary,
                    outputFile: sysMsg.output_file,
                  })
                }
              }
            }
          }

          // 清理 Watchdog（事件循环正常结束或被 Watchdog 中断）
          if (!loopAbort.signal.aborted) loopAbort.abort()
          await watchdogDone

          if (abortedByWatchdog) {
            console.log(`[Agent 编排] Watchdog 中断了事件循环，将触发 auto-resume`)
          }

          // 错误 break 触发了 → 继续循环
          if (shouldRetryFromError) {
            continue
          }

          // 正常完成 — 如果之前有重试，发送 retry_cleared
          if (attempt > 1) {
            this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'retry', status: 'cleared' } })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)

          // 16. Agent Teams Auto-Resume：teammates 完成后自动收集结果并汇总
          console.log(`[Agent 编排] Auto-resume 条件检查: startedTasks=${startedTaskIds.size}, sdkSession=${!!capturedSdkSessionId}, active=${this.activeSessions.has(sessionId)}`)
          if (startedTaskIds.size > 0 && capturedSdkSessionId && this.activeSessions.has(sessionId)) {
            console.log(`[Agent 编排] Agent Teams 检测到 ${startedTaskIds.size} 个 teammate，启动 auto-resume`)

            // 通知前端：正在收集 teammate 结果
            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'waiting_resume', message: '正在收集 teammate 工作结果...' },
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
              this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'resume_start', messageId: resumeMessageId } })

              // 创建 resume 查询（使用相同的 SDK session ID）
              const resumeMessages: SDKMessage[] = []

              try {
                const resumeOptions: ClaudeAgentQueryOptions = {
                  ...queryOptions,
                  prompt: resumePrompt,
                  resumeSessionId: capturedSdkSessionId,
                }

                for await (const resumeMsg of this.adapter.query(resumeOptions)) {
                  if (!this.activeSessions.has(sessionId)) break

                  // 跳过 replay 消息，仅累积新产生的消息
                  const resumeMsgRecord = resumeMsg as Record<string, unknown>
                  if ((resumeMsg.type === 'assistant' || resumeMsg.type === 'user') && !resumeMsgRecord.isReplay) {
                    resumeMessages.push(resumeMsg)
                  } else if (resumeMsg.type === 'system' && (resumeMsg as import('@proma/shared').SDKSystemMessage).subtype === 'compact_boundary') {
                    resumeMessages.push(resumeMsg)
                  }
                  this.eventBus.emit(sessionId, { kind: 'sdk_message', message: resumeMsg })
                }

                // 持久化 resume 助手消息
                if (resumeMessages.length > 0) {
                  this.persistSDKMessages(sessionId, resumeMessages, Date.now() - queryStartedAt)
                }

                console.log(`[Agent 编排] Auto-resume 完成`)
              } catch (resumeError) {
                console.error('[Agent 编排] Auto-resume 失败:', resumeError)
              }
            } else if (!resumePrompt) {
              console.log('[Agent 编排] 无可用的 resume 内容（inbox 和 summaries 均为空）')
            }
          }
          try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }

          // 发射延迟的 result 消息（auto-resume 已完成，前端可安全处理）
          if (deferredResultMessage) {
            console.log(`[Agent 编排] 发射延迟的 result 消息`)
            this.eventBus.emit(sessionId, { kind: 'sdk_message', message: deferredResultMessage })
          }

          // Plan 模式：Agent 完成规划后注入"接受计划"建议
          if (initialPermissionMode === 'plan' && planModeEntered && this.activeSessions.has(sessionId)) {
            this.eventBus.emit(sessionId, {
              kind: 'sdk_message',
              message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage,
            })
            console.log(`[Agent 编排] Plan 模式：已注入计划确认建议`)
          }

          // 发送完成信号
          callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: runGeneration, resultSubtype: capturedResultSubtype })

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
            const wasStoppedByUser = this.stoppedBySessions.delete(sessionId)
            console.log(`[Agent 编排] 会话 ${sessionId} 已被用户中止`)
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            // 持久化中断状态到会话 meta
            try { updateAgentSessionMeta(sessionId, { stoppedByUser: wasStoppedByUser }) } catch { /* 会话可能已删除 */ }
            callbacks.onComplete(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: runGeneration })
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''

          // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
          if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingSdkSessionId && attempt <= MAX_AUTO_RETRIES) {
            existingSdkSessionId = undefined
            lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

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
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            accumulatedMessages.length = 0
            stderrChunks.length = 0
            continue
          }

          // Proma 官方渠道 402：额度不足，标记为计费错误（在聊天内显示，不弹模态框）
          const isBillingError = apiError?.statusCode === 402 && channel.provider === 'proma'
          if (isBillingError) {
            console.log(`[Agent 编排] Proma 额度不足 (402)，将在聊天内显示充值提示`)
          }

          // 判断是否可重试
          if (isAutoRetryableCatchError(apiError, rawErrorMessage) && attempt <= MAX_AUTO_RETRIES) {
            lastRetryableError = apiError
              ? `API Error ${apiError.statusCode}: ${apiError.message}`
              : (error instanceof Error ? error.message : '未知错误')
            console.log(`[Agent 编排] 可重试错误 (catch): ${lastRetryableError}`)
            // 保存部分内容
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            accumulatedMessages.length = 0
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 不可重试 — 走原有终止逻辑
          const errorMessage = error instanceof Error ? error.message : '未知错误'
          console.error(`[Agent 编排] 执行失败:`, error)

          // 保存已累积的部分内容
          if (accumulatedMessages.length > 0) {
            try {
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              console.log(`[Agent 编排] 已保存部分执行结果 (${accumulatedMessages.length} 条消息)`)
            } catch (saveError) {
              console.error('[Agent 编排] 保存部分内容失败:', saveError)
            }
          }

          let userFacingError: string
          if (isBillingError) {
            userFacingError = '余额不足，请充值后继续使用'
          } else if (apiError) {
            userFacingError = friendlyErrorMessage(`API 错误 (${apiError.statusCode}):\n${apiError.message}`)
          } else {
            // 没有解析到 API 错误时，把 stderr 内容附加上去（便于诊断 Windows exit code 1 等问题）
            const stderrSummary = stderrOutput
              ? `\n\n诊断信息:\n${stderrOutput.slice(0, 500)}${stderrOutput.length > 500 ? '...' : ''}`
              : ''
            userFacingError = friendlyErrorMessage(errorMessage) + stderrSummary
          }

          // 保存错误消息到 JSONL
          try {
            // 检测是否为 prompt too long 错误
            const isPromptTooLong = isPromptTooLongError(
              userFacingError,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              stderrOutput,
            )

            const errMsg: SDKMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: isBillingError
                  ? '余额不足，请充值后继续使用'
                  : isPromptTooLong
                    ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
                    : userFacingError }],
              },
              parent_tool_use_id: null,
              error: { message: userFacingError, errorType: isBillingError ? 'billing_error' : isPromptTooLong ? 'prompt_too_long' : 'unknown_error' },
              _createdAt: Date.now(),
              _errorCode: isBillingError ? 'billing_error' : isPromptTooLong ? 'prompt_too_long' : 'unknown_error',
              _errorTitle: isBillingError ? '余额不足' : isPromptTooLong ? '上下文过长' : '执行错误',
            } as unknown as SDKMessage
            appendSDKMessages(sessionId, [errMsg])
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有重试记录，发送 retry_failed
          if (attempt > 1 && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'retry', status: 'failed', attemptData: { attempt: attempt - 1, timestamp: Date.now(), reason: lastRetryableError, errorMessage: userFacingError, delaySeconds: 0 } },
            })
          }

          callbacks.onError(userFacingError)
          callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: runGeneration })

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
          kind: 'proma_event',
          event: { type: 'retry', status: 'failed', attemptData: { attempt: MAX_AUTO_RETRIES, timestamp: Date.now(), reason: lastRetryableError, errorMessage: `重试 ${MAX_AUTO_RETRIES} 次后仍然失败`, delaySeconds: 0 } },
        })

        // 保存错误消息
        const retryErrorContent = `重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`
        const retryErrorSDKMsg: SDKMessage = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: retryErrorContent }],
          },
          parent_tool_use_id: null,
          error: { message: retryErrorContent, errorType: 'unknown_error' },
          _createdAt: Date.now(),
          _errorCode: 'unknown_error',
          _errorTitle: '重试失败',
        } as unknown as SDKMessage
        appendSDKMessages(sessionId, [retryErrorSDKMsg])

        callbacks.onError(`重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`)
        callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: runGeneration })
      }

    } finally {
      // 只在 generation 匹配时才清理，防止旧流的 finally 误删新流的注册
      if (this.activeSessions.get(sessionId) === runGeneration) {
        this.activeSessions.delete(sessionId)
        this.sessionPermissionModes.delete(sessionId)
        this.queuedMessageUuids.delete(sessionId)
      }
      permissionService.clearSessionPending(sessionId)
      askUserService.clearSessionPending(sessionId)
      exitPlanService.clearSessionPending(sessionId)
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
    this.sessionPermissionModes.delete(sessionId)
    this.stoppedBySessions.add(sessionId)
    this.queuedMessageUuids.delete(sessionId)
    this.adapter.abort(sessionId)
    console.log(`[Agent 编排] 已中止会话: ${sessionId}`)
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  /**
   * 运行中动态切换会话的权限模式
   *
   * 同时更新 Proma 侧（canUseTool 闭包读取的 Map）和 SDK 侧（query.setPermissionMode）。
   * 典型场景：用户在 Agent 运行中通过 PermissionModeSelector 切换模式。
   */
  async updateSessionPermissionMode(sessionId: string, mode: PromaPermissionMode): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return
    this.sessionPermissionModes.set(sessionId, mode)
    // 同步通知 SDK 侧
    if (this.adapter.setPermissionMode) {
      await this.adapter.setPermissionMode(sessionId, mode)
    }
    console.log(`[Agent 编排] 运行中权限模式已切换: sessionId=${sessionId}, mode=${mode}`)
  }

  // ===== 快照回退 =====

  /**
   * 回退会话到指定消息点
   *
   * 1. 直接从 SDK JSONL 的 file-history-snapshot 恢复文件到目标时刻的状态
   * 2. 截断 Proma JSONL 到 assistantMessageUuid（inclusive）
   * 3. 记录 resumeAtMessageUuid，下次发消息时 SDK 从该点分支继续
   *
   * 文件恢复通过解析 SDK JSONL 中的快照完成，无需运行中的 Query。
   * 文件恢复失败时仍然截断对话（优雅降级）。
   */
  async rewindSession(
    sessionId: string,
    assistantMessageUuid: string,
  ): Promise<RewindSessionResult> {
    // 0. 阻止运行中会话回退（JSONL 并发写入会损坏文件）
    if (this.activeSessions.has(sessionId)) {
      throw new Error('会话正在运行中，请停止后再回退')
    }

    const sessionMeta = getAgentSessionMeta(sessionId)
    if (!sessionMeta?.sdkSessionId) {
      throw new Error('会话没有 SDK session ID，无法回退')
    }

    // 0.5 从 SDK session JSONL 解析对应的 user message UUID（rewindFiles 需要）
    let projectDir: string | undefined
    let workspaceSlug: string | undefined
    if (sessionMeta.workspaceId) {
      const ws = getAgentWorkspace(sessionMeta.workspaceId)
      if (ws) {
        workspaceSlug = ws.slug
        projectDir = getAgentSessionWorkspacePath(ws.slug, sessionMeta.id)
      }
    }
    const userMessageUuid = resolveUserUuidFromSDK(sessionMeta.sdkSessionId, assistantMessageUuid, projectDir, sessionMeta.forkSourceSdkSessionId)
    console.log(`[Agent 编排] 回退: 解析 user uuid=${userMessageUuid || '未找到'} (assistant uuid=${assistantMessageUuid}, forkSource=${sessionMeta.forkSourceSdkSessionId ?? 'none'})`)

    // 1. 文件恢复：直接从 SDK JSONL 的 file-history-snapshot 恢复，无需临时 Query
    let fileRewindResult: { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number } | undefined
    if (userMessageUuid === '__LAST_TURN__') {
      // 最后一个 turn：当前文件系统已是该 turn 完成后的状态，无需回退文件
      console.log(`[Agent 编排] 回退: 最后一个 turn，跳过文件恢复`)
      fileRewindResult = { canRewind: true, filesChanged: [] }
    } else if (userMessageUuid) {
      try {
        // 确定 cwd（文件的基准路径）
        let cwd = homedir()
        if (projectDir) cwd = projectDir
        // 收集附加目录（与发消息时相同的来源：工作区附加目录 + 工作区文件目录）
        const rewindAttachedDirs: string[] = []
        if (workspaceSlug) {
          rewindAttachedDirs.push(...getWorkspaceAttachedDirectories(workspaceSlug))
          rewindAttachedDirs.push(getWorkspaceFilesDir(workspaceSlug))
        }
        console.log(`[Agent 编排] 回退: 直接从 snapshot 恢复文件 (cwd=${cwd}, forkSource=${sessionMeta.forkSourceSdkSessionId ?? 'none'}, attachedDirs=${rewindAttachedDirs.length})`)
        fileRewindResult = rewindFilesFromSnapshot(sessionMeta.sdkSessionId, userMessageUuid, cwd, projectDir, sessionMeta.forkSourceSdkSessionId, rewindAttachedDirs)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.warn('[Agent 编排] 文件恢复失败，继续截断对话:', errMsg)
        if (err instanceof Error && err.stack) console.warn('[Agent 编排] 文件恢复错误堆栈:', err.stack)
        fileRewindResult = { canRewind: false, error: errMsg }
      }
    } else {
      fileRewindResult = { canRewind: false, error: '无法从 SDK session 中解析 user message UUID' }
    }

    // 2. 截断 Proma JSONL
    const kept = truncateSDKMessages(sessionId, assistantMessageUuid)

    // 3. 记录 resumeAtMessageUuid，下次发消息时 SDK 从此点继续
    updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: assistantMessageUuid })

    console.log(`[Agent 编排] 回退完成: sessionId=${sessionId}, 保留 ${kept.length} 条消息, 文件恢复=${fileRewindResult?.canRewind ?? '跳过'}`)

    return {
      remainingMessages: kept.length,
      fileRewind: fileRewindResult,
    }
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.activeSessions.size === 0) return
    console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    this.adapter.dispose()
    this.activeSessions.clear()
    this.sessionPermissionModes.clear()
    this.queuedMessageUuids.clear()
  }

  // ===== 队列消息管理 =====

  /**
   * 流式追加消息
   *
   * 在 Agent 运行中注入用户消息到 SDK，使用 'now' 优先级立即处理。
   * 消息立即持久化到 JSONL。
   *
   * @returns 消息 UUID
   */
  async queueMessage(
    sessionId: string,
    text: string,
    _priority?: string,
    presetUuid?: string,
  ): Promise<string> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`[Agent 编排] 会话未运行，无法追加消息: ${sessionId}`)
    }

    if (!this.adapter.sendQueuedMessage) {
      throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
    }

    const uuid = presetUuid || randomUUID()

    // 防重记录
    const uuids = this.queuedMessageUuids.get(sessionId) ?? new Set<string>()
    uuids.add(uuid)
    this.queuedMessageUuids.set(sessionId, uuids)

    // 构造 SDKUserMessage 并注入（强制 'now' 优先级）
    const sdkMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
      parent_tool_use_id: null,
      priority: 'now' as const,
      uuid,
      session_id: sessionId,
    }

    try {
      await this.adapter.sendQueuedMessage(sessionId, sdkMessage)
      console.log(`[Agent 编排] 追加消息已注入: sessionId=${sessionId}, uuid=${uuid}`)

      // 立即持久化到 JSONL
      const persistMsg: SDKMessage = {
        type: 'user',
        uuid,
        message: {
          content: [{ type: 'text', text }],
        },
        parent_tool_use_id: null,
        _createdAt: Date.now(),
      } as unknown as SDKMessage
      appendSDKMessages(sessionId, [persistMsg])
    } catch (error) {
      uuids.delete(uuid)
      throw error
    }

    return uuid
  }
}