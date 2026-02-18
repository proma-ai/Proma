/**
 * Agent SDK 服务层
 *
 * 负责 Agent SDK 的调用编排：
 * - 获取渠道信息（API Key + Base URL）
 * - 注入环境变量（ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL）
 * - 构建 SDK Options（pathToClaudeCodeExecutable + executable + env）
 * - 调用 query() 获取消息流
 * - 遍历 SDKMessage → convertSDKMessage() → AgentEvent[]
 * - 每个事件 → webContents.send() 推送给渲染进程
 * - 同时 appendAgentMessage() 持久化
 *
 * 参考 craft-agents-oss 的 reinitializeAuth + getDefaultOptions 模式。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs'
import { cp, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { app, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS, CLOUD_IPC_CHANNELS, PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'
import type { AgentSendInput, AgentEvent, AgentMessage, AgentStreamEvent, AgentGenerateTitleInput, AgentSaveFilesInput, AgentSavedFile, AgentCopyFolderInput, TypedError, ErrorCode } from '@proma/shared'
import {
  ToolIndex,
  extractToolStarts,
  extractToolResults,
  type ContentBlock,
} from '@proma/shared'
import { decryptApiKey, getChannelById, listChannels } from './channel-manager'
import { getSystemApiKey } from './cloud-channel-service'
import { getAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import {
  getAdapter,
  fetchTitle,
} from '@proma/core'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendAgentMessage, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath } from './config-paths'
import { getRuntimeStatus } from './runtime-init'
import { getWorkspaceMcpConfig, ensurePluginManifest } from './agent-workspace-manager'
import { buildSystemPromptAppend, buildDynamicContext } from './agent-prompt-builder'
import { permissionService } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { getWorkspacePermissionMode } from './agent-workspace-manager'
import type { PermissionRequest, PromaPermissionMode, AskUserRequest } from '@proma/shared'
import { SAFE_TOOLS } from '@proma/shared'

/** 活跃的 AbortController 映射（sessionId → controller） */
const activeControllers = new Map<string, AbortController>()

/**
 * 映射 SDK 错误代码到 TypedError
 *
 * 参考 craft-agents-oss 的实现，将 SDK 的错误代码（如 authentication_failed）
 * 映射为结构化的 TypedError，包含用户友好的提示和建议操作。
 */
function mapSDKErrorToTypedError(
  errorCode: string,
  detailedMessage: string,
  originalError: string
): TypedError {
  // SDK 错误代码映射
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
    title: '未知错误',
    message: detailedMessage || errorCode,
    canRetry: false,
  }

  return {
    code: mapped.code,
    title: mapped.title,
    // 优先使用详细消息，回退到映射消息
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
    // 只有在状态码是有效的 HTTP 错误码时才返回
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
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
    console.log(`[Agent 服务] SDK CLI 路径 (createRequire): ${cliPath}`)
  } catch (e) {
    console.warn('[Agent 服务] createRequire 解析 SDK 路径失败:', e)
  }

  // 策略 2：全局 require（esbuild CJS bundle 可能保留）
  if (!cliPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdkEntryPath = require.resolve('@anthropic-ai/claude-agent-sdk')
      cliPath = join(dirname(sdkEntryPath), 'cli.js')
      console.log(`[Agent 服务] SDK CLI 路径 (require.resolve): ${cliPath}`)
    } catch (e) {
      console.warn('[Agent 服务] require.resolve 解析 SDK 路径失败:', e)
    }
  }

  // 策略 3：从项目根目录手动查找
  if (!cliPath) {
    cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    console.log(`[Agent 服务] SDK CLI 路径 (手动): ${cliPath}`)
  }

  // 打包环境：将 .asar/ 路径转换为 .asar.unpacked/
  // 子进程 (bun) 无法读取 asar 归档，asarUnpack 后文件在 .asar.unpacked/ 目录
  if (app.isPackaged && cliPath.includes('.asar')) {
    cliPath = cliPath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
    console.log(`[Agent 服务] 转换为 asar.unpacked 路径: ${cliPath}`)
  }

  return cliPath
}

/**
 * 获取 Agent SDK 运行时可执行文件
 *
 * 优先级策略：
 * 1. Node.js（用户已安装，无需额外依赖）
 * 2. Bun（开发环境或打包版本可能包含）
 * 3. 降级到字符串 'node'（依赖系统 PATH）
 *
 * @returns { type: 'node' | 'bun', path: string }
 */
function getAgentExecutable(): { type: 'node' | 'bun'; path: string } {
  const status = getRuntimeStatus()

  // 优先使用 Node.js（用户已安装）
  if (status?.node?.available && status.node.path) {
    return { type: 'node', path: status.node.path }
  }

  // 降级到 Bun
  if (status?.bun?.available && status.bun.path) {
    return { type: 'bun', path: status.bun.path }
  }

  // 最后降级到字符串 'node'（依赖 PATH）
  return { type: 'node', path: 'node' }
}

/**
 * 确保打包环境下 ripgrep 可被 SDK CLI 找到
 *
 * 打包时 ripgrep 从 SDK vendor/ 排除（减少体积），仅当前平台的放在 extraResources。
 * SDK CLI 期望在 vendor/ripgrep/{arch}-{platform}/ 下找到 rg。
 * 通过 symlink 桥接 extraResources → SDK 的 vendor 目录。
 */
