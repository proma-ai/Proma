/**
 * Anthropic 供应商适配器
 *
 * 实现 Anthropic Messages API 的消息转换、请求构建和 SSE 解析。
 * 特点：
 * - 角色：user / assistant（不支持 system 角色，system 通过 body.system 传递）
 * - 图片格式：{ type: 'image', source: { type: 'base64', media_type, data } }
 * - SSE 解析：content_block_delta → text，thinking_delta → reasoning，tool_use 支持
 * - 认证：x-api-key + Authorization: Bearer
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
import { normalizeAnthropicBaseUrl } from './url-utils.ts'

// ===== Anthropic 特有类型 =====

/** Anthropic 内容块（扩展支持 tool_use / tool_result） */
interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
  // tool_use 字段
  id?: string
  name?: string
  input?: Record<string, unknown>
  // tool_result 字段
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  is_error?: boolean
}

/** Anthropic 消息格式 */
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/** Anthropic SSE 事件 */
interface AnthropicSSEEvent {
  type: string
  /** content_block_start 的 content_block */
  content_block?: {
    type: string
    id?: string
    name?: string
  }
  delta?: {
    type?: string
    /** 普通文本增量 (text_delta) */
    text?: string
    /** 思考内容增量 (thinking_delta) */
    thinking?: string
    /** 工具参数 JSON 增量 (input_json_delta) */
    partial_json?: string
    /** message_delta 的 stop_reason */
    stop_reason?: string
  }
}

/** Anthropic 标题响应 */
interface AnthropicTitleResponse {
  content?: Array<{
    type: string
    text?: string
    thinking?: string
  }>
}

// ===== 消息转换 =====

/**
 * 将单条用户消息的图片附件转换为 Anthropic 内容块
 */
function buildImageBlocks(imageData: ImageAttachmentData[]): AnthropicContentBlock[] {
  return imageData.map((img) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: img.mediaType,
      data: img.data,
    },
  }))
}

/**
 * 构建包含图片和文本的消息内容
 *
 * 如果有图片附件则返回多模态内容块数组，否则返回纯文本。
 */
function buildMessageContent(
  text: string,
  imageData: ImageAttachmentData[],
): string | AnthropicContentBlock[] {
  if (imageData.length === 0) return text

  const content: AnthropicContentBlock[] = buildImageBlocks(imageData)
  if (text) {
    content.push({ type: 'text', text })
  }
  return content
}

/**
 * 将统一消息历史转换为 Anthropic 格式
 *
 * 包含历史消息附件的处理（修复了原始版本丢失历史附件的 Bug）。
 */
function toAnthropicMessages(
  input: StreamRequestInput,
): AnthropicMessage[] {
  const { history, userMessage, attachments, readImageAttachments } = input

  // 历史消息转换
  const messages: AnthropicMessage[] = history
    .filter((msg) => msg.role !== 'system')
    .map((msg) => {
      const role = msg.role === 'assistant' ? 'assistant' as const : 'user' as const

      // 历史用户消息的附件也需要转换为多模态内容
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const historyImages = readImageAttachments(msg.attachments)
        return { role, content: buildMessageContent(msg.content, historyImages) }
      }

      return { role, content: msg.content }
    })

  // 当前用户消息
  const currentImages = readImageAttachments(attachments)
  messages.push({
    role: 'user',
    content: buildMessageContent(userMessage, currentImages),
  })

  return messages
}

/**
 * 将工具定义转换为 Anthropic 格式
 */
function toAnthropicTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

/**
 * 将续接消息追加到 Anthropic 消息列表
 */
function appendContinuationMessages(
  messages: AnthropicMessage[],
  continuationMessages: ContinuationMessage[],
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      const content: AnthropicContentBlock[] = []
      if (contMsg.content) {
        content.push({ type: 'text', text: contMsg.content })
      }
      for (const tc of contMsg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })
      }
      messages.push({ role: 'assistant', content })
    } else if (contMsg.role === 'tool') {
      // Anthropic: tool_result 是 user role 消息的 content block
      const content: AnthropicContentBlock[] = contMsg.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.toolCallId,
        content: result.content,
        is_error: result.isError ?? false,
      }))
      messages.push({ role: 'user', content })
    }
  }
}

