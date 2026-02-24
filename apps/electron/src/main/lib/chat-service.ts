/**
 * AI 聊天流式服务（Electron 编排层）
 *
 * 负责 Electron 特定的操作：
 * - 查找渠道、解密 API Key
 * - 管理 AbortController
 * - 调用 @proma/core 的 Provider 适配器系统
 * - 桥接 StreamEvent → webContents.send()
 * - 持久化消息到 JSONL + 更新索引
 * - 记忆工具的 function calling 循环（当记忆功能启用时）
 *
 * 纯逻辑（消息转换、SSE 解析、请求构建）已抽象到 @proma/core/providers。
 */

import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { CHAT_IPC_CHANNELS } from '@proma/shared'
import type { ChatSendInput, ChatMessage, GenerateTitleInput, FileAttachment, MemoryConfig } from '@proma/shared'
// Cloud 模式专属 IPC 通道
import { CLOUD_IPC_CHANNELS } from '@proma/shared'
import {
  getAdapter,
  streamSSE,
  fetchTitle,
} from '@proma/core'
import type { ImageAttachmentData, ToolDefinition, ToolCall, ToolResult, ContinuationMessage } from '@proma/core'
import { listChannels, decryptApiKey } from './channel-manager'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { appendMessage, updateConversationMeta, getConversationMessages } from './conversation-manager'
import { readAttachmentAsBase64, isImageAttachment } from './attachment-service'
import { extractTextFromAttachment, isDocumentAttachment } from './document-parser'
import { getUserProfile } from './user-profile-service'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getMemoryConfig } from './memory-service'
import { searchMemory, addMemory, formatSearchResult } from './memos-client'

/** 活跃的 AbortController 映射（conversationId → controller） */
const activeControllers = new Map<string, AbortController>()

// ===== 默认系统提示词 =====

/**
 * 构建 Chat 默认系统提示词
 *
 * 插值当前日期时间和用户名。
 */
function buildDefaultSystemPrompt(): string {
  const profile = getUserProfile()
  const userName = profile.userName || '用户'

  const now = new Date()
  const dateTimeStr = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  return `当前时间：${dateTimeStr}
用户名称：${userName}

你首先是某个大模型，这我们当然知道，你现在的任务是作为 Proma AI 助手，来帮助我解决实际问题。

你需要在以下一些方面上保持关注：
1.首先是尽可能简单的帮助我直接解决问题，除非我要求详细或者简单，但如果解决的方案依赖前置信息，请多向我提问；
2.当你给出的教程需要多步执行，或者存在多种方法时，请注意不要一次性直接输出，可以先给出结构和选项，要减少用户的认知压力，可以通过渐进式引导的方式跟我一起互动解决；
3.你需要时刻关注我的上下文，根据上下文来推测我的实际能力或者水平，避免出现过难的解答，除非我要求，但你可以主动跟我询问；
4.当你遇到不确定的部分，避免你主观决断或者采用太多默认设计，要更积极的跟我询问和确定；
5.当你发现我是在学习某件事的时候，避免让我处理可能已经远超过当前概念或者能力的决断，要多鼓励我；
6.如果你采用了一些引用，可以将引用也利用 markdown 的语法包裹，这样我可以直接点击引用的部分就能够直接访问；
7.你总是保持耐心，富有人性，简洁关键的解答我的问题；
8.可能在很多情况下，你可能意识到某种跟我的疑问极度相关的知识的内核，但因为我可能不知道所以我无法通过提示词的方式触达这些，请在你意识到的时候主动给我提醒或者选择，但也请注意不要给我过多的认知压力。`
}

// ===== 记忆工具定义 =====

/** Chat 模式记忆工具定义 */
const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'recall_memory',
    description: 'Search user memories (facts and preferences). Use this to recall relevant context about the user before responding.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for memory retrieval' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_memory',
    description: 'Store a conversation message pair for long-term memory. Call this after meaningful exchanges worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        userMessage: { type: 'string', description: 'The user message to store' },
        assistantMessage: { type: 'string', description: 'The assistant response to store' },
      },
      required: ['userMessage'],
    },
  },
]