function ensureRipgrepAvailable(cliPath: string): void {
  if (!app.isPackaged) return

  try {
    const sdkDir = dirname(cliPath)
    const arch = process.arch   // 'arm64' | 'x64'
    const platform = process.platform // 'darwin' | 'linux' | 'win32'
    const expectedDir = join(sdkDir, 'vendor', 'ripgrep', `${arch}-${platform}`)
    const resourcesRipgrep = join(process.resourcesPath, 'vendor', 'ripgrep')

    // 已存在（symlink 或实际文件）则跳过
    if (existsSync(expectedDir)) return

    // extraResources 不存在则跳过（ripgrep 可能未打包）
    if (!existsSync(resourcesRipgrep)) {
      console.warn(`[Agent 服务] ripgrep 资源不存在: ${resourcesRipgrep}`)
      return
    }

    mkdirSync(join(sdkDir, 'vendor', 'ripgrep'), { recursive: true })
    symlinkSync(resourcesRipgrep, expectedDir, 'junction')
    console.log(`[Agent 服务] ripgrep symlink 创建成功: ${expectedDir} → ${resourcesRipgrep}`)
  } catch (error) {
    console.warn('[Agent 服务] ripgrep symlink 创建失败:', error)
  }
}

// SDK 消息类型定义（简化版，避免直接依赖 SDK 内部类型）
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
}

type SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKStreamEvent | SDKResultMessage | SDKToolProgressMessage | { type: string; parent_tool_use_id?: string | null }

/**
 * 将 SDK 消息转换为 AgentEvent 列表
 */
function convertSDKMessage(
  message: SDKMessage,
  toolIndex: ToolIndex,
  emittedToolStarts: Set<string>,
  activeParentTools: Set<string>,
  pendingText: { value: string | null },
  turnId: { value: string | null },
): AgentEvent[] {
  const events: AgentEvent[] = []

  switch (message.type) {
    case 'assistant': {
      const msg = message as SDKAssistantMessage

      // SDK 级别错误（如 authentication_failed）
      if (msg.error) {
        let detailedMessage: string = msg.error.message
        let originalError: string = msg.error.message
        const errorType = msg.error.errorType

        // 尝试从 content 中提取详细错误信息
        try {
          const content = msg.message?.content
          if (Array.isArray(content) && content.length > 0) {
            const textBlock = content.find((block: any) => block.type === 'text')
            if (textBlock && 'text' in textBlock && typeof textBlock.text === 'string') {
              const fullText: string = textBlock.text
              originalError = fullText

              // 提取 JSON 格式的 API 错误：API Error: 401 {"error":{"message":"..."}}
              const apiErrorMatch = fullText.match(/API Error:\s*\d+\s*(\{.*\})/s)
              if (apiErrorMatch && apiErrorMatch[1]) {
                try {
                  const apiErrorObj = JSON.parse(apiErrorMatch[1])
                  if (apiErrorObj.error?.message) {
                    detailedMessage = apiErrorObj.error.message
                  }
                } catch {
                  // JSON 解析失败，使用完整文本
                  detailedMessage = fullText
                }
              } else {
                // 没有 JSON 格式，使用完整文本
                detailedMessage = fullText
              }
            }
          }
        } catch (err) {
          // 提取失败，使用原始 error 字段
          console.error('[convertSDKMessage] 提取错误详情失败:', err)
        }

        // 映射到 TypedError（使用 errorType 作为错误代码）
        const errorCode = errorType || 'unknown_error'
        const typedError = mapSDKErrorToTypedError(errorCode, detailedMessage, originalError)
        events.push({ type: 'typed_error', error: typedError })
        break
      }

      // 跳过重放消息
      if (msg.isReplay) break

      const content = msg.message.content

      // 提取文本内容
      let textContent = ''
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          textContent += block.text
        }
      }

      // 工具启动事件提取
      const sdkParentId = msg.parent_tool_use_id
      const toolStartEvents = extractToolStarts(
        content as ContentBlock[],
        sdkParentId,
        toolIndex,
        emittedToolStarts,
        turnId.value || undefined,
        activeParentTools,
      )

      // 跟踪活跃的 Task 工具
      for (const event of toolStartEvents) {
        if (event.type === 'tool_start' && event.toolName === 'Task') {
          activeParentTools.add(event.toolUseId)
        }
      }

      events.push(...toolStartEvents)

      if (textContent) {
        pendingText.value = textContent
      }
      break
    }

    case 'stream_event': {
      const msg = message as SDKStreamEvent
      const streamEvent = msg.event

      // 捕获 turn ID
      if (streamEvent.type === 'message_start') {
        const messageId = streamEvent.message?.id
        if (messageId) {
          turnId.value = messageId
        }
      }

      // message_delta 包含实际 stop_reason — 发出 pending 文本
      if (streamEvent.type === 'message_delta') {
        const stopReason = streamEvent.delta?.stop_reason
        if (pendingText.value) {
          const isIntermediate = stopReason === 'tool_use'
          events.push({
            type: 'text_complete',
            text: pendingText.value,
            isIntermediate,
            turnId: turnId.value || undefined,
            parentToolUseId: msg.parent_tool_use_id || undefined,
          })
          pendingText.value = null
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
        const sdkParentId = msg.parent_tool_use_id
        const streamBlocks: ContentBlock[] = [{
          type: 'tool_use' as const,
          id: toolBlock.id,
          name: toolBlock.name,
          input: (toolBlock.input ?? {}) as Record<string, unknown>,
        }]
        const streamEvents = extractToolStarts(
          streamBlocks,
          sdkParentId,
          toolIndex,
          emittedToolStarts,
          turnId.value || undefined,
          activeParentTools,
        )

        for (const evt of streamEvents) {
          if (evt.type === 'tool_start' && evt.toolName === 'Task') {
            activeParentTools.add(evt.toolUseId)
          }
        }

        events.push(...streamEvents)
      }
      break
    }

    case 'user': {
      const msg = message as SDKUserMessage

      if (msg.isReplay) break

      if (msg.tool_use_result !== undefined || msg.message) {
        const msgContent = msg.message
          ? ((msg.message as { content?: unknown[] }).content ?? [])
          : []
        const contentBlocks = (Array.isArray(msgContent) ? msgContent : []) as ContentBlock[]

        const sdkParentId = msg.parent_tool_use_id
        const toolUseResultValue = msg.tool_use_result

        const resultEvents = extractToolResults(
          contentBlocks,
          sdkParentId,
          toolUseResultValue,
          toolIndex,
          turnId.value || undefined,
        )

        for (const event of resultEvents) {
          if (event.type === 'tool_result' && event.toolName === 'Task') {
            activeParentTools.delete(event.toolUseId)
          }
        }

        events.push(...resultEvents)
      }
      break
    }

    case 'tool_progress': {
      const msg = message as SDKToolProgressMessage

      if (msg.elapsed_time_seconds !== undefined) {
        events.push({
          type: 'task_progress',
          toolUseId: msg.parent_tool_use_id || msg.tool_use_id,
          elapsedSeconds: msg.elapsed_time_seconds,
          turnId: turnId.value || undefined,
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
          progressBlocks,
          msg.parent_tool_use_id,
          toolIndex,
          emittedToolStarts,
          turnId.value || undefined,
          activeParentTools,
        )

        for (const evt of progressEvents) {
          if (evt.type === 'tool_start' && evt.toolName === 'Task') {
            activeParentTools.add(evt.toolUseId)
          }
        }

        events.push(...progressEvents)
      }
      break
    }

    case 'result': {
      const msg = message as SDKResultMessage

      const modelUsageEntries = Object.values(msg.modelUsage || {})
      const primaryModelUsage = modelUsageEntries[0]

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
      break
    }

    default:
      // 记录未处理的消息类型，帮助调试
      console.log(`[Agent 服务] 忽略消息类型: ${message.type}`)
      break
  }

  return events
}

