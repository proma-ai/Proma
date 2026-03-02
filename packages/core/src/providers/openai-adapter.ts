/**
 * OpenAI 兼容供应商适配器
 *
 * 实现 OpenAI Chat Completions API 的消息转换、请求构建和 SSE 解析。
 * 同时适用于 OpenAI、DeepSeek 和自定义 OpenAI 兼容 API。
 * 特点：
 * - 角色：system / user / assistant / tool
 * - 图片格式：{ type: 'image_url', image_url: { url: 'data:mime;base64,...' } }
 * - SSE 解析：choices[0].delta.content + reasoning_content（DeepSeek）+ tool_calls
 * - 认证：Authorization: Bearer
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  StreamRequestInput,
  StreamEvent,
  TitleRequestInput,
  ImageAttachmentData,
  ToolDefinition,
  ContinuationMessage,
} from './types.ts'
import { normalizeBaseUrl } from './url-utils.ts'

// ===== OpenAI 特有类型 =====

/** OpenAI 内容块 */
interface OpenAIContentBlock {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

/** OpenAI tool_call 格式 */
interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** OpenAI 消息格式（扩展支持 tool role） */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentBlock[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

/** OpenAI SSE 数据块 */
interface OpenAIChunkData {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

/** OpenAI 标题响应 */
interface OpenAITitleResponse {
  choices?: Array<{ message?: { content?: string } }>
}

// ===== 消息转换 =====

/**
 * 将图片附件转换为 OpenAI 格式的内容块
 */
function buildImageBlocks(imageData: ImageAttachmentData[]): OpenAIContentBlock[] {
  return imageData.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }))
}

/**
 * 构建包含图片和文本的消息内容
 */
function buildMessageContent(
  text: string,
  imageData: ImageAttachmentData[],
): string | OpenAIContentBlock[] {
  if (imageData.length === 0) return text

  const content: OpenAIContentBlock[] = buildImageBlocks(imageData)
  if (text) {
    content.push({ type: 'text', text })
  }
  return content
}

/**
 * 将统一消息历史转换为 OpenAI 格式
 *
 * OpenAI 是唯一支持 system 角色消息的 provider。
 * 包含历史消息附件的处理。
 */
function toOpenAIMessages(input: StreamRequestInput): OpenAIMessage[] {
  const { history, userMessage, systemMessage, attachments, readImageAttachments } = input
  const messages: OpenAIMessage[] = []

  // System 消息作为独立 role
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage })
  }

  // 历史消息
  for (const msg of history) {
    if (msg.role === 'system') continue

    const role = msg.role === 'assistant' ? 'assistant' as const : 'user' as const

    // 历史用户消息的附件也需要转换为多模态内容
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const historyImages = readImageAttachments(msg.attachments)
      messages.push({ role, content: buildMessageContent(msg.content, historyImages) })
    } else {
      messages.push({ role, content: msg.content })
    }
  }

  // 当前用户消息
  const currentImages = readImageAttachments(attachments)
  messages.push({
    role: 'user',
    content: buildMessageContent(userMessage, currentImages),
  })

  return messages
}

/**
 * 将工具定义转换为 OpenAI 格式
 */
function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/**
 * 将续接消息追加到 OpenAI 消息列表
 */
function appendContinuationMessages(
  messages: OpenAIMessage[],
  continuationMessages: ContinuationMessage[],
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: contMsg.content || null,
        tool_calls: contMsg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      })
    } else if (contMsg.role === 'tool') {
      for (const result of contMsg.results) {
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        })
      }
    }
  }
}

// ===== 适配器实现 =====

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerType = 'openai' as const

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)
    const messages = toOpenAIMessages(input)

    const bodyObj: Record<string, unknown> = {
      model: input.modelId,
      messages,
      stream: true,
    }

    // 工具定义
    if (input.tools && input.tools.length > 0) {
      bodyObj.tools = toOpenAITools(input.tools)
    }

    // 工具续接消息
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(messages, input.continuationMessages)
    }

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const chunk = JSON.parse(jsonLine) as OpenAIChunkData
      const delta = chunk.choices?.[0]?.delta
      const events: StreamEvent[] = []

      if (delta?.content) {
        events.push({ type: 'chunk', delta: delta.content })
      }

      // DeepSeek 等供应商的推理内容
      if (delta?.reasoning_content) {
        events.push({ type: 'reasoning', delta: delta.reasoning_content })
      }

      // 工具调用
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            events.push({
              type: 'tool_call_start',
              toolCallId: tc.id || `tc_${tc.index ?? 0}`,
              toolName: tc.function.name,
            })
          }
          if (tc.function?.arguments) {
            // tc.id 仅在首个 chunk 中存在，后续 delta 不携带 id
            // 使用空字符串让 SSE reader 通过 currentToolCallId 关联
            events.push({
              type: 'tool_call_delta',
              toolCallId: tc.id || '',
              argumentsDelta: tc.function.arguments,
            })
          }
        }
      }

      // 检查 finish_reason
      const finishReason = chunk.choices?.[0]?.finish_reason
      if (finishReason === 'tool_calls') {
        events.push({ type: 'done', stopReason: 'tool_use' })
      }

      return events
    } catch {
      return []
    }
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: 'user', content: input.prompt }],
        max_tokens: 50,
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as OpenAITitleResponse
    return data.choices?.[0]?.message?.content ?? null
  }
}
