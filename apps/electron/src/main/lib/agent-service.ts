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
import { writeFileSync, mkdirSync, cpSync, readdirSync, statSync, existsSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { app } from 'electron'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { AgentSendInput, AgentEvent, AgentMessage, AgentStreamEvent, AgentGenerateTitleInput, AgentSaveFilesInput, AgentSavedFile, AgentCopyFolderInput } from '@proma/shared'
import {
  ToolIndex,
  extractToolStarts,
  extractToolResults,
  type ContentBlock,
} from '@proma/shared'
import { decryptApiKey, getChannelById, listChannels } from './channel-manager'
import {
  getAdapter,
  fetchTitle,
} from '@proma/core'
import { appendAgentMessage, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath } from './config-paths'
import { getRuntimeStatus } from './runtime-init'
import { getWorkspaceMcpConfig, ensurePluginManifest } from './agent-workspace-manager'
import { buildSystemPromptAppend, buildDynamicContext } from './agent-prompt-builder'

/** 活跃的 AbortController 映射（sessionId → controller） */
const activeControllers = new Map<string, AbortController>()

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
 * 获取 Bun 运行时路径
 *
 * 优先使用 runtime-init 检测到的路径，降级为 'bun'（依赖 PATH）。
 */
function getBunExecutablePath(): string {
  const status = getRuntimeStatus()
  return status?.bun?.path ?? 'bun'
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
 * 运行 Agent 并流式推送事件到渲染进程
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  const { sessionId, userMessage, channelId, modelId, workspaceId } = input

  // 1. 获取渠道信息并解密 API Key
  const channel = getChannelById(channelId)
  if (!channel) {
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: '渠道不存在',
    })
    return
  }

  let apiKey: string
  try {
    apiKey = decryptApiKey(channelId)
  } catch {
    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: '解密 API Key 失败',
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
  // 自定义 Base URL 时注入 ANTHROPIC_BASE_URL
  if (channel.baseUrl && channel.baseUrl !== DEFAULT_ANTHROPIC_URL) {
    sdkEnv.ANTHROPIC_BASE_URL = channel.baseUrl
  } else {
    // 确保不会残留上一次的 Base URL
    delete sdkEnv.ANTHROPIC_BASE_URL
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
  let resolvedModel = modelId || 'claude-sonnet-4-5-20250929'
  // 收集 stderr 输出用于错误诊断（声明在 try 之前，确保 catch 可访问）
  const stderrChunks: string[] = []

  try {
    // 6. 动态导入 SDK（避免在 esbuild 打包时出问题）
    const sdk = await import('@anthropic-ai/claude-agent-sdk')

    // 7. 构建 SDK query（通过 env 注入认证信息）
    const cliPath = resolveSDKCliPath()
    const bunPath = getBunExecutablePath()

    // 路径验证
    if (!existsSync(cliPath)) {
      const errMsg = `SDK CLI 文件不存在: ${cliPath}`
      console.error(`[Agent 服务] ${errMsg}`)
      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, { sessionId, error: errMsg })
      return
    }

    // 确保 ripgrep 可用（打包环境下创建 symlink）
    ensureRipgrepAvailable(cliPath)

    console.log(`[Agent 服务] 启动 SDK — CLI: ${cliPath}, Bun: ${bunPath}, 模型: ${modelId || 'claude-sonnet-4-5-20250929'}, resume: ${existingSdkSessionId ?? '无'}`)

    // 安全：--env-file=/dev/null 阻止 Bun 自动加载用户项目中的 .env 文件
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'

    // 确定 Agent 工作目录：优先使用 session 级别路径
    let agentCwd = homedir()
    let workspaceSlug: string | undefined
    let workspace: import('@proma/shared').AgentWorkspace | undefined
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
        executable: bunPath as 'bun',
        executableArgs: [`--env-file=${nullDevice}`],
        model: modelId || 'claude-sonnet-4-5-20250929',
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
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
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

      // 从 system init 消息中捕获 SDK 确认的模型
      if (msg.type === 'system' && 'model' in msg && typeof msg.model === 'string') {
        resolvedModel = msg.model
        console.log(`[Agent 服务] SDK 确认模型: ${resolvedModel}`)
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

    webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })

    // 异步生成标题（不阻塞 stream complete 响应）
    autoGenerateTitle(sessionId, userMessage, channelId, modelId || 'claude-sonnet-4-5-20250929', webContents)
  } catch (error) {
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

      webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId })
      return
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error(`[Agent 服务] 执行失败:`, error)

    // 构建包含 stderr 诊断信息的错误消息
    const stderrOutput = stderrChunks.join('').trim()
    const detailedError = stderrOutput
      ? `${errorMessage}\n\nstderr: ${stderrOutput.slice(0, 500)}`
      : errorMessage

    // 如果是 resume 失败，清除 sdkSessionId 以便下次重新开始
    if (existingSdkSessionId) {
      try {
        updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
        console.log(`[Agent 服务] 已清除失效的 sdkSessionId，下次发送将重新开始`)
      } catch {
        // 清理失败不影响错误流
      }
    }

    webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
      sessionId,
      error: detailedError,
    })
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

  try {
    const channels = listChannels()
    const channel = channels.find((c) => c.id === channelId)
    if (!channel) {
      console.warn('[Agent 标题生成] 渠道不存在:', channelId)
      return null
    }

    const apiKey = decryptApiKey(channelId)
    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const title = await fetchTitle(request, adapter)
    if (!title) return null

    const cleaned = title.trim().replace(/^["'""''「《]+|["'""''」》]+$/g, '').trim()
    const result = cleaned.slice(0, MAX_TITLE_LENGTH) || null

    console.log(`[Agent 标题生成] 生成标题: "${result}"`)
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

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const sessionDir = getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId)
  const results: AgentSavedFile[] = []

  for (const file of input.files) {
    const targetPath = join(sessionDir, file.filename)
    // 确保父目录存在（支持 filename 包含子路径，如 "subdir/file.txt"）
    mkdirSync(dirname(targetPath), { recursive: true })
    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)
    results.push({ filename: file.filename, targetPath })
    console.log(`[Agent 服务] 文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}

/**
 * 复制文件夹到 Agent session 工作目录
 *
 * 使用 fs.cpSync 递归复制整个文件夹，返回所有复制的文件列表。
 */
export function copyFolderToSession(input: AgentCopyFolderInput): AgentSavedFile[] {
  const { sourcePath, workspaceSlug, sessionId } = input
  const sessionDir = getAgentSessionWorkspacePath(workspaceSlug, sessionId)

  // 获取源文件夹名称作为目标子目录
  const folderName = sourcePath.split('/').filter(Boolean).pop() || 'folder'
  const targetDir = join(sessionDir, folderName)

  // 递归复制
  cpSync(sourcePath, targetDir, { recursive: true })
  console.log(`[Agent 服务] 文件夹已复制: ${sourcePath} → ${targetDir}`)

  // 遍历复制后的目录，收集所有文件路径
  const results: AgentSavedFile[] = []
  const collectFiles = (dir: string, relativeTo: string): void => {
    const items = readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = join(dir, item.name)
      if (item.isDirectory()) {
        collectFiles(fullPath, relativeTo)
      } else {
        const relPath = fullPath.slice(relativeTo.length + 1)
        results.push({ filename: relPath, targetPath: fullPath })
      }
    }
  }
  collectFiles(targetDir, sessionDir)

  console.log(`[Agent 服务] 文件夹复制完成，共 ${results.length} 个文件`)
  return results
}
