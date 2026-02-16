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
import type { AgentSendInput, AgentEvent, AgentMessage, AgentStreamEvent, AgentGenerateTitleInput, AgentSaveFilesInput, AgentSavedFile, AgentCopyFolderInput } from '@proma/shared'
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

/** 活跃的 AbortController 映射（sessionId → controller） */
const activeControllers = new Map<string, AbortController>()

// ===== 错误重试机制 =====

/** 重试配置 */
const RETRY_CONFIG = {
  /** 最大重试次数 */
  maxAttempts: 3,
  /** 初始延迟（秒） */
  initialDelaySeconds: 1,
  /** 延迟倍数（指数退避） */
  delayMultiplier: 2,
  /** 初始响应超时（毫秒） - 用于检测网络连接问题 */
  initialResponseTimeoutMs: 30000, // 30 秒
  /** 流式输出超时（毫秒） - 用于检测连接中断（仅当没有活跃工具时） */
  streamingTimeoutMs: 60000, // 60 秒
  /** 工具执行超时（毫秒） - 工具执行时的宽松超时 */
  toolExecutionTimeoutMs: 300000, // 5 分钟
} as const

/**
 * 判断错误是否可重试
 *
 * 可重试的错误类型：
 * - 网络错误（连接失败、超时、DNS 解析失败）
 * - API 临时错误（429, 500, 502, 503, 504）
 * - MCP 服务器启动失败（stderr 包含 MCP 相关错误）
 * - SDK 无响应超时（我们主动触发的超时）
 *
 * 不可重试的错误：
 * - 认证错误（401, 403, Invalid API key）
 * - 参数错误（400, 422）
 * - 用户主动中止（AbortError）
 * - 工作区配置问题
 */
function isRetryableError(error: unknown, stderrOutput: string): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const stack = error instanceof Error ? error.stack?.toLowerCase() || '' : ''

  // 用户主动中止 - 不重试（注意：超时触发的 abort 会被标记为 isTimeoutAborted，不会走到这里）
  if (message.includes('abort') && !message.includes('timeout')) return false

  // 认证错误 - 不重试
  if (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid api key') ||
    message.includes('authentication')
  ) {
    return false
  }

  // 参数错误 - 不重试
  if (message.includes('400') || message.includes('422') || message.includes('invalid request')) {
    return false
  }

  // 超时错误 - 重试（包括我们主动触发的超时）
  if (message.includes('etimedout') || message.includes('timeout') || message.includes('无响应超时')) {
    return true
  }

  // 网络错误 - 重试
  const networkErrors = [
    'econnrefused',
    'enotfound',
    'eai_again',
    'enetunreach',
    'ehostunreach',
    'fetch failed',
    'socket hang up',
    'network error',
    'connect timeout',
  ]
  if (networkErrors.some((err) => message.includes(err) || stack.includes(err))) {
    return true
  }

  // API 临时错误 - 重试
  const retryableStatuses = ['429', '500', '502', '503', '504']
  if (retryableStatuses.some((status) => message.includes(status))) {
    return true
  }

  // MCP 服务器启动失败 - 重试（但限制次数，避免配置错误导致无限重试）
  if (stderrOutput.toLowerCase().includes('mcp') && (
    message.includes('spawn') ||
    message.includes('enoent') ||
    stderrOutput.includes('error')
  )) {
    return true
  }

  // 其他未知错误 - 默认不重试（保守策略）
  return false
}

/**
 * 提取错误的简短描述（用于重试通知）
 */
function getErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  // 超时错误（优先检测，包括我们自己抛出的超时错误）
  if (message.includes('ETIMEDOUT') || message.toLowerCase().includes('timeout') || message.includes('无响应超时')) {
    return 'SDK 响应超时'
  }

  // 网络错误
  if (message.toLowerCase().includes('econnrefused')) return '连接被拒绝'
  if (message.toLowerCase().includes('enotfound')) return 'DNS 解析失败'
  if (message.toLowerCase().includes('fetch failed')) return '网络请求失败'

  // API 错误
  if (message.includes('429')) return 'API 速率限制'
  if (message.includes('500')) return '服务器内部错误'
  if (message.includes('502')) return '网关错误'
  if (message.includes('503')) return '服务不可用'
  if (message.includes('504')) return '网关超时'

  // 截断过长的消息
  const maxLength = 50
  return message.length > maxLength ? message.slice(0, maxLength) + '...' : message
}

/**
 * 延迟指定秒数（异步）
 */
function delay(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
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

      // SDK 级别错误
      if (msg.error) {
        events.push({ type: 'error', message: msg.error.message || '未知 SDK 错误' })
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
 * 运行 Agent 并流式推送事件到渲染进程（带自动重试）
 *
 * 包装原 runAgent 函数，添加智能重试机制：
 * - 检测可恢复的错误（网络中断、API 临时故障、MCP 服务器启动失败）
 * - 指数退避重试（1s → 2s → 4s）
 * - 实时通知 UI 重试状态
 * - 达到上限后停止，避免无限重试
 */
export async function runAgentWithRetry(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  let attempt = 0
  const stderrChunks: string[] = []

  while (attempt < RETRY_CONFIG.maxAttempts) {
    attempt++

    try {
      // 尝试运行 Agent
      await runAgentInternal(input, webContents, stderrChunks)
      // 成功完成 - 退出重试循环
      return
    } catch (error) {
      const stderrOutput = stderrChunks.join('').trim()
      const isRetryable = isRetryableError(error, stderrOutput)

      // 最后一次尝试失败 - 不再重试
      if (attempt >= RETRY_CONFIG.maxAttempts) {
        console.error(`[Agent 服务] 重试失败，已达到最大次数 (${RETRY_CONFIG.maxAttempts})`)
        // 错误已在 runAgentInternal 中发送给 UI，这里直接返回
        return
      }

      // 不可重试的错误 - 立即失败
      if (!isRetryable) {
        console.log(`[Agent 服务] 错误不可重试，停止尝试: ${error instanceof Error ? error.message : error}`)
        return
      }

      // 可重试 - 延迟后重试
      const delaySeconds = RETRY_CONFIG.initialDelaySeconds * Math.pow(RETRY_CONFIG.delayMultiplier, attempt - 1)
      const reason = getErrorReason(error)

      console.log(
        `[Agent 服务] 遇到可恢复错误，准备重试 (${attempt}/${RETRY_CONFIG.maxAttempts}): ${reason}`,
      )

      // 发送重试事件给 UI
      const retryEvent: AgentEvent = {
        type: 'retrying',
        attempt,
        maxAttempts: RETRY_CONFIG.maxAttempts,
        delaySeconds,
        reason,
      }
      webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
        sessionId: input.sessionId,
        event: retryEvent,
      } as AgentStreamEvent)

      // 等待后重试
      await delay(delaySeconds)

      // 清空 stderr 缓冲区（避免上一次的错误干扰判断）
      stderrChunks.length = 0
    }
  }
}

/**
 * 运行 Agent 并流式推送事件到渲染进程（内部实现）
 *
 * 原 runAgent 逻辑，改名为 runAgentInternal，供重试包装器调用。
 */
