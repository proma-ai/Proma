/**
 * Google Generative AI 供应商适配器
 *
 * 实现 Google Generative AI (Gemini) API 的消息转换、请求构建和 SSE 解析。
 * 特点：
 * - 角色：user / model（注意：assistant 映射为 model）
 * - 图片格式：{ inline_data: { mime_type, data } }
 * - SSE 解析：遍历 candidates[0].content.parts，区分 thought 推理和正常文本 + functionCall
 * - 认证：API Key 作为 URL 查询参数
 * - 支持推理内容：Gemini 2.5/3 系列通过 thinkingConfig 启用思考过程回显
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

// ===== Google 特有类型 =====

/** Google 内容部分（扩展支持 functionCall / functionResponse） */
interface GooglePart {
  text?: string
  /** Gemini 2.5/3 思考内容标记 */
  thought?: boolean
  /** 思考签名（工具调用时由模型生成，续接请求必须原样返回） */
  thoughtSignature?: string
  inline_data?: {
    mime_type: string
    data: string
  }
  functionCall?: {
    name: string
    args?: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: Record<string, unknown>
  }
}

/** Google 消息内容 */
interface GoogleContent {
  role: 'user' | 'model'
  parts: GooglePart[]
}

/** Google SSE 流式响应 */
interface GoogleStreamData {
  candidates?: Array<{
    content?: {
      parts?: GooglePart[]
    }
    finishReason?: string
  }>
}

/** Google 标题响应 */
interface GoogleTitleResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

// ===== 消息转换 =====

/**
 * 将图片附件转换为 Google 格式的内容部分
 */
function buildImageParts(imageData: ImageAttachmentData[]): GooglePart[] {
  return imageData.map((img) => ({
    inline_data: {
      mime_type: img.mediaType,
      data: img.data,
    },
  }))
}

/**
 * 构建包含图片和文本的消息部分列表
 */
function buildMessageParts(text: string, imageData: ImageAttachmentData[]): GooglePart[] {
  const parts: GooglePart[] = buildImageParts(imageData)
  if (text) {
    parts.push({ text })
  }
  return parts
}

/**
 * 将统一消息历史转换为 Google 格式
 *
 * Google API 的 assistant 角色为 model，不支持 system 消息角色
 * （system 通过 body.systemInstruction 传递）。
 * 包含历史消息附件的处理。
 */
function toGoogleContents(input: StreamRequestInput): GoogleContent[] {
  const { history, userMessage, attachments, readImageAttachments } = input

  // 历史消息转换
  const contents: GoogleContent[] = history
    .filter((msg) => msg.role !== 'system')
    .map((msg) => {
      const role = msg.role === 'assistant' ? 'model' as const : 'user' as const

      // 历史用户消息的附件也需要转换为多模态内容
      if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
        const historyImages = readImageAttachments(msg.attachments)
        return { role, parts: buildMessageParts(msg.content, historyImages) }
      }

      return { role, parts: [{ text: msg.content }] }
    })

  // 当前用户消息
  const currentImages = readImageAttachments(attachments)
  contents.push({
    role: 'user',
    parts: buildMessageParts(userMessage, currentImages),
  })

  return contents
}

/**
 * 将工具定义转换为 Google 格式
 */
function toGoogleTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  }]
}

/**
 * 将续接消息追加到 Google contents 列表
 */
function appendContinuationMessages(
  contents: GoogleContent[],
  continuationMessages: ContinuationMessage[],
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      const parts: GooglePart[] = []
      if (contMsg.content) {
        parts.push({ text: contMsg.content })
      }
      for (const tc of contMsg.toolCalls) {
        const part: GooglePart = {
          functionCall: { name: tc.name, args: tc.arguments },
        }
        // 还原 thoughtSignature（Gemini 2.5+ 思考模型要求原样返回）
        if (tc.metadata?.thoughtSignature) {
          part.thoughtSignature = tc.metadata.thoughtSignature as string
        }
        parts.push(part)
      }
      contents.push({ role: 'model', parts })
    } else if (contMsg.role === 'tool') {
      const parts: GooglePart[] = contMsg.results.map((r) => ({
        functionResponse: {
          name: r.toolCallId,
          response: { content: r.content },
        },
      }))
      contents.push({ role: 'user', parts })
    }
  }
}

// ===== 适配器实现 =====

export class GoogleAdapter implements ProviderAdapter {
  readonly providerType = 'google' as const

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)
    const contents = toGoogleContents(input)

    // 构建 generationConfig
    const generationConfig: Record<string, unknown> = {}

    // 思考模式配置：
    // - 启用时：显示思考过程 + 设置 thinkingBudget 控制深度
    // - 关闭时：不传 thinkingConfig，模型使用默认行为
    if (input.thinkingEnabled) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 16384,
      }
    }

    const body: Record<string, unknown> = {
      contents,
    }

    // 仅在有配置时才添加 generationConfig
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig
    }

    if (input.systemMessage) {
      body.systemInstruction = {
        parts: [{ text: input.systemMessage }],
      }
    }

    // 工具定义
    if (input.tools && input.tools.length > 0) {
      body.tools = toGoogleTools(input.tools)
    }

    // 工具续接消息
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(contents, input.continuationMessages)
    }

    return {
      url: `${url}/v1beta/models/${input.modelId}:streamGenerateContent?alt=sse&key=${input.apiKey}`,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const parsed = JSON.parse(jsonLine) as GoogleStreamData
      const parts = parsed.candidates?.[0]?.content?.parts
      if (!parts) return []

      const events: StreamEvent[] = []

      // 遍历所有 parts，区分推理内容、正常文本和函数调用
      for (const part of parts) {
        // 函数调用（Google 一次返回完整参数）
        if (part.functionCall) {
          const fc = part.functionCall
          events.push({
            type: 'tool_call_start',
            toolCallId: fc.name,  // Google 没有独立的调用 ID，用函数名
            toolName: fc.name,
            // 保留 thoughtSignature，续接请求需要原样返回
            metadata: part.thoughtSignature
              ? { thoughtSignature: part.thoughtSignature }
              : undefined,
          })
          events.push({
            type: 'tool_call_delta',
            toolCallId: fc.name,
            argumentsDelta: JSON.stringify(fc.args || {}),
          })
          continue
        }

        if (!part.text) continue

        if (part.thought) {
          // Gemini 2.5/3 思考过程
          events.push({ type: 'reasoning', delta: part.text })
        } else {
          // 正常回复内容
          events.push({ type: 'chunk', delta: part.text })
        }
      }

      return events
    } catch {
      return []
    }
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/v1beta/models/${input.modelId}:generateContent?key=${input.apiKey}`,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { maxOutputTokens: 50 },
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as GoogleTitleResponse
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  }
}
