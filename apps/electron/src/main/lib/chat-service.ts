/**
 * AI 聊天流式服务（Electron 编排层）
 *
 * 负责 Electron 特定的操作：
 * - 查找渠道、解密 API Key
 * - 管理 AbortController
 * - 调用 @proma/core 的 Provider 适配器系统
 * - 桥接 StreamEvent → webContents.send()
 * - 持久化消息到 JSONL + 更新索引
 * - 模块化工具的 function calling 循环（通过 ChatToolRegistry + ChatToolExecutor）
 *
 * 纯逻辑（消息转换、SSE 解析、请求构建）已抽象到 @proma/core/providers。
 */

import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { CHAT_IPC_CHANNELS } from '@proma/shared'
import type { ChatSendInput, ChatMessage, GenerateTitleInput, FileAttachment, ChatToolActivity } from '@proma/shared'
import {
  getAdapter,
  streamSSE,
  fetchTitle,
} from '@proma/core'
import type { ImageAttachmentData, ContinuationMessage } from '@proma/core'
import { listChannels, resolveChannelRuntimeApiKey } from './channel-manager'
import { appendMessage, updateConversationMeta, getConversationMessages } from './conversation-manager'
import { readAttachmentAsBase64, isImageAttachment } from './attachment-service'
import { extractTextFromAttachment, isDocumentAttachment } from './document-parser'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { getEnabledTools } from './chat-tool-registry'
import { executeToolCalls } from './chat-tool-executor'
import { createFallbackTitle, sanitizeGeneratedTitle, SHORT_MESSAGE_THRESHOLD, TITLE_PROMPT } from './title-generation'

/** 活跃的 AbortController 映射（conversationId → controller） */
const activeControllers = new Map<string, AbortController>()

/** 最大工具续接轮数（安全上限，防止极端情况下的无限循环） */
const MAX_TOOL_ROUNDS = 999

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

// ===== 核心流式函数 =====

