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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { app } from 'electron'
import type { AgentSendInput, AgentEvent, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, AgentSessionMeta, TypedError, RetryAttempt, SDKMessage, SDKAssistantMessage, AgentStreamPayload, RewindSessionResult, SdkBeta, ProviderType } from '@proma/shared'
import {
  PROMA_DEFAULT_PERMISSION_MODE,
  PROMA_PERMISSION_MODE_CONFIG,
  SAFE_TOOLS,
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  THINKING_SIGNATURE_ERROR_TITLE,
} from '@proma/shared'
import type { PermissionRequest, PromaPermissionMode, AskUserRequest, ExitPlanModeRequest } from '@proma/shared'
import type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter'
import { isPromptTooLongError, isThinkingSignatureError, friendlyErrorMessage, mapSDKErrorToTypedError, extractErrorDetails, shouldKeepChannelOpen } from './adapters/claude-agent-adapter'
import { isTransientNetworkError } from './error-patterns'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById, listChannels } from './channel-manager'
import { getSystemApiKey, clearSystemKeyCache } from './cloud-channel-service'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { getAdapter, fetchTitle, normalizeAnthropicBaseUrlForSdk } from '@proma/core'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, getAgentSessionSDKMessages, truncateSDKMessages, resolveUserUuidFromSDK, rewindFilesFromSnapshot } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getSdkConfigDir, getWorkspaceFilesDir, getConfigDirName } from './config-paths'
import { getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from './agent-workspace-manager'
import { getRuntimeStatus } from './runtime-init'
import { getSettings } from './settings-service'
import { buildSystemPrompt, buildDynamicContext, buildBuiltinAgents } from './agent-prompt-builder'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
import { getMemoryConfig } from './memory-service'
import { searchMemory, addMemory, formatSearchResult } from './memos-client'
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
  /** 用户消息已持久化，外部入口可据此通知前端切到实时会话 */
  onRunStarted?: (opts: { startedAt: number }) => void
}

