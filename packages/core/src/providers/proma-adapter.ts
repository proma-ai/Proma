/**
 * Proma 官方供应商适配器
 *
 * 实现 ProviderAdapter 接口，对接 Proma Cloud 后端 /chat 端点。
 * 后端返回 OpenAI 兼容 SSE 格式，SSE 解析和工具处理直接复用 OpenAI 适配器的逻辑。
 *
 * 与 OpenAIAdapter 的区别：
 * - 请求路径为 {baseUrl}/chat 而非 /chat/completions
 * - Body 中包含 thinkingEnabled 字段
 * - 认证使用 Cloud auth token 而非用户 API Key
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  StreamRequestInput,
  StreamEvent,
  TitleRequestInput,
  ImageAttachmentData,
} from './types.ts'
import {
  type OpenAIMessage,
  toOpenAITools,
  appendContinuationMessages,
  parseOpenAICompatSSE,
} from './openai-adapter.ts'

// ===== Proma 特有类型 =====

/** Proma 消息内容块（OpenAI 兼容） */
interface PromaContentBlock {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

/** 标题响应（非流式） */
interface PromaTitleResponse {
  choices?: Array<{ message?: { content?: string } }>
}

// ===== 消息转换 =====

function buildImageBlocks(imageData: ImageAttachmentData[]): PromaContentBlock[] {
  return imageData.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }))
}

function buildMessageContent(
  text: string,
  imageData: ImageAttachmentData[],
): string | PromaContentBlock[] {
  if (imageData.length === 0) return text

  const content: PromaContentBlock[] = buildImageBlocks(imageData)
  if (text) {
    content.push({ type: 'text', text })
  }
  return content
}

function toPromaMessages(input: StreamRequestInput): OpenAIMessage[] {
  const { history, userMessage, systemMessage, attachments, readImageAttachments } = input
  const messages: OpenAIMessage[] = []

  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage })
  }

  for (const msg of history) {
    if (msg.role === 'system') continue
    const role = msg.role === 'assistant' ? 'assistant' as const : 'user' as const

    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const historyImages = readImageAttachments(msg.attachments)
      messages.push({ role, content: buildMessageContent(msg.content, historyImages) })
    } else {
      messages.push({ role, content: msg.content })
    }
  }

  const currentImages = readImageAttachments(attachments)
  messages.push({
    role: 'user',
    content: buildMessageContent(userMessage, currentImages),
  })

  return messages
}

// ===== 适配器实现 =====

export class PromaAdapter implements ProviderAdapter {
  readonly providerType = 'proma' as const

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    const messages = toPromaMessages(input)

    const bodyObj: Record<string, unknown> = {
      model: input.modelId,
      messages,
      stream: true,
      thinkingEnabled: input.thinkingEnabled ?? false,
    }

    // 工具定义（复用 OpenAI 兼容格式）
    if (input.tools && input.tools.length > 0) {
      bodyObj.tools = toOpenAITools(input.tools)
    }

    // 工具续接消息
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(messages, input.continuationMessages)
    }

    return {
      url: `${baseUrl}/chat`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    return parseOpenAICompatSSE(jsonLine)
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    // 标题生成使用 OpenAI 兼容的非流式端点（/v1/chat/completions），而非仅支持 SSE 的 /api/v1/chat
    // baseUrl 形如 https://api.proma.cool/api/v1，需要提取根域名再拼接 /v1/chat/completions
    const rootUrl = input.baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v\d+$/, '')

    return {
      url: `${rootUrl}/v1/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: 'user', content: input.prompt }],
        stream: false,
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as PromaTitleResponse
    return data.choices?.[0]?.message?.content ?? null
  }
}
