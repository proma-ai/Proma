/**
 * AI 聊天流式服务（Electron 编排层）
 *
 * 负责 Electron 特定的操作：
 * - 查找渠道、解密 API Key（含 Proma 官方渠道 Cloud 认证）
 * - 管理 AbortController
 * - 调用 @proma/core 的 Provider 适配器系统
 * - 桥接 StreamEvent → webContents.send()
 * - 持久化消息到 JSONL + 更新索引
 * - 模块化工具的 function calling 循环（通过 ChatToolRegistry + ChatToolExecutor）
 *
 * 纯逻辑（消息转换、SSE 解析、请求构建）已抽象到 @proma/core/providers。
 */

import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { CHAT_IPC_CHANNELS, CLOUD_IPC_CHANNELS } from '@proma/shared'
import type { ChatSendInput, ChatMessage, GenerateTitleInput, FileAttachment, ChatToolActivity, ProviderType } from '@proma/shared'
import {
  getAdapter,
  streamSSE,
  fetchTitle,
} from '@proma/core'
import type { ImageAttachmentData, ContinuationMessage } from '@proma/core'
import { listChannels, resolveChannelRuntimeApiKey } from './channel-manager'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { appendMessage, updateConversationMeta, getConversationMessages } from './conversation-manager'
import { readAttachmentAsBase64, isImageAttachment } from './attachment-service'
import { extractTextFromAttachment, isDocumentAttachment } from './document-parser'
import { getUserProfile } from './user-profile-service'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getEnabledTools } from './chat-tool-registry'
import { executeToolCalls } from './chat-tool-executor'
import { DEFAULT_REFERENCE_ROUNDS } from './chat-tools/gpt-image-2-tool'
import { createFallbackTitle, sanitizeGeneratedTitle, SHORT_MESSAGE_THRESHOLD, TITLE_PROMPT } from './title-generation'
import { invalidateBillingCache } from './cloud-billing-service'

/** 活跃的 AbortController 映射（conversationId → controller） */
const activeControllers = new Map<string, AbortController>()

/** 最大工具续接轮数（安全上限，防止极端情况下的无限循环） */
const MAX_TOOL_ROUNDS = 999

/**
 * 提取最近 N 轮消息中的所有附件（按时间倒序，最新在前）
 *
 * "一轮" 定义为一次 user → assistant 的往返，以 user 消息为计数锚点。
 * 同时收集 user 上传的图和 assistant 生成的图，供多轮编辑场景使用。
 */
function collectRecentRoundsAttachments(
  history: ChatMessage[],
  maxRounds: number,
): FileAttachment[] {
  const result: FileAttachment[] = []
  let roundCount = 0

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (!msg) continue
    if (msg.role === 'user') {
      roundCount++
      if (roundCount > maxRounds) break
    }
    if (msg.attachments && msg.attachments.length > 0) {
      result.push(...msg.attachments)
    }
  }
  return result
}

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
  invalidateBillingCache()
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(CLOUD_IPC_CHANNELS.BILLING_CHANGED)
  })
}

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
 */