// ===== 工具函数 =====

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
/** 从 stderr 中找到第一个完整的 JSON 对象（通过平衡括号匹配，支持嵌套）*/
function extractFirstJsonObject(text: string): object | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}" 或 "API error (attempt X/Y): 401 401 {...}"
  // 用平衡括号提取 JSON，支持 proma-api 的嵌套格式 {"type":"error","error":{...}}
  const statusMatch = stderr.match(/(\d{3})\s+\{/)
    ?? stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+\{/)
  if (statusMatch) {
    const statusCode = parseInt(statusMatch[1]!)
    if (statusCode >= 400 && statusCode < 600) {
      const jsonStart = stderr.indexOf('{', statusMatch.index! + statusMatch[0]!.length - 1)
      const errorObj = extractFirstJsonObject(stderr.slice(jsonStart))
      if (errorObj) {
        const obj = errorObj as Record<string, unknown>
        const nested = obj.error as Record<string, unknown> | undefined
        const message = (nested?.message as string) || (obj.message as string) || '未知错误'
        return { statusCode, message }
      }
    }
  }

  // 模式 2：直接的状态码 + 消息
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

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式 / 瞬时网络错误） */
function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
  stderr?: string,
): boolean {
  if (apiError) {
    // 529 是 Anthropic 的过载状态码，通常很快恢复；与 429 / 5xx 一并重试。
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  // 兜底：extractApiError 未识别但 stderr / 错误文本中包含 502 / 529 或 overloaded 关键字时也视为可重试
  // 502 (Bad Gateway) 通常是上游网关瞬时异常，与 529 一样很快自行恢复
  const text = `${rawErrorMessage ?? ''}\n${stderr ?? ''}`
  if (/\b502\b|\b529\b|overloaded/i.test(text)) return true
  // 瞬时网络错误（terminated / ECONNRESET / socket hang up 等）
  if (isTransientNetworkError(rawErrorMessage, stderr)) return true
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
const MAX_AUTO_RETRIES = 25

/** 自动重试累计等待预算（毫秒） */
const MAX_AUTO_RETRY_WAIT_MS = 5 * 60_000

/** 重试单次延迟上限（毫秒） */
const RETRY_MAX_DELAY_MS = 15_000

/**
 * 计算重试延迟（指数退避 + ±20% jitter）
 *
 * 基础序列：1s, 2s, 4s, 8s, 15s, 15s...（cap = 15s）
 * 叠加 ±20% 随机抖动，避免大量 session 同时重试造成惊群。
 * 累计等待会被限制在 5 分钟以内。
 */
function getRetryDelayMs(attempt: number, elapsedRetryDelayMs: number): number {
  const remainingMs = MAX_AUTO_RETRY_WAIT_MS - elapsedRetryDelayMs
  if (remainingMs <= 0) return 0

  const base = Math.min(1000 * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
  const jitter = base * (Math.random() * 0.4 - 0.2)
  return Math.min(remainingMs, Math.max(0, Math.round(base + jitter)))
}

/**
 * 解析 SDK native CLI binary 路径
 *
 * 0.2.113+ 起 SDK 改为按平台分发 native binary，通过 optionalDependencies 安装到
 * `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` 子包，与主包 `@anthropic-ai/claude-agent-sdk`
 * 同级。binary 名 macOS/Linux 为 `claude`，Windows 为 `claude.exe`。
 *
 * SDK 作为 esbuild external 依赖，require.resolve 可在运行时解析主包入口路径，
 * 再沿父目录 `@anthropic-ai/` 找到同级的平台子包。
 *
 * 多种策略降级：createRequire → 全局 require → cwd/node_modules 手动查找
 * 打包环境下：asar 内的路径需要转换为 asar.unpacked 路径（即便 Proma 当前 `asar: false`
 * 兜底不伤人）。
 */
function resolveSDKCliPath(): string {
  const subpkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  let binaryPath: string | null = null

  // 策略 1：createRequire（标准 ESM/CJS 互操作）
  try {
    const cjsRequire = createRequire(__filename)
    const sdkEntryPath = cjsRequire.resolve('@anthropic-ai/claude-agent-sdk')
    // sdkEntryPath: .../@anthropic-ai/claude-agent-sdk/sdk.mjs
    // anthropicDir:  .../@anthropic-ai
    const anthropicDir = dirname(dirname(sdkEntryPath))
    binaryPath = join(anthropicDir, subpkg, binaryName)
    console.log(`[Agent 编排] SDK binary 路径 (createRequire): ${binaryPath}`)
  } catch (e) {
    console.warn('[Agent 编排] createRequire 解析 SDK 路径失败:', e)
  }

  // 策略 2：全局 require（esbuild CJS bundle 可能保留）
  if (!binaryPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdkEntryPath = require.resolve('@anthropic-ai/claude-agent-sdk')
      const anthropicDir = dirname(dirname(sdkEntryPath))
      binaryPath = join(anthropicDir, subpkg, binaryName)
      console.log(`[Agent 编排] SDK binary 路径 (require.resolve): ${binaryPath}`)
    } catch (e) {
      console.warn('[Agent 编排] require.resolve 解析 SDK 路径失败:', e)
    }
  }

  // 策略 3：从当前模块目录手动查找（打包后 __dirname 指向 app/dist/，上一级即 app/）
  // 注意：不使用 process.cwd()，因为打包后的 Electron 应用 cwd 通常是 '/'
  // 或用户主目录，与 app 安装目录无关。
  if (!binaryPath) {
    binaryPath = join(__dirname, '..', 'node_modules', '@anthropic-ai', subpkg, binaryName)
    console.log(`[Agent 编排] SDK binary 路径 (手动): ${binaryPath}`)
  }

  // 打包环境：将 .asar/ 路径转换为 .asar.unpacked/
  if (app.isPackaged && binaryPath.includes('.asar')) {
    binaryPath = binaryPath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
    console.log(`[Agent 编排] 转换为 asar.unpacked 路径: ${binaryPath}`)
  }

  return binaryPath
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
    ? `\n<session_info>\nSession ID: ${sessionId}\nSession CWD: ${sessionHint.agentCwd}\nNote: 上方为近期对话摘要。如需更多上下文，可读取 ~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl 获取完整历史。\n</session_info>\n`
    : ''

  console.log(`[Agent 编排] buildContextPrompt: 读取 ${allMessages.length} 条消息，注入 ${lines.length} 条历史${sessionHint ? '（含 session 元信息）' : ''}`)
  return `<conversation_history>${sessionInfoBlock}\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}

/**
 * 构建 Session 恢复 prompt
 *
 * 当 SDK resume 失败（session 过期、thinking signature 不兼容等）时，
 * 注入 <session_recovery> 标签指向当前会话的完整 JSONL 历史文件，
 * 让 Agent 自己读取完整历史后无缝继续工作。
 */
function buildRecoveryPrompt(
  sessionId: string,
  currentUserMessage: string,
  sessionHint: { agentCwd: string },
): string {
  const meta = getAgentSessionMeta(sessionId)
  const title = meta ? escapeContextAttr(meta.title) : sessionId
  const historyPath = `~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl`

  const recoveryBlock =
    `<session_recovery>\n` +
    `你正在接续一个已有的 Agent 会话（因模型切换等原因需要重新建立连接）。\n` +
    `当前会话的完整历史记录在下方路径中，请先读取它以恢复上下文，然后继续处理用户的最新请求。\n` +
    `<session id="${sessionId}" title="${title}" cwd="${sessionHint.agentCwd}">\n` +
    `History path: ${historyPath}\n` +
    `</session>\n` +
    `</session_recovery>`

  console.log(`[Agent 编排] buildRecoveryPrompt: 注入 session 自引用 → ${historyPath}`)
  return `${recoveryBlock}\n\n${currentUserMessage}`
}

function escapeContextAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildReferencedSessionsPrompt(
  currentSessionId: string,
  mentionedSessionIds?: string[],
  workspaceId?: string,
): string {
  const uniqueIds = [...new Set((mentionedSessionIds ?? []).filter(Boolean))]
  if (uniqueIds.length === 0) return ''

  const currentWorkspaceId = workspaceId ?? getAgentSessionMeta(currentSessionId)?.workspaceId
  const sessionBlocks: string[] = []

  for (const referencedSessionId of uniqueIds) {
    if (referencedSessionId === currentSessionId) continue

    const meta = getAgentSessionMeta(referencedSessionId)
    if (!meta || meta.archived) continue
    if (currentWorkspaceId && meta.workspaceId !== currentWorkspaceId) continue

    const title = escapeContextAttr(meta.title)
    const historyPath = `~/${getConfigDirName()}/agent-sessions/${referencedSessionId}.jsonl`
    sessionBlocks.push(
      `<session id="${referencedSessionId}" title="${title}" updatedAt="${meta.updatedAt}">\n` +
      `History path: ${historyPath}\n` +
      '</session>',
    )
  }

  if (sessionBlocks.length === 0) return ''

  return `<referenced_sessions>\n用户在消息中明确引用了以下同工作区 Agent 会话。不要假设这些会话的内容；需要上下文时，请先读取对应的 History path，再基于读取结果继续完成任务。\n${sessionBlocks.join('\n\n')}\n</referenced_sessions>`
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
const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

/**
 * 判断模型是否支持 1M context window beta（context-1m-2025-08-07）
 * 当前支持：Claude Sonnet 4 / 4.5 / 4.6、Opus 4.6 / 4.7、DeepSeek V4 系列
 * 参考：https://docs.anthropic.com/en/docs/build-with-claude/context-windows
 */
function supports1MContext(modelId: string): boolean {
  const m = modelId.toLowerCase()
  if (m.includes('haiku')) return false
  // Claude: Sonnet 4+ 与 Opus 4.6+ 都支持
  if (m.includes('claude')) {
    if (m.includes('sonnet-4')) return true
    if (m.includes('opus-4-6') || m.includes('opus-4-7')) return true
    return false
  }
  // DeepSeek V4 系列（deepseek-v4-pro、deepseek-v4-flash）
  if (m.includes('deepseek-v4')) return true
  return false
}

/**
 * 聚合一次 SDK 调用涉及的所有附加目录（去重，保持插入顺序）。
 *
 * 发消息（sendMessage）和回退恢复文件（rewindSession）必须使用同一份聚合结果，
 * 否则 SDK 写入 file-history-snapshot 时使用的目录范围，与回退时校验路径越界的目录范围不一致，
 * 会导致 attachedDirectories 内的文件在回退时被静默跳过（"会话回退、代码不回退"）。
 *
 * 来源：
 *   1. extraDirs：调用方传入的临时附加目录（例如 sendMessage 时用户当次提交的目录）
 *   2. 会话级 attachedDirectories + attachedFiles 的父目录
 *   3. 工作区级 attachedDirectories + attachedFiles 的父目录
 *   4. 工作区文件目录 workspace-files/
 */
function collectAttachedDirectories(params: {
  sessionMeta?: AgentSessionMeta
  workspaceSlug?: string
  extraDirs?: string[]
}): string[] {
  const { sessionMeta, workspaceSlug, extraDirs } = params
  const result: string[] = []
  const push = (dir: string | undefined | null) => {
    if (!dir) return
    if (!result.includes(dir)) result.push(dir)
  }

  for (const d of extraDirs ?? []) push(d)
  for (const d of sessionMeta?.attachedDirectories ?? []) push(d)
  for (const file of sessionMeta?.attachedFiles ?? []) push(dirname(file))

  if (workspaceSlug) {
    for (const d of getWorkspaceAttachedDirectories(workspaceSlug)) push(d)
    for (const f of getWorkspaceAttachedFiles(workspaceSlug)) push(dirname(f))
    push(getWorkspaceFilesDir(workspaceSlug))
  }

  return result
}

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
   * 对 Kimi Coding Plan / MiniMax Coding Plan：使用 Bearer 认证（ANTHROPIC_AUTH_TOKEN）。
   */
  private async buildSdkEnv(
    apiKey: string,
    baseUrl: string | undefined,
    provider: ProviderType,
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
      // 提升输出 token 上限，避免 "exceeded 32000 output token maximum" 错误
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
      // 启用 Tasks 功能
      CLAUDE_CODE_ENABLE_TASKS: 'true',
      // 禁用实验性 beta 功能，使用稳定模式
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      // 配置隔离：让 SDK 使用独立的配置目录，不读取用户的 ~/.claude.json
      CLAUDE_CONFIG_DIR: getSdkConfigDir(),
    }

    // 认证方式按 provider 分支
    // - Proma 官方渠道：AUTH_TOKEN（Bearer，商业版 Cloud 后端只认 Bearer）
    // - Kimi Coding Plan：只认 Bearer，且必须伪装成 coding agent（User-Agent）
    // - MiniMax Coding Plan：Claude Code 场景使用 Bearer（ANTHROPIC_AUTH_TOKEN）
    // - 通过 ANTHROPIC_AUTH_TOKEN 让 SDK 发 Authorization: Bearer；
    //   Kimi 额外通过 ANTHROPIC_CUSTOM_HEADERS 注入 User-Agent
    // - 其它：ANTHROPIC_API_KEY（SDK 内部会同时带上 x-api-key 和 Bearer）
    if (provider === 'proma') {
      sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
    } else if (provider === 'kimi-coding') {
      sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
      sdkEnv.ANTHROPIC_CUSTOM_HEADERS = 'User-Agent: KimiCLI/1.3'
    } else if (provider === 'minimax') {
      sdkEnv.ANTHROPIC_AUTH_TOKEN = apiKey
      sdkEnv.API_TIMEOUT_MS = '3000000'
      sdkEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    } else {
      sdkEnv.ANTHROPIC_API_KEY = apiKey
    }

    // 显式控制 ANTHROPIC_BASE_URL：
    // - Proma 渠道：上层已处理 sdkBaseUrl 的 /api/v1 剥离，这里直接透传，不再 normalize
    // - 其它渠道：使用 normalizeAnthropicBaseUrlForSdk 规范化，SDK 内部会自动拼接 /v1/messages
    if (baseUrl && baseUrl !== DEFAULT_ANTHROPIC_URL) {
      sdkEnv.ANTHROPIC_BASE_URL = provider === 'proma'
        ? baseUrl
        : normalizeAnthropicBaseUrlForSdk(baseUrl)
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

    // 针对 claude-agent-sdk 0.2.111+ 的 options.env 叠加语义加固：
    // SDK 将 options.env 叠加到 process.env 之上传递给子进程。
    // 若 shell 中存在 ANTHROPIC_CUSTOM_HEADERS、ANTHROPIC_MODEL 等变量，
    // 且 sdkEnv 未显式管理，叠加后会回流到 SDK 子进程。
    // 对于 sdkEnv 未显式管理的 ANTHROPIC_* 变量，显式置空字符串以覆盖回流。
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTHROPIC_') && !(key in sdkEnv)) {
        sdkEnv[key] = ''
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
   * 注入 Proma Cloud 凭据网关 MCP
   *
   * 为 Skill（如 proma-generate-image / proma-gpt-image-2）提供 Proma 开放 API 凭据。
   * 不依赖工作区配置，登录后即可使用。
   */
  private async injectPromaCloudMcp(
    sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
    mcpServers: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    try {
      const { injectPromaCloudMcpServer } = await import('./agent-mcps/proma-cloud-mcp')
      await injectPromaCloudMcpServer(sdk, mcpServers)
    } catch (err) {
      console.error(`[Agent 编排] 注入 Proma Cloud MCP 失败:`, err)
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
    return this.prepareResumeFallbackRecovery(
      sessionId,
      queryOptions,
      contextualMessage,
      agentCwd,
      accumulatedMessages,
      queryStartedAt,
      '检测到 session-not-found 错误，清除 sdkSessionId 并切换到上下文回填模式',
      'Session 已失效，切换到上下文回填模式',
    )
  }

  /**
   * Resume 失败恢复：清除 SDK resume 关系，注入 session 自引用让 Agent 读取完整历史继续工作。
   *
   * 适用于 SDK session 过期、thinking signature 跨模型不兼容等场景。
   * 使用 <session_recovery> 标签指向当前会话的 JSONL 历史文件，Agent 会自动读取并恢复上下文，
   * 比 buildContextPrompt（仅注入 20 条摘要）提供完整得多的上下文连续性。
   */
  private prepareResumeFallbackRecovery(
    sessionId: string,
    queryOptions: ClaudeAgentQueryOptions,
    contextualMessage: string,
    agentCwd: string,
    accumulatedMessages: SDKMessage[],
    queryStartedAt: number,
    logMessage: string,
    retryReason: string,
  ): string {
    console.log(`[Agent 编排] ${logMessage}`)
    // 先持久化当前已累积的消息，确保 JSONL 文件包含最新内容
    this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
    accumulatedMessages.length = 0
    // 清除失效的 SDK session，新 SDK 会话产生的 sdkSessionId 会通过 onSessionId 回调自动保存
    try { updateAgentSessionMeta(sessionId, { sdkSessionId: undefined }) } catch { /* 忽略 */ }
    queryOptions.resumeSessionId = undefined
    queryOptions.resumeSessionAt = undefined
    queryOptions.prompt = buildRecoveryPrompt(sessionId, contextualMessage, { agentCwd })
    return retryReason
  }

  /**
   * 持久化累积的 SDKMessage（Phase 4: 直接存储原始 SDKMessage）
   *
   * 只持久化 assistant、user、result 和需要长期可见的 system 消息
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
        || (m.type === 'system' && ['compact_boundary', 'permission_denied'].includes((m as import('@proma/shared').SDKSystemMessage).subtype ?? ''))
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
    const { sessionId, userMessage, channelId, modelId, workspaceId, additionalDirectories, customMcpServers, permissionModeOverride, mentionedSkills, mentionedMcpServers, mentionedSessionIds } = input
    const stderrChunks: string[] = []

    // 0. 并发保护
    if (this.activeSessions.has(sessionId)) {
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      callbacks.onComplete([], { startedAt: input.startedAt })
      return
    }

    // 0.5 清除上一轮中断标记
    try { updateAgentSessionMeta(sessionId, { stoppedByUser: false }) } catch { /* 会话可能已删除 */ }

    // 环境 / 配置类错误的统一上报：持久化为 TypedError 消息，由 SDKMessageRenderer 渲染
    const reportPreflightError = (typedError: TypedError) => {
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
      try { appendSDKMessages(sessionId, [errorSDKMsg]) } catch (e) {
        console.error('[Agent 编排] 持久化 preflight error 失败:', e)
      }
      callbacks.onError(errorContent)
      callbacks.onComplete([], { startedAt: input.startedAt })
    }

    // 1. Windows 平台：检查 Shell 环境可用性
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
        reportPreflightError({
          code: 'windows_shell_missing',
          title: 'Windows 环境未就绪',
          message:
            '需要 Git Bash 或 WSL 才能运行 Agent。建议安装 Git for Windows（自带 Git Bash），安装完成后点「打开环境检测」刷新状态。',
          details: [
            `Git Bash: ${shellStatus.gitBash?.error || '未检测到'}`,
            `WSL: ${shellStatus.wsl?.error || '未检测到'}`,
          ],
          actions: [
            { key: 'e', label: '打开环境检测', action: 'open_environment_check' },
            { key: 'g', label: '去官方下载 Git', action: 'open_external', payload: 'https://git-scm.com/download/win' },
          ],
          canRetry: false,
        })
        return
      }
    }

    // 2. 获取渠道信息并解密 API Key
    const channel = getChannelById(channelId)
    if (!channel) {
      reportPreflightError({
        code: 'channel_not_found',
        title: '渠道不存在',
        message: '当前会话引用的渠道已被删除或不可用，请在设置中重新选择。',
        actions: [
          { key: 's', label: '打开渠道设置', action: 'open_channel_settings' },
        ],
        canRetry: false,
      })
      return
    }

    // 2.1 立即抢占会话槽位（在所有同步检查通过后、第一个 await 之前）
    // 防止 buildSdkEnv 等 await 期间并发调用绕过上方的检查，导致多条重复消息写入 JSONL
    // finally 块会通过 generation 匹配来安全清理，不影响正常流程
    const runGeneration = Date.now()
    // 优先使用渲染进程传来的 startedAt（确保 STREAM_COMPLETE 竞态保护比较的是同一个值），
    // 否则用本地 runGeneration 作为回退（headless 模式等无渲染进程场景）
    const streamStartedAt = input.startedAt ?? runGeneration
    this.activeSessions.set(sessionId, runGeneration)
    const releaseActiveRun = (): void => {
      // 在发送 STREAM_COMPLETE 前释放 active slot，避免渲染进程已进入空闲态、
      // 主进程仍在 finally 前短暂拒绝下一条消息。
      if (this.activeSessions.get(sessionId) !== runGeneration) return
      this.activeSessions.delete(sessionId)
      this.sessionPermissionModes.delete(sessionId)
      this.queuedMessageUuids.delete(sessionId)
    }
    const completeRun = (
      messages?: AgentMessage[],
      opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string },
    ): void => {
      releaseActiveRun()
      callbacks.onComplete(messages, opts)
    }
    const failRun = (
      error: string,
      messages?: AgentMessage[],
      opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string },
    ): void => {
      releaseActiveRun()
      callbacks.onError(error)
      callbacks.onComplete(messages, opts)
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
            callbacks.onComplete([], { startedAt: streamStartedAt })
            return
          }
        } else {
          callbacks.onError('登录已过期，请重新登录')
          callbacks.onComplete([], { startedAt: streamStartedAt })
          return
        }
      }
    } else {
      try {
        apiKey = decryptApiKey(channelId)
      } catch {
        callbacks.onError('解密 API Key 失败')
        callbacks.onComplete([], { startedAt: streamStartedAt })
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
    delete process.env.ANTHROPIC_CUSTOM_HEADERS
    if (channel.provider === 'proma') {
      // Proma 官方渠道：Bearer 认证
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey
    } else if (channel.provider === 'kimi-coding') {
      // Kimi Coding Plan：只用 Bearer + 必须带 User-Agent
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey
      process.env.ANTHROPIC_CUSTOM_HEADERS = 'User-Agent: KimiCLI/1.3'
    } else if (channel.provider === 'minimax') {
      // MiniMax Coding Plan：Claude Code 兼容配置使用 Bearer
      process.env.ANTHROPIC_AUTH_TOKEN = apiKey
    } else {
      process.env.ANTHROPIC_API_KEY = apiKey
    }
    if (sdkBaseUrl) {
      // Proma 渠道的 sdkBaseUrl 已在上层处理（剥离 /api/v1），不再 normalize；
      // 其它渠道使用规范化逻辑，确保 process.env 与 sdkEnv 中的 URL 一致
      process.env.ANTHROPIC_BASE_URL = channel.provider === 'proma'
        ? sdkBaseUrl
        : normalizeAnthropicBaseUrlForSdk(sdkBaseUrl)
    }

    const sdkEnv = await this.buildSdkEnv(apiKey, sdkBaseUrl, channel.provider)

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
    callbacks.onRunStarted?.({ startedAt: streamStartedAt })

    // 6. 状态初始化
    const accumulatedMessages: SDKMessage[] = []
    let resolvedModel = modelId || DEFAULT_MODEL_ID
    let titleGenerationStarted = false
    let agentCwd: string | undefined
    let workspaceSlug: string | undefined
    let workspace: import('@proma/shared').AgentWorkspace | undefined

    try {
      // 8. 动态导入 SDK
      const sdk = await import('@anthropic-ai/claude-agent-sdk')

      // 9. 构建 SDK query
      const cliPath = resolveSDKCliPath()

      if (!existsSync(cliPath)) {
        const subpkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
        console.error(`[Agent 编排] SDK native binary 不存在: ${cliPath}`)
        reportPreflightError({
          code: 'claude_binary_not_found',
          title: 'Claude 核心未就绪',
          message:
            '应用安装包里缺少 Claude Agent SDK 的核心可执行文件（claude.exe）。这通常是打包时未包含当前平台的 SDK 组件导致。请重新下载最新安装包，或提交 issue 告知我们。',
          details: [
            `缺失文件: ${cliPath}`,
            `需要的子包: ${subpkg}`,
          ],
          actions: [
            {
              key: 'd',
              label: '下载最新安装包',
              action: 'open_external',
              payload: 'https://proma.cool/download',
            },
            {
              key: 'i',
              label: '报告问题',
              action: 'open_external',
              payload: 'https://github.com/ErlichLiu/Proma/issues/new',
            },
          ],
          canRetry: false,
        })
        return
      }

      console.log(
        `[Agent 编排] 启动 SDK — binary: ${cliPath}, 模型: ${modelId || DEFAULT_MODEL_ID}, resume: ${existingSdkSessionId ?? '无'}`,
      )

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

      // 9.4.1 Fork session JSONL 迁移已在 forkAgentSession 中完成，
      // fork 后的会话直接使用自己的 cwd，无需回退到源目录。
      // forkSourceDir 仅作为备用参考字段保留，不再影响 agentCwd。

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

      // 10. 构建 MCP 服务器配置 + 记忆工具 + Proma Cloud 凭据 + 自定义工具
      // 注：生图能力通过 Skill（proma-gpt-image-2 / proma-generate-image）+ proma-cloud MCP 凭据网关实现，
      // 不再注入 nano-banana-mcp / gpt-image-2-mcp（已废弃）
      const mcpServers = this.buildMcpServers(workspaceSlug)
      await this.injectMemoryTools(sdk, mcpServers)
      await this.injectPromaCloudMcp(sdk, mcpServers)

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

      // 11.5 注入 mention 引用指令（Skill/MCP/会话）— 仅影响 prompt，不影响持久化
      let enrichedMessage = userMessage
      const referencedSessionsBlock = buildReferencedSessionsPrompt(sessionId, mentionedSessionIds, workspaceId)
      if (referencedSessionsBlock) {
        enrichedMessage = `${referencedSessionsBlock}\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 referenced_sessions: ${mentionedSessionIds?.length ?? 0} sessions`)
      }
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

      // 12. 读取应用设置并确定权限模式
      // 权限模式只属于当前 session；新会话默认完全自动模式。
      const appSettings = getSettings()
      const initialPermissionMode: PromaPermissionMode = permissionModeOverride
        ?? PROMA_DEFAULT_PERMISSION_MODE
      // 注册到 Map，支持运行中动态切换
      this.sessionPermissionModes.set(sessionId, initialPermissionMode)
      console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

      // 当初始模式为 plan 时，通知渲染进程展示计划模式 UI（如「Agent 正在规划」横幅）
      if (initialPermissionMode === 'plan') {
        this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'enter_plan_mode', sessionId } })
      }

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

      // 始终创建 auto 权限回调（运行中可能切换到 auto）
      const autoCanUseTool = permissionService.createCanUseTool(
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
            // Plan 模式：只允许只读工具 + Write/Edit 任意 .md 文件（计划文档）
            if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            // 允许 Write/Edit 到任意 .md 文件（计划文档一定是 markdown；非 .md 仍被拒）
            if (toolName === 'Write' || toolName === 'Edit') {
              const filePath = typeof input.file_path === 'string' ? input.file_path : ''
              if (filePath.toLowerCase().endsWith('.md')) {
                return { behavior: 'allow' as const, updatedInput: input }
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

          case 'auto':
            return autoCanUseTool(toolName, input, options)

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
        env: sdkEnv,
        ...(maxTurns != null && { maxTurns }),
        sdkPermissionMode: PROMA_PERMISSION_MODE_CONFIG[initialPermissionMode].sdkMode,
        // 当提供 canUseTool 回调时必须为 false，否则 CLI 同时收到
        // --allow-dangerously-skip-permissions 和 --permission-prompt-tool stdio
        // 两个矛盾的指令，导致 ExitPlanMode/AskUserQuestion 等交互式工具失败。
        // canUseTool 已完整处理所有权限模式（plan/auto/bypassPermissions），
        // Worker 子代理在 bypassPermissions 模式下也会被自动放行。
        allowDangerouslySkipPermissions: !canUseTool,
        canUseTool,
        ...(initialPermissionMode === 'auto' && { allowedTools: [...SAFE_TOOLS] }),
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
        // 合并附加目录：用户当次输入 + 会话级 + 工作区级（详见 collectAttachedDirectories）
        ...(() => {
          const allDirs = collectAttachedDirectories({
            extraDirs: additionalDirectories,
            sessionMeta,
            workspaceSlug,
          })
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
        // 1M context window: 支持的模型自动启用 beta（Claude: Sonnet 4+ / Opus 4.6+、DeepSeek V4 系列）
        // 未启用时 SDK 默认 200K 并在约 150K 触发压缩；启用后上限提升至 1M
        ...(supports1MContext(modelId || DEFAULT_MODEL_ID) && {
          betas: ['context-1m-2025-08-07'] as SdkBeta[],
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

      // 14. 遍历 Adapter 产出的 AgentEvent 流（含自动重试）
      let lastRetryableError: string | undefined
      let retryDelayElapsedMs = 0
      let retryAttemptsScheduled = 0
      let retrySucceeded = false
      let skipNextRetryDelay = false
      let thinkingSignatureRecoveryAttempted = false
      let invisibleRecoveryAttempts = 0
      const canAutoRetry = (attempt: number): boolean =>
        attempt <= MAX_AUTO_RETRIES && retryDelayElapsedMs < MAX_AUTO_RETRY_WAIT_MS

      /** 捕获到的 SDK session ID（用于 resume / recovery） */
      let capturedSdkSessionId = existingSdkSessionId
      const canTryThinkingSignatureRecovery = (attempt: number): boolean =>
        !thinkingSignatureRecoveryAttempted &&
        canAutoRetry(attempt) &&
        !!(existingSdkSessionId || capturedSdkSessionId || queryOptions.resumeSessionId)

      const queryStartedAt = Date.now()

      for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
        // 非首次尝试：等待 + 发送重试事件到 UI
        if (attempt > 1) {
          if (skipNextRetryDelay) {
            skipNextRetryDelay = false
            console.log(`[Agent 编排] 已切换到上下文回填模式，立即重试`)
          } else {
            const retryAttempt = Math.max(1, attempt - 1 - invisibleRecoveryAttempts)
            const delayMs = getRetryDelayMs(retryAttempt, retryDelayElapsedMs)
            if (delayMs <= 0) {
              console.log(`[Agent 编排] 自动重试等待预算已耗尽 (${MAX_AUTO_RETRY_WAIT_MS}ms)，停止重试`)
              break
            }
            retryDelayElapsedMs += delayMs
            retryAttemptsScheduled = retryAttempt
            const delaySec = delayMs / 1000
            const attemptData: RetryAttempt = {
              attempt: retryAttempt,
              timestamp: Date.now(),
              reason: lastRetryableError ?? '未知错误',
              errorMessage: lastRetryableError ?? '',
              delaySeconds: delaySec,
            }

            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'retry', status: 'starting', attempt: retryAttempt, maxAttempts: MAX_AUTO_RETRIES, delaySeconds: delaySec, reason: lastRetryableError ?? '未知错误' },
            })
            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'retry', status: 'attempt', attemptData },
            })

            console.log(`[Agent 编排] 第 ${retryAttempt} 次重试，等待 ${delaySec}s...`)
            await new Promise((r) => setTimeout(r, delayMs))

            // 等待期间如果会话被中止，退出
            if (!this.activeSessions.has(sessionId)) {
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
              return
            }
          }
        }

        let shouldRetryFromError = false

        try {
          // 获取异步迭代器（手动 .next() 以支持 Promise.race 中断）
          const queryIterable = this.adapter.query(queryOptions)
          const queryIterator = queryIterable[Symbol.asyncIterator]()

          // 手动事件循环：Promise.race（SDKMessage vs result drain timeout）
          let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
          // 捕获 result.subtype 以传递给前端（用于区分 success/error_max_turns/error_max_budget_usd）
          let capturedResultSubtype: string | undefined
          // result 收到后的安全超时：adapter 层 channel.close() 应让 iterator 自然关闭，
          // 此 timeout 仅作安全网，防止极端情况下 iterator 仍未关闭
          let drainTimeoutPromise: Promise<'drain_timeout'> | null = null
          const RESULT_DRAIN_TIMEOUT_MS = 2_000

          while (true) {
            if (!pendingNext) {
              pendingNext = queryIterator.next()
            }

            const racePromises: Array<Promise<{ kind: string; result: IteratorResult<SDKMessage> | null }>> = [
              pendingNext.then((r) => ({ kind: 'event' as const, result: r })),
            ]
            if (drainTimeoutPromise) {
              racePromises.push(drainTimeoutPromise.then(() => ({ kind: 'drain_timeout' as const, result: null })))
            }

            const raceResult = await Promise.race(racePromises)

            if (raceResult.kind === 'drain_timeout') {
              // 安全网：channel.close() 后 SDK 仍未在超时内关闭 iterator，强制退出
              console.warn(`[Agent 编排] drain timeout: SDK iterator 在 result 后 ${RESULT_DRAIN_TIMEOUT_MS}ms 内未关闭，强制退出`)
              pendingNext?.catch(() => {})
              pendingNext = null
              queryIterator.return?.(undefined as never).catch(() => {})
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
                // SDK 对 proma 402 有时不设置 errorType，从消息内容兜底检测
                if (errorCode === 'unknown_error' && channel.provider === 'proma') {
                  const errorRaw = JSON.stringify(assistantMsg.error ?? {})
                  const contentRaw = JSON.stringify(assistantMsg.message?.content ?? [])
                  const haystack = [errorRaw, contentRaw, detailedMessage, originalError].join(' ')
                  if (['insufficient_quota', '积分不足', '余额不足', 'payment_required'].some(s => haystack.includes(s))) {
                    errorCode = 'billing_error'
                    console.log(`[Agent 编排] Proma billing error detected from message content`)
                  }
                }
                const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

                // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
                if (isSessionNotFoundError(detailedMessage, originalError) && existingSdkSessionId && canAutoRetry(attempt)) {
                  existingSdkSessionId = undefined
                  capturedSdkSessionId = undefined
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

                // Thinking signature 不兼容：通常由跨模型 resume 触发。
                // 先自动清除 SDK resume 关系，改用 Proma 已持久化上下文重跑一次；再失败才展示用户提示。
                if (
                  typedError.code === THINKING_SIGNATURE_ERROR_CODE &&
                  canTryThinkingSignatureRecovery(attempt)
                ) {
                  thinkingSignatureRecoveryAttempted = true
                  invisibleRecoveryAttempts += 1
                  existingSdkSessionId = undefined
                  capturedSdkSessionId = undefined
                  skipNextRetryDelay = true
                  lastRetryableError = this.prepareResumeFallbackRecovery(
                    sessionId,
                    queryOptions,
                    contextualMessage,
                    agentCwd,
                    accumulatedMessages,
                    queryStartedAt,
                    '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
                    '思考签名不兼容，切换到上下文回填模式',
                  )
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 判断是否可自动重试
                if (isAutoRetryableTypedError(typedError) && canAutoRetry(attempt)) {
                  lastRetryableError = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                  console.log(`[Agent 编排] 可重试错误 (assistant error): ${typedError.code} - ${lastRetryableError}`)
                  this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                  accumulatedMessages.length = 0
                  // 与 catch 路径（isAutoRetryableCatchError）和思考签名回填路径保持一致：
                  // 重试前清空已累积的 stderr，避免 25 次重试上限内字符串无限增长
                  stderrChunks.length = 0
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
                if (retryAttemptsScheduled > 0 && lastRetryableError) {
                  this.eventBus.emit(sessionId, {
                    kind: 'proma_event',
                    event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: typedError.message, delaySeconds: 0 } },
                  })
                }

                // 透传归一化后的错误消息到前端，避免 SDK 原始 API Error 直接暴露给用户。
                this.eventBus.emit(sessionId, { kind: 'sdk_message', message: errorSDKMsg })
                try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
                completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
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
              if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'permission_denied') {
                accumulatedMessages.push(msg)
              }
            }

            // Turn 结束时：持久化累积消息
            if (msg.type === 'result') {
              capturedResultSubtype = (msg as { subtype?: string }).subtype
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              accumulatedMessages.length = 0
              // 软中断 / 延迟工具 / hook 暂停等场景下，adapter 保留 channel
              // 等待队列或后续消息继续 drive Query，此处跳过 drain 超时以免误关闭事件循环。
              // 完整白名单见 adapters/claude-agent-adapter.ts 的 CONTINUABLE_TERMINAL_REASONS。
              const resultTerminalReason = (msg as { terminal_reason?: string }).terminal_reason
              const keepChannelOpen = shouldKeepChannelOpen(resultTerminalReason)
              // 分类打点：跟踪线上哪种 terminal_reason 最常见，配合 deferred_tool_use 回填决策
              const hasDeferredTool = (msg as { deferred_tool_use?: unknown }).deferred_tool_use != null
              console.log(
                `[Agent 编排] result 到达: sessionId=${sessionId}, subtype=${capturedResultSubtype ?? 'unknown'}, ` +
                `terminal_reason=${resultTerminalReason ?? 'undefined'}, keepChannelOpen=${keepChannelOpen}` +
                (hasDeferredTool ? ', hasDeferredTool=true' : ''),
              )
              if (!keepChannelOpen && !drainTimeoutPromise) {
                // 启动 drain 超时安全网：adapter 层 channel.close() 应让 iterator 自然关闭，
                // 此处仅在极端情况下（如 SDK 版本不兼容）保护事件循环不无限挂起
                drainTimeoutPromise = new Promise((resolve) =>
                  setTimeout(() => resolve('drain_timeout'), RESULT_DRAIN_TIMEOUT_MS),
                )
              }
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

            if (!shouldEmit) {
              // 跳过 SDK 内部 user 消息的前端推送
            } else {
              this.eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
            }
          }

          // 错误 break 触发了 → 继续循环
          if (shouldRetryFromError) {
            continue
          }

          // 正常完成 — 如果之前有重试，发送 retry_cleared
          if (retryAttemptsScheduled > 0) {
            this.eventBus.emit(sessionId, { kind: 'proma_event', event: { type: 'retry', status: 'cleared' } })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)

          try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }

          // Plan 模式：Agent 完成规划后注入"接受计划"建议
          if (initialPermissionMode === 'plan' && planModeEntered && this.activeSessions.has(sessionId)) {
            this.eventBus.emit(sessionId, {
              kind: 'sdk_message',
              message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage,
            })
            console.log(`[Agent 编排] Plan 模式：已注入计划确认建议`)
          }

          // 发送完成信号
          completeRun(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt, resultSubtype: capturedResultSubtype })

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
            completeRun(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt })
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''

          // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
          if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingSdkSessionId && canAutoRetry(attempt)) {
            existingSdkSessionId = undefined
            capturedSdkSessionId = undefined
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

          // Thinking signature 不兼容：先自动清除 SDK resume 关系并用上下文回填重跑一次。
          if (
            isThinkingSignatureError(apiError?.message ?? '', rawErrorMessage, stderrOutput) &&
            canTryThinkingSignatureRecovery(attempt)
          ) {
            thinkingSignatureRecoveryAttempted = true
            invisibleRecoveryAttempts += 1
            existingSdkSessionId = undefined
            capturedSdkSessionId = undefined
            skipNextRetryDelay = true
            lastRetryableError = this.prepareResumeFallbackRecovery(
              sessionId,
              queryOptions,
              contextualMessage,
              agentCwd,
              accumulatedMessages,
              queryStartedAt,
              '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
              '思考签名不兼容，切换到上下文回填模式',
            )
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // Proma 官方渠道 402：额度不足，标记为计费错误（在聊天内显示，不弹模态框）
          const isBillingError = apiError?.statusCode === 402 && channel.provider === 'proma'
          if (isBillingError) {
            console.log(`[Agent 编排] Proma 额度不足 (402)，将在聊天内显示充值提示`)
          }

          // 判断是否可重试
          if (isAutoRetryableCatchError(apiError, rawErrorMessage, stderrOutput) && canAutoRetry(attempt)) {
            lastRetryableError = apiError
              ? `API Error ${apiError.statusCode}: ${apiError.message}`
              : (error instanceof Error ? error.message : '未知错误')
            console.log(`[Agent 编排] 可重试错误 (catch, attempt ${attempt}/${MAX_AUTO_RETRIES}): ${lastRetryableError}`)
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
            userFacingError = '余额不足，叠加订阅后继续（订阅不自动扣费，支持任意数量叠加）'
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
            const isThinkingSignature = isThinkingSignatureError(
              apiError?.message ?? '',
              userFacingError,
              rawErrorMessage,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              stderrOutput,
            )
            const errorCode = isBillingError
              ? 'billing_error'
              : isPromptTooLong
                ? 'prompt_too_long'
                : isThinkingSignature
                  ? THINKING_SIGNATURE_ERROR_CODE
                  : 'unknown_error'
            const errorTitle = isBillingError
              ? '余额不足'
              : isPromptTooLong
                ? '上下文过长'
                : isThinkingSignature
                  ? THINKING_SIGNATURE_ERROR_TITLE
                  : '执行错误'
            const errorContent = isBillingError
              ? '余额不足，叠加订阅后继续（订阅不自动扣费，支持任意数量叠加）'
              : isPromptTooLong
                ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
                : isThinkingSignature
                  ? `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}`
                  : userFacingError
            const errorActions = isThinkingSignature
              ? [
                  { key: 'n', label: '在新对话继续', action: 'retry_in_new_session' },
                  { key: 'r', label: '重试', action: 'retry' },
                ]
              : undefined
            userFacingError = errorContent

            const errMsg: SDKMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: errorContent }],
              },
              parent_tool_use_id: null,
              error: { message: errorContent, errorType: errorCode },
              _createdAt: Date.now(),
              _errorCode: errorCode,
              _errorTitle: errorTitle,
              _errorActions: errorActions,
            } as unknown as SDKMessage
            appendSDKMessages(sessionId, [errMsg])
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有重试记录，发送 retry_failed
          if (retryAttemptsScheduled > 0 && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              kind: 'proma_event',
              event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled, timestamp: Date.now(), reason: lastRetryableError, errorMessage: userFacingError, delaySeconds: 0 } },
            })
          }

          failRun(userFacingError, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })

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

          return
        }
      }

      // 重试循环结束（达到最大次数仍失败）
      if (!retrySucceeded && lastRetryableError) {
        const retryFailureMessage = retryDelayElapsedMs >= MAX_AUTO_RETRY_WAIT_MS
          ? '重试等待已达到 5 分钟后仍然失败'
          : `重试 ${retryAttemptsScheduled || MAX_AUTO_RETRIES} 次后仍然失败`
        this.eventBus.emit(sessionId, {
          kind: 'proma_event',
          event: { type: 'retry', status: 'failed', attemptData: { attempt: retryAttemptsScheduled || MAX_AUTO_RETRIES, timestamp: Date.now(), reason: lastRetryableError, errorMessage: retryFailureMessage, delaySeconds: 0 } },
        })

        // 保存错误消息
        const retryErrorContent = `${retryFailureMessage}: ${lastRetryableError}`
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

        failRun(`${retryFailureMessage}: ${lastRetryableError}`, getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
      }

    } finally {
      // 只在 generation 匹配时才清理，防止旧流的 finally 误删新流的注册
      releaseActiveRun()
      permissionService.clearSessionPending(sessionId)
      // askUserService 不在 turn 结束时清理——AskUserQuestion 的生命周期由用户交互决定，
      // 仅在会话真正删除时（DELETE_SESSION IPC）才清理。
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
        // 收集附加目录（必须与 sendMessage 中传给 SDK 的 additionalDirectories 一致，
        // 否则会话级 attachedDirectories 内的文件会因路径越界检查被静默跳过）
        const rewindAttachedDirs = collectAttachedDirectories({ sessionMeta, workspaceSlug })
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
    if (this.activeSessions.size > 0) {
      console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    }
    // 即便 activeSessions 为空，也要调 dispose 清理可能残留的 pidMap / 子进程
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
    opts?: { interrupt?: boolean },
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
      // 用户希望"立即打断当前输出并续跑新消息"：先软中断，再把消息压入通道
      // - interrupt() 让 SDK 结束当前 turn 并 yield 一个 aborted result
      // - 随后通道里的 'now' 消息会作为下一轮 turn 的用户输入被消费
      if (opts?.interrupt && this.adapter.interruptQuery) {
        try {
          await this.adapter.interruptQuery(sessionId)
        } catch (error) {
          console.warn(`[Agent 编排] 软中断失败（将继续追加消息）:`, error)
        }
      }

      await this.adapter.sendQueuedMessage(sessionId, sdkMessage)
      console.log(`[Agent 编排] 追加消息已注入: sessionId=${sessionId}, uuid=${uuid}, interrupt=${!!opts?.interrupt}`)

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
