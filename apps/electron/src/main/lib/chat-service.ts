/**
 * AI 聊天流式服务（Electron 编排层）
 *
 * 负责 Electron 特定的操作：
 * - 查找渠道、解密 API Key
 * - 管理 AbortController
 * - 调用 @proma/core 的 Provider 适配器系统
 * - 桥接 StreamEvent → webContents.send()
 * - 持久化消息到 JSONL + 更新索引
 *
 * 纯逻辑（消息转换、SSE 解析、请求构建）已抽象到 @proma/core/providers。
 */

import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { CHAT_IPC_CHANNELS, CLOUD_IPC_CHANNELS } from '@proma/shared'
import type { ChatSendInput, ChatMessage, GenerateTitleInput, FileAttachment } from '@proma/shared'
import {
  getAdapter,
  streamSSE,
  fetchTitle,
} from '@proma/core'
import type { ImageAttachmentData } from '@proma/core'
import { listChannels, decryptApiKey } from './channel-manager'
import { getAuthToken, tryRefreshAuthToken } from './cloud-auth-service'
import { getCloudApiConfig } from '@proma/cloud'
import { appendMessage, updateConversationMeta, getConversationMessages } from './conversation-manager'
import { readAttachmentAsBase64, isImageAttachment } from './attachment-service'
import { extractTextFromAttachment, isDocumentAttachment } from './document-parser'
import { getUserProfile } from './user-profile-service'

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
  let filtered = [...messageHistory]

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
  return match ? parseInt(match[1]) : 0
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

  // 3. 追加用户消息到 JSONL
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: userMessage,
    createdAt: Date.now(),
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  }
  appendMessage(conversationId, userMsg)

  // 4. 从磁盘读取完整消息历史（不依赖前端传入，确保上下文完整）
  const fullHistory = getConversationMessages(conversationId)
  const filteredHistory = filterHistory(fullHistory, contextDividers, contextLength)

  // 5. 提取文档附件文本，注入到消息内容中
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

    /** 构建并执行流式请求 */
    const executeStream = async (key: string) => {
      const request = adapter.buildStreamRequest({
        baseUrl,
        apiKey: key,
        modelId,
        history: enrichedHistory,
        userMessage: enrichedUserMessage,
        systemMessage,
        attachments,
        readImageAttachments: getImageAttachmentData,
        thinkingEnabled,
      })

      return streamSSE({
        request,
        adapter,
        signal: controller.signal,
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
          }
        },
      })
    }

    // 执行流式请求（proma 渠道支持 401 刷新重试 + 402 额度不足处理）
    let content = ''
    let reasoning = ''

    try {
      const result = await executeStream(apiKey)
      content = result.content
      reasoning = result.reasoning
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
            const retryResult = await executeStream(newToken)
            content = retryResult.content
            reasoning = retryResult.reasoning
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

    // 8. 保存 assistant 消息
    const assistantMsgId = randomUUID()
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content,
      createdAt: Date.now(),
      model: modelId,
      reasoning: reasoning || undefined,
    }
    appendMessage(conversationId, assistantMsg)

    // 更新对话索引的 updatedAt
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

    // 9. Proma 官方渠道对话完成后通知渲染进程刷新余额
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
const TITLE_PROMPT = '根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。\n\n用户消息：'

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
    const request = adapter.buildTitleRequest({
      baseUrl,
      apiKey,
      modelId,
      prompt: TITLE_PROMPT + userMessage,
    })

    const title = await fetchTitle(request, adapter)
    if (!title) return null

    // 截断到最大长度并清理引号
    const cleaned = title.trim().replace(/^["'""'']+|["'""'']+$/g, '').trim()
    return cleaned.slice(0, MAX_TITLE_LENGTH) || null
  } catch (error) {
    console.warn('[标题生成] 请求失败:', error)
    return null
  }
}