// ===== 适配器实现 =====

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerType = 'anthropic' as const

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = normalizeAnthropicBaseUrl(input.baseUrl)
    const messages = toAnthropicMessages(input)

    // 启用思考时需要更大的 max_tokens（budget_tokens 必须 < max_tokens）
    const thinkingBudget = 16384
    const maxTokens = input.thinkingEnabled ? thinkingBudget + 16384 : 8192

    const body: Record<string, unknown> = {
      model: input.modelId,
      max_tokens: maxTokens,
      messages,
      stream: true,
    }

    // 启用 extended thinking：设置 thinking 参数
    // 约束：启用时不能设置 temperature/top_k，budget_tokens 最小 1024
    if (input.thinkingEnabled) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget,
      }
    }

    if (input.systemMessage) {
      body.system = input.systemMessage
    }

    // 工具定义
    if (input.tools && input.tools.length > 0) {
      body.tools = toAnthropicTools(input.tools)
    }

    // 工具续接消息
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(messages, input.continuationMessages)
    }

    return {
      url: `${url}/messages`,
      headers: {
        'x-api-key': input.apiKey,
        'Authorization': `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const event = JSON.parse(jsonLine) as AnthropicSSEEvent
      const events: StreamEvent[] = []

      // 工具调用开始
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        events.push({
          type: 'tool_call_start',
          toolCallId: event.content_block.id || '',
          toolName: event.content_block.name || '',
        })
      }

      if (event.type === 'content_block_delta') {
        // 推理内容（thinking_delta 的内容在 delta.thinking 字段中）
        if (event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
          events.push({ type: 'reasoning', delta: event.delta.thinking })
        } else if (event.delta?.type === 'input_json_delta' && event.delta?.partial_json) {
          // 工具参数 JSON 增量
          events.push({
            type: 'tool_call_delta',
            toolCallId: '',  // SSE reader 通过 currentToolCallId 关联
            argumentsDelta: event.delta.partial_json,
          })
        } else if (event.delta?.text) {
          // 普通文本内容（text_delta）
          events.push({ type: 'chunk', delta: event.delta.text })
        }
      }

      // message_delta 携带 stop_reason
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        events.push({ type: 'done', stopReason: event.delta.stop_reason })
      }

      return events
    } catch {
      return []
    }
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeAnthropicBaseUrl(input.baseUrl)

    return {
      url: `${url}/messages`,
      headers: {
        'x-api-key': input.apiKey,
        'Authorization': `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        max_tokens: 50,
        messages: [{ role: 'user', content: input.prompt }],
        // 禁用 extended thinking（MiniMax 等供应商也会遵循此设置）
        thinking: { type: 'disabled' },
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as AnthropicTitleResponse
    if (!data.content || data.content.length === 0) return null

    // 优先查找 type === "text" 的块
    const textBlock = data.content.find((block) => block.type === 'text')
    if (textBlock?.text) return textBlock.text

    // 如果没有 text 块，尝试从第一个 thinking 块中提取（MiniMax 兼容）
    const thinkingBlock = data.content.find((block) => block.type === 'thinking')
    if (thinkingBlock?.thinking) {
      // thinking 内容可能很长，尝试提取最后一行或关键部分
      const lines = thinkingBlock.thinking.trim().split('\n')
      const lastLine = lines[lines.length - 1]?.trim()
      // 如果最后一行以 "- " 开头，提取它（常见的标题格式）
      if (lastLine?.startsWith('- ')) {
        return lastLine.slice(2).trim()
      }
      // 否则返回最后一行
      return lastLine || null
    }

    return null
  }
}