/**
 * 发送消息并流式返回 AI 响应
 *
 * 通过 ChatToolRegistry 获取启用的工具定义，
 * 通过 ChatToolExecutor 统一执行工具调用。
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
    modelId, systemMessage, contextLength, contextDividers, attachments,
    thinkingEnabled, enabledToolIds,
  } = input

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

  // Codex OAuth uses the ChatGPT-specific Responses protocol, which Chat does
  // not currently implement. Keep this guard for historical conversations that
  // still reference a formerly selectable Codex model.
  if (channel.provider === 'openai-codex') {
    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: 'Chat 模式暂不支持 ChatGPT 订阅（Codex OAuth），请切换到 Agent 模式使用。',
    })
    return
  }

  // 2. 解密 API Key
  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    webContents.send(CHAT_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: '解密 API Key 失败',
    })
    return
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
  const accumulatedToolActivities: ChatToolActivity[] = []
  const accumulatedGeneratedAttachments: FileAttachment[] = []

  try {
    // 7. 获取适配器
    const adapter = getAdapter(channel.provider)

    // 8. 从工具注册表获取启用的工具
    const { tools, systemPromptAppend } = getEnabledTools(enabledToolIds)

    // 注入工具系统提示词
    const effectiveSystemMessage = systemPromptAppend && systemMessage
      ? systemMessage + systemPromptAppend
      : systemPromptAppend
        ? systemPromptAppend
        : systemMessage

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)

    // 9. 工具续接循环
    let continuationMessages: ContinuationMessage[] = []
    let round = 0
    /** 标记最近一轮是否执行了工具（用于判断是否需要最终响应轮） */
    let pendingToolResults = false

    /** 流式事件处理器（工具轮和最终响应轮复用） */
    const handleStreamEvent = (event: { type: string; delta?: string; toolCallId?: string; toolName?: string }): void => {
      switch (event.type) {
        case 'chunk':
          accumulatedContent += event.delta ?? ''
          webContents.send(CHAT_IPC_CHANNELS.STREAM_CHUNK, {
            conversationId,
            delta: event.delta,
          })
          break
        case 'reasoning':
          accumulatedReasoning += event.delta ?? ''
          webContents.send(CHAT_IPC_CHANNELS.STREAM_REASONING, {
            conversationId,
            delta: event.delta,
          })
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
        // done 事件在外部处理
      }
    }

    while (round < MAX_TOOL_ROUNDS) {
      round++
      pendingToolResults = false

      const request = adapter.buildStreamRequest({
        baseUrl: channel.baseUrl,
        apiKey,
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

      const { content, reasoning, thinkingBlocks, toolCalls, stopReason } = await streamSSE({
        request,
        adapter,
        signal: controller.signal,
        fetchFn,
        onEvent: handleStreamEvent,
      })

      // 如果没有工具调用或不是 tool_use 停止，退出循环
      if (!toolCalls || toolCalls.length === 0 || stopReason !== 'tool_use') {
        break
      }

      // 执行工具调用（通过统一执行器）
      // 提取前一轮对话的附件（用于参考图支持）
      const lastUserMsg = fullHistory.filter((m) => m.role === 'user').at(-1)
      const lastAssistantMsg = fullHistory.filter((m) => m.role === 'assistant').at(-1)
      const toolResults = await executeToolCalls(toolCalls, {
        webContents,
        conversationId,
        currentAttachments: attachments,
        previousUserAttachments: lastUserMsg?.attachments,
        previousAssistantAttachments: lastAssistantMsg?.attachments,
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

      // 构建续接消息
      // thinkingBlocks 保留服务端原始的 thinking 块结构（含签名），
      // 在思考+工具模式下必须原样回传给 Anthropic 协议家族（Anthropic/DeepSeek/Kimi）
      continuationMessages = [
        ...continuationMessages,
        { role: 'assistant' as const, content, reasoning, thinkingBlocks, toolCalls },
        { role: 'tool' as const, results: toolResults },
      ]
      pendingToolResults = true

      // 注意：不重置 accumulatedContent/accumulatedReasoning，跨轮次持续累积
    }

    // 10. 最终响应轮：如果因达到 MAX_TOOL_ROUNDS 退出但仍有待处理的工具结果，
    // 再发起一次 API 调用（不传 tools）让模型基于工具结果生成最终文本回复
    if (pendingToolResults && continuationMessages.length > 0) {
      console.log(`[聊天服务] 工具轮次已达上限 (${MAX_TOOL_ROUNDS})，发起最终响应轮`)

      const finalRequest = adapter.buildStreamRequest({
        baseUrl: channel.baseUrl,
        apiKey,
        modelId,
        history: enrichedHistory,
        userMessage: enrichedUserMessage,
        systemMessage: effectiveSystemMessage,
        attachments,
        readImageAttachments: getImageAttachmentData,
        thinkingEnabled,
        // 不传 tools，强制模型生成文本回复而非继续调用工具
        continuationMessages,
      })

      await streamSSE({
        request: finalRequest,
        adapter,
        signal: controller.signal,
        fetchFn,
        onEvent: handleStreamEvent,
      })
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

      // 更新对话索引的 updatedAt
      try {
        updateConversationMeta(conversationId, {})
      } catch {
        // 索引更新失败不影响主流程
      }
    } else {
      console.warn(`[聊天服务] 模型返回空内容且无生成附件，跳过保存 (对话 ${conversationId})`)
    }

    webContents.send(CHAT_IPC_CHANNELS.STREAM_COMPLETE, {
      conversationId,
      model: modelId,
      messageId: (accumulatedContent.trim() || accumulatedGeneratedAttachments.length > 0) ? assistantMsgId : undefined,
    })
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
          toolActivities: accumulatedToolActivities.length > 0 ? accumulatedToolActivities : undefined,
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
    const shortTitle = createFallbackTitle(trimmedMessage)
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

  if (channel.provider === 'openai-codex') {
    const fallbackTitle = createFallbackTitle(userMessage)
    console.log('[标题生成] ChatGPT OAuth 渠道使用本地标题:', fallbackTitle)
    return fallbackTitle
  }

  // 解密 API Key
  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    console.warn('[标题生成] 解密 API Key 失败')
    return null
  }

  try {
    const adapter = getAdapter(channel.provider)
    const request = adapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, adapter, fetchFn)
    const result = title ? sanitizeGeneratedTitle(title) : null
    if (!result) {
      console.warn('[标题生成] API 未返回可用标题')
      // OpenCode Go 的服务端偶发返回空标题时，仍要完成重命名，避免对话长期停在默认标题。
      return channel.provider === 'opencode-go-openai' ? createFallbackTitle(userMessage) : null
    }

    console.log('[标题生成] 成功生成标题:', result)
    return result
  } catch (error) {
    console.warn('[标题生成] 请求失败:', error)
    return null
  }
}