/** 最大回填消息条数 */
const MAX_CONTEXT_MESSAGES = 20

/**
 * 构建带历史上下文的 prompt
 *
 * 当 resume 不可用时（cwd 迁移等），将最近消息拼接为上下文注入 prompt，
 * 让新 SDK 会话保留对话记忆。仅取 user/assistant 角色的文本内容。
 */
function buildContextPrompt(sessionId: string, currentUserMessage: string): string {
  const allMessages = getAgentSessionMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  // 排除最后一条（刚刚追加的当前用户消息）
  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => `[${m.role}]: ${m.content}`)

  if (lines.length === 0) return currentUserMessage

  return `<conversation_history>\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}

/**
 * 运行 Agent 并流式推送事件到渲染进程
 *
 * 直接透传 API 错误，不做重试。保持架构简单，让上游 API 提供商的错误消息直达用户。
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  const { sessionId, userMessage, channelId, modelId, workspaceId } = input
  const stderrChunks: string[] = []

  // 0. 并发保护：检查是否已有正在运行的请求
  if (activeControllers.has(sessionId)) {
    console.warn(`[Agent 服务] 会话 ${sessionId} 正在处理中，拒绝新请求`)
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: '上一条消息仍在处理中，请稍候再试',
    })
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

      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
        sessionId,
        error: errorMsg,
      })
      return
    }
  }

  // 1. 获取渠道信息并解密 API Key
  const channel = getChannelById(channelId)
  if (!channel) {
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: '渠道不存在',
    })
    return
  }

  // Proma 官方渠道默认使用 opus 模型
  const defaultModel = channel.provider === 'proma'
    ? PROMA_OFFICIAL_DEFAULT_AGENT_MODEL
    : 'claude-sonnet-4-5-20250929'

  let apiKey: string
  try {
    if (channel.provider === 'proma') {
      // 官方渠道：使用 system API key（pk_xxx），走后端代理
      apiKey = await getSystemApiKey()
    } else {
      apiKey = decryptApiKey(channelId)
    }
  } catch {
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: channel.provider === 'proma' ? '获取 System API Key 失败，请检查登录状态' : '解密 API Key 失败',
    })
    return
  }

  // 2. 注入环境变量（参考 craft-agents-oss 的 reinitializeAuth 模式）
  // SDK 通过子进程继承 env，不支持直接传 apiKey option
  const DEFAULT_ANTHROPIC_URL = 'https://api.anthropic.com'
  const sdkEnv: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
  }

  if (channel.provider === 'proma') {
    // 官方渠道：ANTHROPIC_BASE_URL 为 cloud root URL（去掉 /api/v1）
    // SDK 自动拼接 /v1/messages → POST {cloudRootUrl}/v1/messages
    const cloudBaseUrl = getCloudApiConfig().baseUrl
    sdkEnv.ANTHROPIC_BASE_URL = cloudBaseUrl.replace(/\/api\/v1\/?$/, '')
  } else if (channel.baseUrl && channel.baseUrl !== DEFAULT_ANTHROPIC_URL) {
    // 自定义 Base URL 时注入 ANTHROPIC_BASE_URL
    // SDK 内部会自动拼接 /v1/messages，需要去除用户误填的路径后缀
    sdkEnv.ANTHROPIC_BASE_URL = channel.baseUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/v\d+\/messages$/, '')
      .replace(/\/v\d+$/, '')
  } else {
    // 确保不会残留上一次的 Base URL
    delete sdkEnv.ANTHROPIC_BASE_URL
  }
  // 代理配置：SDK 通过子进程运行，注入 HTTPS_PROXY 环境变量
  const proxyUrl = await getEffectiveProxyUrl()
  if (proxyUrl) {
    sdkEnv.HTTPS_PROXY = proxyUrl
    sdkEnv.HTTP_PROXY = proxyUrl
  }

  // Windows 平台：配置 Shell 环境（Git Bash / WSL）
  if (process.platform === 'win32') {
    const runtimeStatus = getRuntimeStatus()
    const shellStatus = runtimeStatus?.shell

    if (shellStatus) {
      // 优先使用 Git Bash
      if (shellStatus.gitBash?.available && shellStatus.gitBash.path) {
        sdkEnv.CLAUDE_CODE_SHELL = shellStatus.gitBash.path
        console.log(`[Agent 服务] 配置 Shell 环境: Git Bash (${shellStatus.gitBash.path})`)
      }
      // 降级到 WSL
      else if (shellStatus.wsl?.available) {
        sdkEnv.CLAUDE_CODE_SHELL = 'wsl'
        console.log(
          `[Agent 服务] 配置 Shell 环境: WSL ${shellStatus.wsl.version} (${shellStatus.wsl.defaultDistro})`,
        )
      }
      // 无可用环境
      else {
        console.warn('[Agent 服务] Windows 平台未检测到可用的 Shell 环境（Git Bash / WSL）')
        console.warn('[Agent 服务] Agent 的 Bash 工具可能无法正常工作')
      }

      // 性能优化：跳过登录 shell，加速 Bash 执行
      sdkEnv.CLAUDE_BASH_NO_LOGIN = '1'
    }
  }

  // 2.5 读取已有的 SDK session ID（用于 resume 衔接上下文）
  const sessionMeta = getAgentSessionMeta(sessionId)
  let existingSdkSessionId = sessionMeta?.sdkSessionId
  console.log(`[Agent 服务] 会话元数据 resume 状态: sdkSessionId=${existingSdkSessionId || '无'}`)

  // 3. 持久化用户消息
  const userMsg: AgentMessage = {
    id: randomUUID(),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
  }
  appendAgentMessage(sessionId, userMsg)

  // 4. 创建 AbortController
  const controller = new AbortController()
  activeControllers.set(sessionId, controller)

  // 5. 状态初始化
  const toolIndex = new ToolIndex()
  const emittedToolStarts = new Set<string>()
  const activeParentTools = new Set<string>()
  const pendingText = { value: null as string | null }
  const turnId = { value: null as string | null }
  // 上下文使用量追踪（参考 craft-agents-oss cachedContextWindow 模式）
  let cachedContextWindow: number | undefined

  // 累积文本用于持久化
  let accumulatedText = ''
  const accumulatedEvents: AgentEvent[] = []
  // SDK 确认的实际模型（从 system init 消息获取）
  let resolvedModel = modelId || defaultModel
  // stderrChunks 从外部传入（供重试判断使用）
  // 运行环境信息（声明在 try 之前，供 catch 块使用）
  let agentExec: { type: 'node' | 'bun'; path: string } | undefined
  let agentCwd: string | undefined
  let workspaceSlug: string | undefined
  let workspace: import('@proma/shared').AgentWorkspace | undefined
  let isCompacting = false // 是否正在执行上下文压缩

  try {
    // 6. 动态导入 SDK（避免在 esbuild 打包时出问题）
    const sdk = await import('@anthropic-ai/claude-agent-sdk')

    // 7. 构建 SDK query（通过 env 注入认证信息）
    const cliPath = resolveSDKCliPath()
    agentExec = getAgentExecutable()

    // 路径验证
    if (!existsSync(cliPath)) {
      const errMsg = `SDK CLI 文件不存在: ${cliPath}`
      console.error(`[Agent 服务] ${errMsg}`)
      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, { sessionId, error: errMsg })
      return
    }

    // 确保 ripgrep 可用（打包环境下创建 symlink）
    ensureRipgrepAvailable(cliPath)

    console.log(
      `[Agent 服务] 启动 SDK — CLI: ${cliPath}, 运行时: ${agentExec.type} (${agentExec.path}), 模型: ${modelId || defaultModel}, resume: ${existingSdkSessionId ?? '无'}`,
    )

    // 安全：阻止运行时自动加载用户项目中的 .env 文件
    // Bun: --env-file=/dev/null
    // Node.js: 默认不会加载 .env，无需特殊处理
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const executableArgs = agentExec.type === 'bun' ? [`--env-file=${nullDevice}`] : []

    // 确定 Agent 工作目录：优先使用 session 级别路径
    agentCwd = homedir()
    workspaceSlug = undefined
    workspace = undefined
    if (workspaceId) {
      const ws = getAgentWorkspace(workspaceId)
      if (ws) {
        agentCwd = getAgentSessionWorkspacePath(ws.slug, sessionId)
        workspaceSlug = ws.slug
        workspace = ws
        console.log(`[Agent 服务] 使用 session 级别 cwd: ${agentCwd} (${ws.name}/${sessionId})`)

        // 迁移兼容：确保已有工作区包含 SDK plugin manifest（否则 skills 不可发现）
        ensurePluginManifest(ws.slug, ws.name)

        // 迁移兼容：旧会话在 workspace 级别 cwd 下创建，resume 在新 cwd 下会失败
        // 检测：session 目录完全为空（刚创建）→ 清除并回填历史
        //
        // 注意：SDK 不会在工作目录创建 .claude-agent/ 等可见标识文件，
        // resume 机制基于 SDK 内部状态（可能在 ~/.claude/ 或内存中），
        // 我们只需要确保不在空目录中尝试 resume（因为 cwd 迁移会导致文件路径变化）
        if (existingSdkSessionId) {
          try {
            const { readdirSync } = await import('node:fs')
            const contents = readdirSync(agentCwd)
            console.log(`[Agent 服务] 检查 session 目录: ${agentCwd}, 文件数: ${contents.length}`)

            // 只在目录完全为空时清除 sdkSessionId（说明是新创建或刚迁移的会话）
            if (contents.length === 0) {
              updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
              existingSdkSessionId = undefined
              console.log(`[Agent 服务] 迁移: session 目录为空（新创建或迁移），清除 sdkSessionId`)
            } else {
              console.log(`[Agent 服务] 保留 sdkSessionId，将尝试 resume: ${existingSdkSessionId}`)
            }
          } catch (error) {
            console.warn('[Agent 服务] 读取 session 目录失败:', error)
            // 读取失败不影响主流程，保留 sdkSessionId 尝试 resume
          }
        } else {
          console.log(`[Agent 服务] 无 sdkSessionId，将作为新会话启动（回填历史上下文）`)
        }
      }
    }

    // 8. 构建工作区 MCP 服务器配置
    const mcpServers: Record<string, Record<string, unknown>> = {}
    if (workspaceSlug) {
      const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
      for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
        // 只加载已启用的服务器（用户已通过测试验证）
        if (!entry.enabled) continue

        if (entry.type === 'stdio' && entry.command) {
          // 合并系统 PATH 到 MCP 服务器环境，确保 npx/node 等工具可被找到
          const mergedEnv: Record<string, string> = {
            ...(process.env.PATH && { PATH: process.env.PATH }),
            ...entry.env,
          }
          mcpServers[name] = {
            type: 'stdio',
            command: entry.command,
            ...(entry.args && entry.args.length > 0 && { args: entry.args }),
            ...(Object.keys(mergedEnv).length > 0 && { env: mergedEnv }),
            // 容错配置：单个服务器启动失败不影响整个 SDK
            required: false,
            startup_timeout_sec: 30,
          }
        } else if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
          mcpServers[name] = {
            type: entry.type,
            url: entry.url,
            ...(entry.headers && Object.keys(entry.headers).length > 0 && { headers: entry.headers }),
            // 容错配置
            required: false,
          }
        }
      }
      if (Object.keys(mcpServers).length > 0) {
        console.log(`[Agent 服务] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
      }
    }

    // 9. 构建动态上下文（日期时间 + 工作区实时状态 + 工作目录）
    const dynamicCtx = buildDynamicContext({
      workspaceName: workspace?.name,
      workspaceSlug,
      agentCwd,
    })
    const contextualMessage = `${dynamicCtx}\n\n${userMessage}`

    // 构建最终 prompt：/compact 命令直通 SDK
    const isCompactCommand = userMessage.trim() === '/compact'
    const finalPrompt = isCompactCommand
      ? '/compact'
      : existingSdkSessionId
        ? contextualMessage
        : buildContextPrompt(sessionId, contextualMessage)

    if (existingSdkSessionId) {
      console.log(`[Agent 服务] 使用 resume 模式，SDK session ID: ${existingSdkSessionId}`)
    } else if (finalPrompt !== contextualMessage) {
      console.log(`[Agent 服务] 无 resume，已回填历史上下文（最近 ${MAX_CONTEXT_MESSAGES} 条消息）`)
    }

    // 10. 获取权限模式并创建 canUseTool 回调
    const permissionMode: PromaPermissionMode = workspaceSlug
      ? getWorkspacePermissionMode(workspaceSlug)
      : 'smart'
    console.log(`[Agent 服务] 权限模式: ${permissionMode}`)

    const canUseTool = permissionMode !== 'auto'
      ? permissionService.createCanUseTool(
          sessionId,
          permissionMode,
          (request: PermissionRequest) => {
            // 发送权限请求到渲染进程
            webContents.send(AGENT_IPC_CHANNELS.PERMISSION_REQUEST, {
              sessionId,
              request,
            })
            // 同时作为 AgentEvent 推送（用于消息流中显示）
            const event: AgentEvent = { type: 'permission_request', request }
            webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event } as AgentStreamEvent)
          },
          // AskUserQuestion 交互式问答处理器
          (sid, input, signal, sendAskUser) => askUserService.handleAskUserQuestion(sid, input, signal, sendAskUser),
          // AskUser IPC 发送回调
          (request: AskUserRequest) => {
            webContents.send(AGENT_IPC_CHANNELS.ASK_USER_REQUEST, {
              sessionId,
              request,
            })
            // 同时作为 AgentEvent 推送
            const event: AgentEvent = { type: 'ask_user_request', request }
            webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event } as AgentStreamEvent)
          },
        )
      : undefined

    const queryIterator = sdk.query({
      prompt: finalPrompt,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        executable: agentExec.type,
        executableArgs,
        model: modelId || defaultModel,
        maxTurns: 30,
        // 权限模式：auto 使用 bypass，其他使用 default
        permissionMode: permissionMode === 'auto' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: permissionMode === 'auto',
        // 自定义权限处理器（非 auto 模式才注入）
        ...(canUseTool && { canUseTool }),
        // 只读工具白名单（SDK 级别，跳过 canUseTool 回调）
        // 注意：AskUserQuestion 不在 SAFE_TOOLS 中，会走 canUseTool 以展示交互式 UI
        ...(permissionMode !== 'auto' && { allowedTools: [...SAFE_TOOLS] }),
        includePartialMessages: true,
        cwd: agentCwd,
        abortController: controller,
        env: sdkEnv,
        // 静态 system prompt（利用 prompt caching）
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: buildSystemPromptAppend({
            workspaceName: workspace?.name,
            workspaceSlug,
            sessionId,
          }),
        },
        // 衔接上下文：有 SDK session ID 则 resume
        ...(existingSdkSessionId ? { resume: existingSdkSessionId } : {}),
        // MCP 服务器（每次 query 都从磁盘读取最新配置，支持回合间动态更新）
        ...(Object.keys(mcpServers).length > 0 && { mcpServers: mcpServers as Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig> }),
        // Skill 插件（SDK 自动发现 skills/ 目录下的 SKILL.md）
        ...(workspaceSlug && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(workspaceSlug) }] }),
        stderr: (data: string) => {
          stderrChunks.push(data)
          console.error(`[Agent SDK stderr] ${data}`)
        },
      },
    })

    console.log(`[Agent 服务] SDK query 已创建，开始遍历消息流...`)

    // 8. 遍历 SDK 消息流
    for await (const sdkMessage of queryIterator) {

      if (controller.signal.aborted) break

      const msg = sdkMessage as SDKMessage
      console.log(`[Agent 服务] 收到 SDK 消息: type=${msg.type}`)

      // 从 system init 消息中捕获 SDK 确认的模型 + 诊断 skills
      if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
        const initMsg = msg as { model?: string; skills?: string[]; tools?: string[]; plugins?: Array<{ name: string; path: string }>; slash_commands?: string[] }
        if (typeof initMsg.model === 'string') {
          resolvedModel = initMsg.model
          console.log(`[Agent 服务] SDK 确认模型: ${resolvedModel}`)
        }
        // 诊断：Skills 发现情况
        console.log(`[Agent 服务][诊断] SDK init skills: ${JSON.stringify(initMsg.skills)}`)
        console.log(`[Agent 服务][诊断] SDK init plugins: ${JSON.stringify(initMsg.plugins)}`)
        console.log(`[Agent 服务][诊断] SDK init tools 包含 Skill: ${initMsg.tools?.includes('Skill')}`)
        console.log(`[Agent 服务][诊断] SDK init slash_commands: ${JSON.stringify(initMsg.slash_commands)}`)
      }

      // 捕获 SDK session_id 用于后续 resume（参考 craft-agents-oss）
      if ('session_id' in msg && typeof msg.session_id === 'string' && msg.session_id) {
        const sdkSid = msg.session_id as string
        if (sdkSid !== existingSdkSessionId) {
          try {
            updateAgentSessionMeta(sessionId, { sdkSessionId: sdkSid })
            console.log(`[Agent 服务] 已保存 SDK session_id: ${sdkSid}`)
          } catch {
            // 索引更新失败不影响主流程
          }
        }
      }

      // 追踪 assistant 消息的 usage（实时上下文显示）
      if (msg.type === 'assistant') {
        const aMsg = msg as SDKAssistantMessage
        // 仅追踪主链消息（子代理 sidechain 不影响主上下文）
        if (!aMsg.parent_tool_use_id && aMsg.message.usage) {
          const u = aMsg.message.usage
          const currentInputTokens = u.input_tokens
            + (u.cache_read_input_tokens ?? 0)
            + (u.cache_creation_input_tokens ?? 0)
          const usageEvt: AgentEvent = {
            type: 'usage_update',
            usage: { inputTokens: currentInputTokens, contextWindow: cachedContextWindow },
          }
          webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event: usageEvt } as AgentStreamEvent)
          accumulatedEvents.push(usageEvt)
        }
      }

      // 处理 system compaction 事件
      if (msg.type === 'system') {
        const sysMsg = msg as { type: 'system'; subtype?: string; status?: string }
        if (sysMsg.subtype === 'compact_boundary') {
          const evt: AgentEvent = { type: 'compact_complete' }
          webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event: evt } as AgentStreamEvent)
          accumulatedEvents.push(evt)
          isCompacting = false
          console.log('[Agent 服务] 上下文压缩完成')
        } else if (sysMsg.subtype === 'status' && sysMsg.status === 'compacting') {
          const evt: AgentEvent = { type: 'compacting' }
          webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event: evt } as AgentStreamEvent)
          accumulatedEvents.push(evt)
          isCompacting = true
          console.log('[Agent 服务] 上下文压缩中...')
        }
      }

      const agentEvents = convertSDKMessage(
        msg,
        toolIndex,
        emittedToolStarts,
        activeParentTools,
        pendingText,
        turnId,
      )

      // 从 result 消息中缓存 contextWindow（参考 craft-agents-oss）
      if (msg.type === 'result') {
        const resultMsg = msg as SDKResultMessage
        const modelUsageEntries = Object.values(resultMsg.modelUsage || {})
        const primaryModelUsage = modelUsageEntries[0]
        if (primaryModelUsage?.contextWindow) {
          cachedContextWindow = primaryModelUsage.contextWindow
          console.log(`[Agent 服务] 缓存 contextWindow: ${cachedContextWindow}`)
        }
      }

      for (const event of agentEvents) {
        // 检查 typed_error 事件 - 立即保存错误消息并退出
        if (event.type === 'typed_error') {
          // 先保存已累积的 assistant 内容（如果有）
          if (accumulatedText || accumulatedEvents.length > 0) {
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

          // 保存 TypedError 作为 status 消息
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
          console.log(`[Agent 服务] 已保存 TypedError 消息: ${event.error.code} - ${event.error.title}`)

          // 推送 typed_error 事件给渲染进程
          webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event } as AgentStreamEvent)

          // 更新会话索引
          try {
            updateAgentSessionMeta(sessionId, {})
          } catch {
            // 索引更新失败不影响主流程
          }

          // 清理 activeController（在发送 STREAM_COMPLETE 前）
          activeControllers.delete(sessionId)

          // 发送 STREAM_COMPLETE
          webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })

          // 退出处理（错误后不应继续）
          return
        }

        // 累积文本
        if (event.type === 'text_delta') {
          accumulatedText += event.text
        }
        accumulatedEvents.push(event)

        // 推送给渲染进程
        const streamEvent: AgentStreamEvent = { sessionId, event }
        webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, streamEvent)
      }
    }

    // 9. 持久化 assistant 消息（包含完整文本和工具事件）
    if (accumulatedText || accumulatedEvents.length > 0) {
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

    // 更新会话索引
    try {
      updateAgentSessionMeta(sessionId, {})
    } catch {
      // 索引更新失败不影响主流程
    }

    // 清理 activeController（在发送 STREAM_COMPLETE 前，确保后端准备好接受新请求）
    activeControllers.delete(sessionId)

    webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })

    // Proma 官方渠道对话完成后通知渲染进程刷新余额
    if (channel.provider === 'proma') {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send(CLOUD_IPC_CHANNELS.BILLING_CHANGED)
      })
    }

    // 异步生成标题（不阻塞 stream complete 响应）
    // 使用 SDK 实际确认的模型，避免因默认模型与当前渠道不匹配导致标题生成失败。
    autoGenerateTitle(sessionId, userMessage, channelId, resolvedModel, webContents)
  } catch (error) {
    // 打印完整的 stderr 用于诊断
    const fullStderr = stderrChunks.join('').trim()
    if (fullStderr) {
      console.error(`[Agent 服务] 完整 stderr 输出 (${fullStderr.length} 字符):`)
      console.error(fullStderr)
    } else {
      console.error(`[Agent 服务] stderr 为空`)
    }

    // 用户主动中止
    if (controller.signal.aborted) {
      console.log(`[Agent 服务] 会话 ${sessionId} 已被用户中止`)

      // 保存已累积的部分内容
      if (accumulatedText || accumulatedEvents.length > 0) {
        const partialMsg: AgentMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: accumulatedText,
          createdAt: Date.now(),
          model: resolvedModel,
          events: accumulatedEvents,
        }
        appendAgentMessage(sessionId, partialMsg)
      }

      // 清理 activeController
      activeControllers.delete(sessionId)

      webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })
      return
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error(`[Agent 服务] 执行失败:`, error)

    // 保存已累积的部分内容（避免数据丢失）
    if (accumulatedText || accumulatedEvents.length > 0) {
      try {
        const partialMsg: AgentMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: accumulatedText,
          createdAt: Date.now(),
          model: resolvedModel,
          events: accumulatedEvents,
        }
        appendAgentMessage(sessionId, partialMsg)
        console.log(`[Agent 服务] ✓ 已保存部分执行结果 (${accumulatedText.length} 字符, ${accumulatedEvents.length} 事件)`)
      } catch (saveError) {
        console.error('[Agent 服务] ✗ 保存部分内容失败:', saveError)
      }
    }

    // 从 stderr 提取 API 原始错误并直接展示
    const stderrOutput = stderrChunks.join('').trim()
    const apiError = extractApiError(stderrOutput)

    let userFacingError: string
    if (apiError) {
      // 直接展示 API 原始错误，不做任何转换
      userFacingError = `API 错误 (${apiError.statusCode}):\n${apiError.message}`
    } else {
      // 无法解析 API 错误，显示基本错误信息
      userFacingError = errorMessage
    }

    // 保存错误消息到 JSONL（重要：确保错误信息持久化）
    try {
      const errorMsg: AgentMessage = {
        id: randomUUID(),
        role: 'status',
        content: userFacingError,
        createdAt: Date.now(),
        errorCode: 'unknown_error',
        errorTitle: '执行错误',
        errorOriginal: error instanceof Error ? error.stack : String(error),
      }
      appendAgentMessage(sessionId, errorMsg)
      console.log(`[Agent 服务] ✓ 已保存错误消息到 JSONL`)
    } catch (saveError) {
      console.error('[Agent 服务] ✗ 保存错误消息失败:', saveError)
    }

    // 发送错误给 UI
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: userFacingError,
    })

    // 清理 activeController（在发送 STREAM_COMPLETE 前）
    activeControllers.delete(sessionId)

    // 发送 STREAM_COMPLETE（确保前端知道流式已结束）
    webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })

    // 根据错误类型决定是否保留 sdkSessionId
    // API 配置错误（400/401/403/404）保留，服务器错误（500+）清除
    const shouldClearSession = !apiError || apiError.statusCode >= 500

    if (existingSdkSessionId && shouldClearSession) {
      try {
        updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
        console.log(`[Agent 服务] 已清除失效的 sdkSessionId`)
      } catch {
        // 清理失败不影响错误流
      }
    } else if (existingSdkSessionId && !shouldClearSession) {
      console.log(`[Agent 服务] 保留 sdkSessionId (API 错误 ${apiError?.statusCode})`)
    }

    throw error
  } finally {
    activeControllers.delete(sessionId)
    // 清理权限服务中的待处理请求
    permissionService.clearSessionPending(sessionId)
    // 清理 AskUser 服务中的待处理请求
    askUserService.clearSessionPending(sessionId)
  }
}

