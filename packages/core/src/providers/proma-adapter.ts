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
  ContinuationMessage,
} from './types.ts'
import {
  type OpenAIMessage,
  type OpenAIToolCall,
  toOpenAITools,
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
    } else if (msg.role === 'assistant' && msg.attachments && msg.attachments.length > 0) {
      // assistant 消息包含生成的图片附件（如 GPT Image 2 生成结果）
      // 将其嵌入历史，让模型在后续轮次中能看到自己生成的图片
      const assistantImages = readImageAttachments(msg.attachments)
      const content: PromaContentBlock[] = buildImageBlocks(assistantImages)
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      const openaiMsg: OpenAIMessage = { role, content }
      if (msg.reasoning) openaiMsg.reasoning_content = msg.reasoning
      messages.push(openaiMsg)
    } else {
      const openaiMsg: OpenAIMessage = { role, content: msg.content }
      if (msg.role === 'assistant' && msg.reasoning) {
        openaiMsg.reasoning_content = msg.reasoning
      }
      messages.push(openaiMsg)
    }
  }

  const currentImages = readImageAttachments(attachments)
  messages.push({
    role: 'user',
    content: buildMessageContent(userMessage, currentImages),
  })

  return messages
}

// ===========================================================================
// [Proma Cloud 特有 / FORK-DIVERGENCE] 续接消息拼接
// ---------------------------------------------------------------------------
// 本函数是 Proma Cloud 特供实现，与上游公共 openai-adapter.appendContinuationMessages
// 刻意分叉，请勿替换回通用实现。
//
// 原因：
// - Proma /chat 端点会根据模型路由到 DeepSeek v4 官方 /chat/completions（见
//   proma-api app/routers/chat.py _resolve_upstream）或 new-api 转发至 Kimi K2
//   Thinking 等上游。DeepSeek v4 / Kimi K2 Thinking 在多轮工具调用中，**必须**
//   在续接 assistant 消息上回传上一轮的 `reasoning_content`，否则服务端会以
//   `content[].thinking must be passed back` / `reasoning_content is missing` 拒绝。
// - 上游通用 OpenAI 协议版本（openai-adapter.appendContinuationMessages）不带
//   reasoning_content（OpenAI 官方不认此字段），所以不能直接复用。
//
// 策略（与 AnthropicAdapter.appendContinuationMessages 保持一致）：
// - `thinkingEnabled=true` 且 `contMsg.reasoning` 非空时填 `reasoning_content`
// - `thinkingEnabled=false` 时一律不填（否则服务端会以为思考仍激活）
// - 仅透传扁平 `reasoning`，不传 `thinkingBlocks.signature`：Proma /chat 是 OpenAI
//   协议链路，没有签名概念
//
// 若未来上游把通用 openai-adapter 也改成支持 reasoning_content，请**仍然保留**本地
// 副本，直到可以确认两条路径已经汇合（以及 OpenAI 官方渠道不会被污染）。
// ===========================================================================
function appendPromaContinuationMessages(
  messages: OpenAIMessage[],
  continuationMessages: ContinuationMessage[],
  thinkingEnabled: boolean,
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: contMsg.content || null,
        tool_calls: contMsg.toolCalls.map<OpenAIToolCall>((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
      if (thinkingEnabled && contMsg.reasoning && contMsg.reasoning.length > 0) {
        assistantMsg.reasoning_content = contMsg.reasoning
      }
      messages.push(assistantMsg)
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
    // [Proma Cloud 特有] 使用本地 appendPromaContinuationMessages 回传 reasoning_content
    // 以满足 DeepSeek v4 / Kimi K2 Thinking 等上游的"必须 pass back thinking"要求。
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendPromaContinuationMessages(messages, input.continuationMessages, !!input.thinkingEnabled)
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