async function enrichMessageWithDocuments(
  messageText: string,
  attachments?: FileAttachment[],
): Promise<string> {
  if (!attachments || attachments.length === 0) return messageText

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
 */
async function enrichHistoryWithDocuments(history: ChatMessage[]): Promise<ChatMessage[]> {
  const enriched: ChatMessage[] = []

  for (const msg of history) {
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
 */
function filterHistory(
  messageHistory: ChatMessage[],
  contextDividers?: string[],
  contextLength?: number | 'infinite',
): ChatMessage[] {
  let filtered = messageHistory.filter(
    (msg) => !(msg.role === 'assistant' && !msg.content.trim()),
  )

  if (contextDividers && contextDividers.length > 0) {
    const lastDividerId = contextDividers[contextDividers.length - 1]
    const dividerIndex = filtered.findIndex((msg) => msg.id === lastDividerId)
    if (dividerIndex >= 0) {
      filtered = filtered.slice(dividerIndex + 1)
    }
  }

  if (typeof contextLength === 'number' && contextLength >= 0) {
    if (contextLength === 0) return []
    const collected: ChatMessage[] = []
    let roundCount = 0
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i] as ChatMessage
      collected.unshift(msg)
      if (msg.role === 'user') {
        roundCount++
        if (roundCount >= contextLength) break
      }
    }
    return collected
  }

  return filtered
}

// ===== 核心流式函数 =====

/**
 * 发送消息并流式返回 AI 响应
 *
 * @param input 发送参数
 * @param webContents 渲染进程的 webContents 实例（用于推送事件）
 */
export async function sendMessage(
  input: ChatSendInput,
  webContents: WebContents,
): Promise<boolean> {
  const {
    conversationId, userMessage, channelId,
    modelId, systemMessage: customSystemMessage, contextLength, contextDividers, attachments,
    thinkingEnabled, thinkingLevel, enabledToolIds,

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
    return false
  }

  // Subscription OAuth uses Pi provider-specific transports, which Chat mode does
  // not currently implement. Keep this guard for historical conversations that
  // still reference a formerly selectable subscription model.
  if (channel.provider === 'openai-codex' || channel.provider === 'github-copilot' || channel.provider === 'xai') {
    const providerName = channel.provider === 'xai'
      ? 'xAI（Grok OAuth）'
      : channel.provider === 'github-copilot'
        ? 'GitHub Copilot 订阅'
        : 'ChatGPT 订阅（Codex OAuth）'
    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: `Chat 模式暂不支持 ${providerName}，请切换到 Agent 模式使用。`,
    })
    return false
  }

  // 2. 获取 API Key 和 Base URL
  let apiKey: string
  let baseUrl: string

  if (channel.provider === 'proma') {
    const token = getAuthToken()
    if (!token) {
      webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, { conversationId, error: '未登录 Cloud 账户' })
      return false
    }
    apiKey = token
    baseUrl = getCloudApiConfig().baseUrl
  } else {
    try {
      apiKey = await resolveChannelRuntimeApiKey(channelId)
    } catch {
      webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
        conversationId,
        error: '解密 API Key 失败',
      })
      return false
    }
    baseUrl = channel.baseUrl
  }

  // 3. 先读取历史消息
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

  let accumulatedContent = ''
  let accumulatedReasoning = ''
  const accumulatedToolActivities: ChatToolActivity[] = []
  const accumulatedGeneratedAttachments: FileAttachment[] = []

  try {
    // 7. 获取适配器
    const adapter = getAdapter(channel.provider)

    // 8. 从工具注册表获取启用的工具
    const { tools, systemPromptAppend } = getEnabledTools(enabledToolIds)

    const effectiveSystemMessage = systemPromptAppend && systemMessage
      ? systemMessage + systemPromptAppend
      : systemPromptAppend ?? systemMessage

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)

    /** 流式事件处理器（工具轮和最终响应轮复用） */
    const handleStreamEvent = (event: { type: string; delta?: string; toolCallId?: string; toolName?: string }): void => {
      switch (event.type) {
        case 'chunk':
          accumulatedContent += event.delta ?? ''
          webContents.send(CHAT_IPC_CHANNELS.STREAM_CHUNK, { conversationId, delta: event.delta })
          break
        case 'reasoning':
          accumulatedReasoning += event.delta ?? ''
          webContents.send(CHAT_IPC_CHANNELS.STREAM_REASONING, { conversationId, delta: event.delta })
          break
        case 'tool_call_start':
          accumulatedToolActivities.push({
            toolCallId: event.toolCallId!,
            toolName: event.toolName!,
            type: 'start',
          })
          webContents.send(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, {
            conversationId,
            activity: { type: 'start', toolName: event.toolName!, toolCallId: event.toolCallId! },
          })
          break
      }
    }

    /** 构建并执行流式请求（含 Proma 官方渠道 401 刷新重试） */
    const executeStream = async (key: string): Promise<void> => {
      let continuationMessages: ContinuationMessage[] = []
      let round = 0
      let pendingToolResults = false

      while (round < MAX_TOOL_ROUNDS) {
        round++
        pendingToolResults = false


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
          thinkingLevel,
          tools,
          continuationMessages: continuationMessages.length > 0 ? continuationMessages : undefined,
        })

        const { content, reasoning, thinkingBlocks, toolCalls, stopReason } = await streamSSE({
          request,
          adapter,
          signal: controller.signal,
          fetchFn,
          onEvent: handleStreamEvent,
        })

        if (!toolCalls || toolCalls.length === 0 || stopReason !== 'tool_use') {
          break
        }

        // 执行工具调用（通过统一执行器）
        // 提取最近 N 轮全部附件（用于 GPT Image 2 多轮参考图）。
        const recentRoundsAttachments = collectRecentRoundsAttachments(fullHistory, DEFAULT_REFERENCE_ROUNDS)
        const toolResults = await executeToolCalls(toolCalls, {
          webContents,
          conversationId,
          currentAttachments: attachments,
          recentRoundsAttachments,
        })

        // 累积工具结果到持久化数据
        for (const tc of toolCalls) {
          const tr = toolResults.find((r) => r.toolCallId === tc.id)
          if (tr) {
            accumulatedToolActivities.push({
              toolCallId: tc.id,
              toolName: tc.name,
              type: 'result',
              result: tr.content,
              isError: tr.isError,
              input: tc.arguments,
            })
            // 收集工具生成的附件（如生图工具的图片）
            if (tr.generatedAttachments) {
              accumulatedGeneratedAttachments.push(...tr.generatedAttachments)
            }
          }
        }

        continuationMessages = [
          ...continuationMessages,
          { role: 'assistant' as const, content, reasoning, thinkingBlocks, toolCalls },
          { role: 'tool' as const, results: toolResults },
        ]
        pendingToolResults = true
      }

      // 最终响应轮：达到上限但仍有待处理工具结果时，不带 tools 再请求一次
      if (pendingToolResults && continuationMessages.length > 0) {
        console.log(`[聊天服务] 工具轮次已达上限 (${MAX_TOOL_ROUNDS})，发起最终响应轮`)
        const finalRequest = adapter.buildStreamRequest({
          baseUrl,
          apiKey: key,
          modelId,
          history: enrichedHistory,
          userMessage: enrichedUserMessage,
          systemMessage: effectiveSystemMessage,
          attachments,
          readImageAttachments: getImageAttachmentData,
          thinkingEnabled,
          thinkingLevel,
          continuationMessages,
        })
        await streamSSE({ request: finalRequest, adapter, signal: controller.signal, fetchFn, onEvent: handleStreamEvent })
      }
    }

    // 执行流式请求（Proma 渠道支持 401 刷新重试 + 402 额度不足处理）
    try {
      await executeStream(apiKey)
    } catch (streamError) {
      if (channel.provider === 'proma' && streamError instanceof Error) {
        const status = extractHttpStatus(streamError.message)

        if (status === 402) {
          broadcastQuotaExceeded()
          throw streamError
        }


        if (status === 401) {
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

    // 10. 保存 assistant 消息（空内容不保存，除非有生成的附件）
    const assistantMsgId = randomUUID()
    if (accumulatedContent.trim() || accumulatedGeneratedAttachments.length > 0) {
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        model: modelId,
        reasoning: accumulatedReasoning || undefined,
        toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
        attachments: accumulatedGeneratedAttachments.length > 0 ? accumulatedGeneratedAttachments : undefined,
      }
      appendMessage(conversationId, assistantMsg)
      try { updateConversationMeta(conversationId, {}) } catch { /* 忽略 */ }
    } else {
      console.warn(`[聊天服务] 模型返回空内容且无生成附件，跳过保存 (对话 ${conversationId})`)
    }

    webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, {
      conversationId,
      model: modelId,
      messageId: (accumulatedContent.trim() || accumulatedGeneratedAttachments.length > 0) ? assistantMsgId : undefined,
    })
    // Proma 官方渠道对话完成后通知渲染进程刷新余额
    if (channel.provider === 'proma') {
      broadcastBillingChanged()
    }
    return true
  } catch (error) {
    if (controller.signal.aborted) {
      console.log(`[聊天服务] 对话 ${conversationId} 已被用户中止`)

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
          toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
        }
        appendMessage(conversationId, partialMsg)
        try { updateConversationMeta(conversationId, {}) } catch { /* 忽略 */ }
        webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, { conversationId, model: modelId, messageId: assistantMsgId })
      } else {
        webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, { conversationId, model: modelId })
      }
      return true
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error(`[聊天服务] 流式请求失败:`, error)

    // 保存已累积的部分助手消息（与 abort 逻辑一致，防止内容丢失）
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
        error: errorMessage,
        toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
      }
      appendMessage(conversationId, partialMsg)

      try {
        updateConversationMeta(conversationId, {})
      } catch {
        // 索引更新失败不影响主流程
      }
    } else {
      // 即使没有累积内容，也保存一条错误消息到 JSONL，
      // 确保切换对话或重启后错误仍然可见（而非仅靠临时 atom 横幅）
      const assistantMsgId = randomUUID()
      const errorMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        model: modelId,
        stopped: true,
        error: errorMessage,
      }
      appendMessage(conversationId, errorMsg)

      try {
        updateConversationMeta(conversationId, {})
      } catch {
        // 索引更新失败不影响主流程
      }
    }

    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: errorMessage,
    })
    return false
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