async function runAgentInternal(
  input: AgentSendInput,
  webContents: WebContents,
  stderrChunks: string[],
): Promise<void> {
  const { sessionId, userMessage, channelId, modelId, workspaceId } = input

  // 0. Windows 平台：检查 Shell 环境可用性
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
  // 超时检测变量（声明在 try 之前，供 catch 块使用）
  let lastActivityTime = Date.now()
  let inactivityTimer: NodeJS.Timeout | null = null
  let receivedFirstMessage = false // 是否已收到第一条消息（用于检测初始连接问题）
  let activeToolCount = 0 // 当前正在执行的工具数量
  let isTimeoutAborted = false // 是否因超时而中止（区分用户主动中止）

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
        // 检测：有 sdkSessionId 但 session 目录为空（刚创建）→ 清除 sdkSessionId，回填历史上下文
        if (existingSdkSessionId) {
          try {
            const { readdirSync } = await import('node:fs')
            const contents = readdirSync(agentCwd)
            if (contents.length === 0) {
              updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
              existingSdkSessionId = undefined
              console.log(`[Agent 服务] 迁移: session 目录为空，清除 sdkSessionId，回填历史上下文`)
            }
          } catch {
            // 读取失败不影响主流程
          }
        }
      }
    }

    // 8. 构建工作区 MCP 服务器配置
    const mcpServers: Record<string, Record<string, unknown>> = {}
    if (workspaceSlug) {
      const mcpConfig = getWorkspaceMcpConfig(workspaceSlug)
      for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
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
          }
        } else if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
          mcpServers[name] = {
            type: entry.type,
            url: entry.url,
            ...(entry.headers && Object.keys(entry.headers).length > 0 && { headers: entry.headers }),
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

    if (finalPrompt !== contextualMessage) {
      console.log(`[Agent 服务] 已回填历史上下文（无 resume）`)
    }

    const queryIterator = sdk.query({
      prompt: finalPrompt,
      options: {
        pathToClaudeCodeExecutable: cliPath,
        executable: agentExec.type,
        executableArgs,
        model: modelId || defaultModel,
        maxTurns: 30,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
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

    // 智能超时检测：根据当前状态动态调整超时时间
    lastActivityTime = Date.now()
    receivedFirstMessage = false
    activeToolCount = 0

    const resetInactivityTimer = (): void => {
      lastActivityTime = Date.now()
      if (inactivityTimer) {
        clearTimeout(inactivityTimer)
      }

      // 根据当前状态选择超时时间
      let timeoutMs: number
      let timeoutReason: string

      if (!receivedFirstMessage) {
        // 阶段 1：等待初始响应（检测网络连接问题）
        timeoutMs = RETRY_CONFIG.initialResponseTimeoutMs
        timeoutReason = '等待初始响应'
      } else if (activeToolCount > 0) {
        // 阶段 2：工具正在执行（允许长时间操作）
        timeoutMs = RETRY_CONFIG.toolExecutionTimeoutMs
        timeoutReason = `工具执行中 (${activeToolCount} 个活跃工具)`
      } else {
        // 阶段 3：流式输出中（检测连接中断）
        timeoutMs = RETRY_CONFIG.streamingTimeoutMs
        timeoutReason = '流式输出中'
      }

      inactivityTimer = setTimeout(() => {
        const elapsed = Date.now() - lastActivityTime
        if (elapsed >= timeoutMs && !controller.signal.aborted) {
          console.warn(
            `[Agent 服务] SDK 无响应超时 (${elapsed}ms, 限制: ${timeoutMs}ms, 状态: ${timeoutReason})，主动中止`,
          )
          isTimeoutAborted = true
          controller.abort()
        }
      }, timeoutMs)
    }

    resetInactivityTimer()

    // 8. 遍历 SDK 消息流
    for await (const sdkMessage of queryIterator) {
      // 标记已收到第一条消息
      if (!receivedFirstMessage) {
        receivedFirstMessage = true
        console.log('[Agent 服务] 已收到初始响应')
      }

      // 重置超时计时器（收到新消息）
      resetInactivityTimer()

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
          console.log('[Agent 服务] 上下文压缩完成')
        } else if (sysMsg.subtype === 'status' && sysMsg.status === 'compacting') {
          const evt: AgentEvent = { type: 'compacting' }
          webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, event: evt } as AgentStreamEvent)
          accumulatedEvents.push(evt)
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
        // 累积文本
        if (event.type === 'text_delta') {
          accumulatedText += event.text
        }
        accumulatedEvents.push(event)

        // 追踪工具执行状态（用于智能超时检测）
        if (event.type === 'tool_start') {
          activeToolCount++
          console.log(`[Agent 服务] 工具开始执行: ${event.toolName} (活跃工具数: ${activeToolCount})`)
          // 工具开始执行 - 切换到工具执行超时模式
          resetInactivityTimer()
        } else if (event.type === 'tool_result') {
          activeToolCount = Math.max(0, activeToolCount - 1)
          console.log(`[Agent 服务] 工具执行完成: ${event.toolName ?? '未知'} (剩余活跃工具: ${activeToolCount})`)
          // 工具执行完成 - 如果没有其他工具了，切换回流式输出超时模式
          resetInactivityTimer()
        }

        // 推送给渲染进程
        const streamEvent: AgentStreamEvent = { sessionId, event }
        webContents.send(AGENT_IPC_CHANNELS.STREAM_EVENT, streamEvent)
      }
    }

    // 清理超时计时器
    if (inactivityTimer) {
      clearTimeout(inactivityTimer)
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
    // 清理超时计时器
    if (inactivityTimer) {
      clearTimeout(inactivityTimer)
    }

    // 用户主动中止
    if (controller.signal.aborted && !isTimeoutAborted) {
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

      webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })
      return
    }

    // 超时情况：抛出可重试的错误
    if (isTimeoutAborted) {
      console.warn(`[Agent 服务] SDK 响应超时，准备重试`)
      throw new Error('ETIMEDOUT: SDK 无响应超时')
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[Agent 服务] 执行失败:`, error)

    // 诊断信息：检查累积状态
    console.log(`[Agent 服务][诊断] 累积状态 - 文本长度: ${accumulatedText.length}, 事件数: ${accumulatedEvents.length}`)

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
    } else {
      console.log('[Agent 服务] 无部分内容可保存（累积为空）')
    }

    // 构建包含详细诊断信息的错误消息
    const stderrOutput = stderrChunks.join('').trim()
    const diagnosticParts: string[] = []

    // 主错误消息
    diagnosticParts.push(`错误: ${errorMessage}`)

    // stderr 输出（如果有）
    if (stderrOutput) {
      // 提取最后 1000 字符，通常包含最相关的错误信息
      const relevantStderr = stderrOutput.slice(-1000)
      diagnosticParts.push(`\nStderr 输出:\n${relevantStderr}`)
    }

    // 运行环境信息（帮助诊断）
    diagnosticParts.push('\n运行环境:')
    if (agentExec) {
      diagnosticParts.push(`- 运行时: ${agentExec.type} (${agentExec.path})`)
    }
    diagnosticParts.push(`- 模型: ${modelId || defaultModel}`)
    diagnosticParts.push(`- 平台: ${process.platform} ${process.arch}`)
    if (workspaceSlug && workspace) {
      diagnosticParts.push(`- 工作区: ${workspace.name} (${agentCwd || '未知'})`)
    }
    if (existingSdkSessionId) {
      diagnosticParts.push(`- Resume: ${existingSdkSessionId}`)
    }

    // 堆栈跟踪（仅在非生产环境或开发模式下）
    if (errorStack && (!app.isPackaged || process.env.NODE_ENV === 'development')) {
      diagnosticParts.push(`\n堆栈跟踪:\n${errorStack.slice(0, 500)}`)
    }

    const detailedError = diagnosticParts.join('\n')

    // 完整错误信息输出到控制台，便于调试
    console.error('[Agent 服务] 详细错误信息:', detailedError)

    // 如果是 resume 失败，清除 sdkSessionId 以便下次重新开始
    if (existingSdkSessionId) {
      try {
        updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
        console.log(`[Agent 服务] 已清除失效的 sdkSessionId，下次发送将重新开始`)
      } catch {
        // 清理失败不影响错误流
      }
    }

    // 发送错误给 UI（即使即将重试，也让用户先看到错误）
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: detailedError,
    })

    // 抛出异常供外层重试逻辑捕获
    throw error
  } finally {
    activeControllers.delete(sessionId)
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