/** 记忆系统提示词追加 */
const MEMORY_SYSTEM_PROMPT = `
<memory_instructions>
你拥有跨会话的记忆能力。

**recall_memory — 回忆：**
在你觉得过去的经历可能对当前有帮助时主动调用：
- 用户提到"之前"、"上次"等回溯性表述
- 当前任务可能和过去做过的事情有关

**add_memory — 记住：**
当对话中发生值得记住的事时调用：
- 用户分享了工作方式或偏好
- 一起做了重要决定
- 解决了棘手问题

自然地运用记忆，不要提及"记忆系统"等内部概念。
</memory_instructions>`

/** 最大工具续接轮数（防止无限循环） */
const MAX_TOOL_ROUNDS = 5

// ===== 平台相关：图片附件读取器 =====

/**
 * 读取图片附件的 base64 数据
 *
 * 此函数作为 ImageAttachmentReader 注入给 core 层，
 * 因为文件系统读取属于 Electron 平台操作。
 */
function getImageAttachmentData(attachments?: FileAttachment[]): ImageAttachmentData[] {
  if (!attachments || attachments.length === 0) return []

  return attachments
    .filter((att) => isImageAttachment(att.mediaType))
    .map((att) => ({
      mediaType: att.mediaType,
      data: readAttachmentAsBase64(att.localPath),
    }))
}

// ===== 文档附件文本提取 =====

/**
 * 为单条消息提取文档附件的文本内容
 *
 * 将非图片附件的文本内容提取后，以结构化格式追加到消息文本后面。
 * 图片附件由适配器层单独处理，这里只处理文档类附件。
 *
 * @param messageText 原始消息文本
 * @param attachments 消息的附件列表
 * @returns 包含文档文本的增强消息
 */
async function enrichMessageWithDocuments(
  messageText: string,
  attachments?: FileAttachment[],
): Promise<string> {
  if (!attachments || attachments.length === 0) return messageText

  // 筛选出文档类附件（非图片）
  const docAttachments = attachments.filter((att) => isDocumentAttachment(att.mediaType))
  if (docAttachments.length === 0) return messageText

  const parts: string[] = [messageText]

  for (const att of docAttachments) {
    try {
      const text = await extractTextFromAttachment(att.localPath)
      if (text.trim()) {
        parts.push(`\n<file name="${att.filename}">\n${text}\n</file>`)
      } else {
        parts.push(`\n<file name="${att.filename}">\n[文件内容为空]\n</file>`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误'
      console.warn(`[聊天服务] 文档提取失败: ${att.filename}`, error)
      parts.push(`\n<file name="${att.filename}">\n[文件内容提取失败: ${errorMsg}]\n</file>`)
    }
  }

  return parts.join('')
}

/**
 * 为历史消息列表注入文档附件文本
 *
 * 遍历历史消息，对包含文档附件的用户消息进行文本增强。
 * 返回新的消息数组（不修改原始消息）。
 */
async function enrichHistoryWithDocuments(
  history: ChatMessage[],
): Promise<ChatMessage[]> {
  const enriched: ChatMessage[] = []

  for (const msg of history) {
    // 只对包含附件的用户消息进行文档提取
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const hasDocuments = msg.attachments.some((att) => isDocumentAttachment(att.mediaType))
      if (hasDocuments) {
        const enrichedContent = await enrichMessageWithDocuments(msg.content, msg.attachments)
        enriched.push({ ...msg, content: enrichedContent })
        continue
      }
    }
    enriched.push(msg)
  }

  return enriched
}

// ===== 上下文过滤 =====

/**
 * 根据分隔线和上下文长度裁剪历史消息
 *
 * 三层过滤：
 * 1. 分隔线过滤：仅保留最后一个分隔线之后的消息
 * 2. 轮数裁剪：按轮数（user+assistant = 1 轮）限制历史
 * 3. contextLength === 'infinite' 或 undefined 时保留全部
 */
function filterHistory(
  messageHistory: ChatMessage[],
  contextDividers?: string[],
  contextLength?: number | 'infinite',
): ChatMessage[] {
  // 过滤掉空内容的助手消息，避免发送无效消息给 API
  let filtered = messageHistory.filter(
    (msg) => !(msg.role === 'assistant' && !msg.content.trim()),
  )

  // 分隔线过滤：仅保留最后一个分隔线之后的消息
  if (contextDividers && contextDividers.length > 0) {
    const lastDividerId = contextDividers[contextDividers.length - 1]
    const dividerIndex = filtered.findIndex((msg) => msg.id === lastDividerId)
    if (dividerIndex >= 0) {
      filtered = filtered.slice(dividerIndex + 1)
    }
  }

  // 上下文长度过滤：按轮数裁剪
  if (typeof contextLength === 'number' && contextLength >= 0) {
    if (contextLength === 0) {
      return []
    }
    // 从后往前，收集 N 轮对话
    const collected: ChatMessage[] = []
    let roundCount = 0
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i] as ChatMessage
      collected.unshift(msg)
      // 每遇到一条 user 消息算一轮结束
      if (msg.role === 'user') {
        roundCount++
        if (roundCount >= contextLength) break
      }
    }
    return collected
  }

  // contextLength === 'infinite' 或 undefined 时保留全部
  return filtered
}