/** Proma 官方渠道标题生成专用模型（轻量、快速、低成本） */
const PROMA_TITLE_MODEL = 'openai/gpt-oss-120b'

/**
 * 标题生成失败时仍需本地兜底重命名的渠道。
 *
 * OpenCode Go 与历史遗留的自定义渠道服务端会偶发返回空标题/解密失败，
 * 不兜底会让对话长期停在默认标题。商业版不再允许新建 `custom` 渠道，
 * 但历史配置里可能仍存在，因此保留判断而不恢复其创建入口。
 */
function isFallbackTitleProvider(provider: ProviderType): boolean {
  return provider === 'opencode-go-openai' || provider === 'custom'
}
/**
 * 调用 AI 生成对话标题
 */
export async function generateTitle(input: GenerateTitleInput): Promise<string | null> {
  const { userMessage, channelId, modelId } = input
  console.log('[标题生成] 开始生成标题:', { channelId, modelId, userMessage: userMessage.slice(0, 50) })

  const trimmedMessage = userMessage.trim()
  if (trimmedMessage.length <= SHORT_MESSAGE_THRESHOLD) {
    const shortTitle = createFallbackTitle(trimmedMessage)
    console.log('[标题生成] 消息过短，直接使用原文作为标题:', shortTitle)
    return shortTitle
  }

  const channels = listChannels()
  const channel = channels.find((candidate) => candidate.id === channelId)
  if (!channel) {
    console.warn('[标题生成] 渠道不存在:', channelId)
    return null
  }

  if (channel.provider === 'openai-codex' || channel.provider === 'github-copilot') {
    const fallbackTitle = createFallbackTitle(userMessage)
    console.log('[标题生成] OAuth 订阅渠道使用本地标题:', fallbackTitle)
    return fallbackTitle
  }

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
      apiKey = await resolveChannelRuntimeApiKey(channelId)
    } catch {
      console.warn('[标题生成] 解密 API Key 失败')
      // OpenCode Go / 历史自定义渠道无法解密也仍要完成重命名，避免对话长期停在默认标题。
      return isFallbackTitleProvider(channel.provider) ? createFallbackTitle(userMessage) : null
    }
    baseUrl = channel.baseUrl
  }

  const adapter = getAdapter(channel.provider)
  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)
  const titleModelId = channel.provider === 'proma' ? PROMA_TITLE_MODEL : modelId
  const doFetch = async (key: string): Promise<string | null> => {
    const request = adapter.buildTitleRequest({ baseUrl, apiKey: key, modelId: titleModelId, prompt: TITLE_PROMPT + userMessage })
    return fetchTitle(request, adapter, fetchFn)
  }

  try {
    let title = await doFetch(apiKey)
    if (!title && channel.provider === 'proma') {
      const newToken = await tryRefreshAuthToken()
      if (newToken) {
        console.log('[标题生成] Token 已刷新，重试...')
        title = await doFetch(newToken)
      }
    }

    const result = title ? sanitizeGeneratedTitle(title) : null
    if (!result) {
      console.warn('[标题生成] API 未返回可用标题')
      // OpenCode Go / 历史自定义渠道的服务端偶发返回空标题时，仍要完成重命名，避免对话长期停在默认标题。
      return isFallbackTitleProvider(channel.provider) ? createFallbackTitle(userMessage) : null
    }

    console.log('[标题生成] 成功生成标题:', result)
    return result
  } catch (error) {
    console.warn('[标题生成] 请求失败:', error)
    // OpenCode Go / 历史自定义渠道的服务端偶发返回空标题/异常响应/超时，异常路径同样要完成重命名。
    return isFallbackTitleProvider(channel.provider) ? createFallbackTitle(userMessage) : null
  }
}