/** 标题生成 Prompt */
const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。\n\n用户消息：'

/** 标题最大长度 */
const MAX_TITLE_LENGTH = 20

/** 默认会话标题（用于判断是否需要自动生成） */
const DEFAULT_SESSION_TITLE = '新 Agent 会话'

/**
 * 生成 Agent 会话标题
 *
 * 使用 Provider 适配器系统，支持 Anthropic / OpenAI / Google 等所有渠道。
 * 任何错误返回 null，不影响主流程。
 */
export async function generateAgentTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  const { userMessage, channelId, modelId } = input
  console.log('[Agent 标题生成] 开始生成标题:', { channelId, modelId, userMessage: userMessage.slice(0, 50) })

  try {
    const channels = listChannels()
    const channel = channels.find((c) => c.id === channelId)
    if (!channel) {
      console.warn('[Agent 标题生成] 渠道不存在:', channelId)
      return null
    }

    // 获取 API Key 和 Base URL
    let apiKey: string
    let baseUrl: string

    if (channel.provider === 'proma') {
      // 官方渠道：使用 auth token + cloud API base URL（标题生成走 Provider 适配器）
      const token = getAuthToken()
      if (!token) {
        console.warn('[Agent 标题生成] 未登录 Cloud 账户')
        return null
      }
      apiKey = token
      baseUrl = getCloudApiConfig().baseUrl
    } else {
      try {
        apiKey = decryptApiKey(channelId)
      } catch {
        console.warn('[Agent 标题生成] 解密 API Key 失败')
        return null
      }
      baseUrl = channel.baseUrl
    }

    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
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
 * Agent 流完成后自动生成标题
 *
 * 在主进程侧检测：如果会话标题仍为默认值，说明是首次对话完成，
 * 自动调用标题生成并推送 TITLE_UPDATED 事件给渲染进程。
 * 不受组件生命周期影响，解决用户切换页面后标题不生成的问题。
 */
async function autoGenerateTitle(
  sessionId: string,
  userMessage: string,
  channelId: string,
  modelId: string,
  webContents: WebContents,
): Promise<void> {
  try {
    const meta = getAgentSessionMeta(sessionId)
    if (!meta || meta.title !== DEFAULT_SESSION_TITLE) return

    const title = await generateAgentTitle({ userMessage, channelId, modelId })
    if (!title) return

    updateAgentSessionMeta(sessionId, { title })
    webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, { sessionId, title })
    console.log(`[Agent 服务] 自动标题生成完成: "${title}"`)
  } catch (error) {
    console.warn('[Agent 服务] 自动标题生成失败:', error)
  }
}