// ===== Proma 官方渠道错误处理 =====

/**
 * 从 streamSSE 抛出的错误消息中提取 HTTP 状态码
 *
 * 错误格式固定为: `{providerType} API 错误 ({status}): {body}`
 */
function extractHttpStatus(errorMessage: string): number {
  const match = errorMessage.match(/\((\d{3})\)/)
  return match?.[1] ? parseInt(match[1]) : 0
}

/** 向所有窗口广播额度不足事件 */
function broadcastQuotaExceeded(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED)
  })
}

/** 向所有窗口广播余额变动事件（对话扣费后） */
function broadcastBillingChanged(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.BILLING_CHANGED)
  })
}

// ===== 记忆工具执行 =====

/**
 * 执行记忆工具调用
 */
async function executeMemoryToolCall(
  toolCall: ToolCall,
  memoryConfig: MemoryConfig,
): Promise<ToolResult> {
  const credentials = {
    apiKey: memoryConfig.apiKey,
    userId: memoryConfig.userId?.trim() || 'proma-user',
    baseUrl: memoryConfig.baseUrl,
  }

  try {
    if (toolCall.name === 'recall_memory') {
      const query = toolCall.arguments.query as string
      const result = await searchMemory(credentials, query)
      return {
        toolCallId: toolCall.id,
        content: formatSearchResult(result),
      }
    } else if (toolCall.name === 'add_memory') {
      const userMessage = toolCall.arguments.userMessage as string
      const assistantMessage = toolCall.arguments.assistantMessage as string | undefined
      await addMemory(credentials, { userMessage, assistantMessage })
      return {
        toolCallId: toolCall.id,
        content: 'Memory stored successfully.',
      }
    }
    return {
      toolCallId: toolCall.id,
      content: `Unknown tool: ${toolCall.name}`,
      isError: true,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[聊天服务] 记忆工具执行失败 (${toolCall.name}):`, error)
    return {
      toolCallId: toolCall.id,
      content: `Tool execution failed: ${msg}`,
      isError: true,
    }
  }
}

// ===== 核心流式函数 =====

/**
 * 发送消息并流式返回 AI 响应
 *
 * 当记忆功能启用时，自动注入记忆工具定义并处理 tool use 循环。
 *
 * @param input 发送参数
 * @param webContents 渲染进程的 webContents 实例（用于推送事件）
 */
export async function sendMessage(
  input: ChatSendInput,
  webContents: WebContents,
): Promise<void> {
  const {
    conversationId, userMessage, channelId,
    modelId, systemMessage: customSystemMessage, contextLength, contextDividers, attachments,
    thinkingEnabled,
  } = input

  // 使用自定义系统提示词，否则使用默认提示词
  const systemMessage = customSystemMessage || buildDefaultSystemPrompt()

  // 1. 查找渠道
  const channels = listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) {
    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: '渠道不存在',
    })
    return
  }

  // 2. 获取 API Key 和 Base URL
  let apiKey: string
  let baseUrl: string

  if (channel.provider === 'proma') {
    // 官方渠道：使用 auth token + cloud API base URL
    const token = getAuthToken()
    if (!token) {
      webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
        conversationId,
        error: '未登录 Cloud 账户',
      })
      return
    }
    apiKey = token
    baseUrl = getCloudApiConfig().baseUrl
  } else {
    // 用户渠道：解密 API Key，使用渠道自身 baseUrl
    try {
      apiKey = decryptApiKey(channelId)
    } catch {
      webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
        conversationId,
        error: '解密 API Key 失败',
      })
      return
    }
    baseUrl = channel.baseUrl
  }

  // 3. 先读取历史消息（在追加用户消息之前，避免 adapter 重复发送当前消息）
  const fullHistory = getConversationMessages(conversationId)

  // 4. 追加用户消息到 JSONL
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  }
  appendMessage(conversationId, userMsg)

  // 5. 过滤历史并提取文档附件文本
  const filteredHistory = filterHistory(fullHistory, contextDividers, contextLength)
  const enrichedHistory = await enrichHistoryWithDocuments(filteredHistory)
  const enrichedUserMessage = await enrichMessageWithDocuments(userMessage, attachments)

  // 6. 创建 AbortController
  const controller = new AbortController()
  activeControllers.set(conversationId, controller)

  // 在 try 外累积流式内容，abort 时 catch 块仍可访问
  let accumulatedContent = ''
  let accumulatedReasoning = ''

  try {
    // 7. 获取适配器
    const adapter = getAdapter(channel.provider)

    // 8. 检查记忆功能
    const memoryConfig = getMemoryConfig()
    const memoryEnabled = memoryConfig.enabled && !!memoryConfig.apiKey
    const tools = memoryEnabled ? MEMORY_TOOLS : undefined

    // 注入记忆系统提示词
    const effectiveSystemMessage = memoryEnabled && systemMessage
      ? systemMessage + MEMORY_SYSTEM_PROMPT
      : memoryEnabled
        ? MEMORY_SYSTEM_PROMPT
        : systemMessage

    // 9. 获取代理配置
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)

    /** 构建并执行流式请求（含记忆工具续接循环） */
    const executeStream = async (key: string) => {
      let continuationMessages: ContinuationMessage[] = []
      let round = 0

      while (round < MAX_TOOL_ROUNDS) {
        round++

        const request = adapter.buildStreamRequest({
          baseUrl,
          apiKey: key,
          modelId,
          history: enrichedHistory,
          userMessage: enrichedUserMessage,
          systemMessage: effectiveSystemMessage,
          attachments,
          readImageAttachments: getImageAttachmentData,
          thinkingEnabled,
          tools,
          continuationMessages: continuationMessages.length > 0 ? continuationMessages : undefined,
        })

        const { content, toolCalls, stopReason } = await streamSSE({
          request,
          adapter,
          signal: controller.signal,
          fetchFn,
          onEvent: (event) => {
            switch (event.type) {
              case 'chunk':
                accumulatedContent += event.delta
                webContents.send(CHAT_IPC_CHANNELS.STREAM_CHUNK, {
                  conversationId,
                  delta: event.delta,
                })
                break
              case 'reasoning':
                accumulatedReasoning += event.delta
                webContents.send(CHAT_IPC_CHANNELS.STREAM_REASONING, {
                  conversationId,
                  delta: event.delta,
                })
                break
              case 'tool_call_start':
                webContents.send(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, {
                  conversationId,
                  activity: { type: 'start', toolName: event.toolName, toolCallId: event.toolCallId },
                })
                break
            }
          },
        })

        // 如果没有工具调用或不是 tool_use 停止，退出循环
        if (!toolCalls || toolCalls.length === 0 || stopReason !== 'tool_use') {
          break
        }

        // 执行工具调用
        const toolResults: ToolResult[] = []
        for (const tc of toolCalls) {
          if (tc.name === 'recall_memory' || tc.name === 'add_memory') {
            const result = await executeMemoryToolCall(tc, memoryConfig)
            toolResults.push(result)

            // 发送工具结果事件给 UI
            webContents.send(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, {
              conversationId,
              activity: {
                type: 'result',
                toolName: tc.name,
                toolCallId: tc.id,
                result: result.content,
                isError: result.isError,
              },
            })
          }
        }

        // 构建续接消息
        continuationMessages = [
          ...continuationMessages,
          { role: 'assistant' as const, content, toolCalls },
          { role: 'tool' as const, results: toolResults },
        ]

        // 注意：不重置 accumulatedContent/accumulatedReasoning，跨轮次持续累积
      }
    }

    // 执行流式请求（proma 渠道支持 401 刷新重试 + 402 额度不足处理）
    try {
      await executeStream(apiKey)
    } catch (streamError) {
      if (channel.provider === 'proma' && streamError instanceof Error) {
        const status = extractHttpStatus(streamError.message)

        if (status === 402) {
          // 额度不足：广播事件触发充值对话框，然后继续抛出显示错误
          broadcastQuotaExceeded()
          throw streamError
        }

        if (status === 401) {
          // Token 过期：尝试刷新后重试一次
          const newToken = await tryRefreshAuthToken()
          if (newToken) {
            accumulatedContent = ''
            accumulatedReasoning = ''
            await executeStream(newToken)
          } else {
            throw streamError
          }
        } else {
          throw streamError
        }
      } else {
        throw streamError
      }
    }

    // 10. 保存 assistant 消息（空内容不保存）
    const assistantMsgId = randomUUID()
    if (accumulatedContent.trim()) {
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        model: modelId,
        reasoning: accumulatedReasoning || undefined,
      }
      appendMessage(conversationId, assistantMsg)

      // 更新对话索引的 updatedAt
      try {
        updateConversationMeta(conversationId, {})
      } catch {
        // 索引更新失败不影响主流程
      }
    } else {
      console.warn(`[聊天服务] 模型返回空内容，跳过保存 (对话 ${conversationId})`)
    }

    webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, {
      conversationId,
      model: modelId,
      messageId: accumulatedContent.trim() ? assistantMsgId : undefined,
    })

    // 10. Proma 官方渠道对话完成后通知渲染进程刷新余额
    if (channel.provider === 'proma') {
      broadcastBillingChanged()
    }
  } catch (error) {
    // 被中止的请求：保存已输出的部分内容，通知前端停止
    if (controller.signal.aborted) {
      console.log(`[聊天服务] 对话 ${conversationId} 已被用户中止`)

      // 保存已累积的部分助手消息
      if (accumulatedContent) {
        const assistantMsgId = randomUUID()
        const partialMsg: ChatMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: accumulatedContent,
          createdAt: Date.now(),
          model: modelId,
          reasoning: accumulatedReasoning || undefined,
          stopped: true,
        }
        appendMessage(conversationId, partialMsg)

        try {
          updateConversationMeta(conversationId, {})
        } catch {
          // 索引更新失败不影响主流程
        }

        webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, {
          conversationId,
          model: modelId,
          messageId: assistantMsgId,
        })
      } else {
        webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, {
          conversationId,
          model: modelId,
        })
      }
      return
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error(`[聊天服务] 流式请求失败:`, error)
    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: errorMessage,
    })
  } finally {
    activeControllers.delete(conversationId)
  }
}

/**
 * 中止指定对话的生成
 */
export function stopGeneration(conversationId: string): void {
  const controller = activeControllers.get(conversationId)
  if (controller) {
    controller.abort()
    activeControllers.delete(conversationId)
    console.log(`[聊天服务] 已中止对话: ${conversationId}`)
  }
}

/** 中止所有活跃的聊天流（应用退出时调用） */
export function stopAllGenerations(): void {
  if (activeControllers.size === 0) return
  console.log(`[聊天服务] 正在中止所有活跃对话 (${activeControllers.size} 个)...`)
  for (const [conversationId, controller] of activeControllers) {
    controller.abort()
    console.log(`[聊天服务] 已中止对话: ${conversationId}`)
  }
  activeControllers.clear()
}

// ===== 标题生成 =====

/** 标题生成 Prompt */
const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。\n\n用户消息：'

/** 短消息阈值：低于此长度直接使用原文作为标题 */
const SHORT_MESSAGE_THRESHOLD = 4

/** Proma 官方渠道标题生成专用模型（轻量、快速、低成本） */
const PROMA_TITLE_MODEL = 'openai/gpt-oss-120b'

/** 最大标题长度 */
const MAX_TITLE_LENGTH = 20

/**
 * 调用 AI 生成对话标题
 *
 * 使用与聊天相同的渠道和模型，发送非流式请求，
 * 让模型根据用户第一条消息生成简短标题。
 *
 * @param input 生成标题参数
 * @returns 生成的标题，失败时返回 null
 */
export async function generateTitle(input: GenerateTitleInput): Promise<string | null> {
  const { userMessage, channelId, modelId } = input
  console.log('[标题生成] 开始生成标题:', { channelId, modelId, userMessage: userMessage.slice(0, 50) })

  // 短消息直接使用原文作为标题，避免 AI 幻觉
  const trimmedMessage = userMessage.trim()
  if (trimmedMessage.length <= SHORT_MESSAGE_THRESHOLD) {
    const shortTitle = trimmedMessage.slice(0, MAX_TITLE_LENGTH)
    console.log('[标题生成] 消息过短，直接使用原文作为标题:', shortTitle)
    return shortTitle
  }

  // 查找渠道
  const channels = listChannels()
  const channel = channels.find((c) => c.id === channelId)
  if (!channel) {
    console.warn('[标题生成] 渠道不存在:', channelId)
    return null
  }

  // 获取 API Key 和 Base URL
  let apiKey: string
  let baseUrl: string

  if (channel.provider === 'proma') {
    const token = getAuthToken()
    if (!token) {
      console.warn('[标题生成] 未登录 Cloud 账户')
      return null
    }
    apiKey = token
    baseUrl = getCloudApiConfig().baseUrl
  } else {
    try {
      apiKey = decryptApiKey(channelId)
    } catch {
      console.warn('[标题生成] 解密 API Key 失败')
      return null
    }
    baseUrl = channel.baseUrl
  }

  try {
    const adapter = getAdapter(channel.provider)
    const titleModelId = channel.provider === 'proma' ? PROMA_TITLE_MODEL : modelId
    const request = adapter.buildTitleRequest({
      baseUrl,
      apiKey,
      modelId: titleModelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
    if (!title) {
      console.warn('[标题生成] API 返回空标题')
      return null
    }

    // 截断到最大长度并清理引号
    const cleaned = title.trim().replace(/^["'""'']+|["'""'']+$/g, '').trim()
    const result = cleaned.slice(0, MAX_TITLE_LENGTH) || null
    console.log('[标题生成] 成功生成标题:', result)
    return result
  } catch (error) {
    console.warn('[标题生成] 请求失败:', error)
    return null
  }
}