/**
 * 中止指定会话的 Agent 执行
 */
export function stopAgent(sessionId: string): void {
  const controller = activeControllers.get(sessionId)
  if (controller) {
    controller.abort()
    activeControllers.delete(sessionId)
    console.log(`[Agent 服务] 已中止会话: ${sessionId}`)
  }
}

/** 中止所有活跃的 Agent 会话（应用退出时调用） */
export function stopAllAgents(): void {
  if (activeControllers.size === 0) return
  console.log(`[Agent 服务] 正在中止所有活跃会话 (${activeControllers.size} 个)...`)
  for (const [sessionId, controller] of activeControllers) {
    controller.abort()
    console.log(`[Agent 服务] 已中止会话: ${sessionId}`)
  }
  activeControllers.clear()
}

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const sessionDir = getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(sessionDir, file.filename)

    // 防止同名文件覆盖：若路径已存在或本批次已使用，则追加序号
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    // 确保父目录存在（支持 filename 包含子路径，如 "subdir/file.txt"）
    mkdirSync(dirname(targetPath), { recursive: true })
    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = targetPath.slice(sessionDir.length + 1)
    results.push({ filename: actualFilename, targetPath })
    console.log(`[Agent 服务] 文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}

/**
 * 复制文件夹到 Agent session 工作目录（异步版本）
 *
 * 使用异步 fs.cp 递归复制整个文件夹，返回所有复制的文件列表。
 */
export async function copyFolderToSession(input: AgentCopyFolderInput): Promise<AgentSavedFile[]> {
  const { sourcePath, workspaceSlug, sessionId } = input
  const sessionDir = getAgentSessionWorkspacePath(workspaceSlug, sessionId)

  // 获取源文件夹名称作为目标子目录
  const folderName = sourcePath.split('/').filter(Boolean).pop() || 'folder'
  const targetDir = join(sessionDir, folderName)

  // 异步递归复制
  await cp(sourcePath, targetDir, { recursive: true })
  console.log(`[Agent 服务] 文件夹已复制: ${sourcePath} → ${targetDir}`)

  // 异步遍历复制后的目录，收集所有文件路径
  const results: AgentSavedFile[] = []
  const collectFiles = async (dir: string, relativeTo: string): Promise<void> => {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(dir, item.name)
      if (item.isDirectory()) {
        await collectFiles(fullPath, relativeTo)
      } else {
        const relPath = fullPath.slice(relativeTo.length + 1)
        results.push({ filename: relPath, targetPath: fullPath })
      }
    }
  }
  await collectFiles(targetDir, sessionDir)

  console.log(`[Agent 服务] 文件夹复制完成，共 ${results.length} 个文件`)
  return results
}
