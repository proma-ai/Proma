/**
 * OpenAI Responses API 适配器。
 *
 * 用于支持 `/v1/responses` 协议的渠道：
 * - Chat 模式直接按 Responses API 构建 input / tools / SSE 解析
 * - Pi-Agent 模式通过 pi-model-registry 注册为 `openai-responses` 协议
 */

import type { ProviderType } from '@proma/shared'
import type {
  ContinuationMessage,
  ImageAttachmentData,
  ProviderAdapter,
  ProviderRequest,
  StreamEvent,
  StreamRequestInput,
  TitleRequestInput,
  ToolDefinition,
} from './types.ts'
import { resolveOpenAIResponsesUrl } from './url-utils.ts'

// ===== Responses API 类型（只声明 Proma 需要的字段） =====

interface ResponsesInputTextPart {
  type: 'input_text' | 'output_text'
  text: string
}

interface ResponsesInputImagePart {
  type: 'input_image'
  image_url: string
  detail: 'auto'
}

type ResponsesContentPart = ResponsesInputTextPart | ResponsesInputImagePart

interface ResponsesMessageInputItem {
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string | ResponsesContentPart[]
}

interface ResponsesFunctionCallInputItem {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
  id?: string
}

interface ResponsesFunctionCallOutputInputItem {
  type: 'function_call_output'
  call_id: string
  output: string
}

type ResponsesInputItem =
  | ResponsesMessageInputItem
  | ResponsesFunctionCallInputItem
  | ResponsesFunctionCallOutputInputItem

interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: ToolDefinition['parameters']
  strict: false
}

interface ResponsesStreamItem {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string; refusal?: string }>
  summary?: Array<{ text?: string }>
}

interface ResponsesStreamData {
  type?: string
  delta?: string
  output_index?: number
  item?: ResponsesStreamItem
  arguments?: string
  response?: {
    status?: string
    output?: ResponsesStreamItem[]
    error?: { code?: string; message?: string }
    incomplete_details?: { reason?: string }
  }
  code?: string
  message?: string
}

interface ResponsesTitleResponse {
  output_text?: string
  output?: ResponsesStreamItem[]
}

// ===== 消息转换 =====

function buildInputImageParts(imageData: ImageAttachmentData[]): ResponsesInputImagePart[] {
  return imageData.map((img) => ({
    type: 'input_image' as const,
    image_url: `data:${img.mediaType};base64,${img.data}`,
    detail: 'auto' as const,
  }))
}

function buildUserContent(text: string, imageData: ImageAttachmentData[]): string | ResponsesContentPart[] {
  if (imageData.length === 0) return text

  const content: ResponsesContentPart[] = []
  if (text) content.push({ type: 'input_text', text })
  content.push(...buildInputImageParts(imageData))
  return content
}

function splitResponsesToolCallId(toolCallId: string): { callId: string; itemId?: string } {
  const [callId, itemId] = toolCallId.split('|')
  return { callId: callId || toolCallId, ...(itemId ? { itemId } : {}) }
}

function buildResponsesToolCallId(item: ResponsesStreamItem, outputIndex?: number): string {
  const callId = item.call_id || item.id || `call_${outputIndex ?? 0}`
  return item.id ? `${callId}|${item.id}` : callId
}

function buildResponsesToolCallMetadata(item: ResponsesStreamItem, outputIndex?: number): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (item.id) metadata.itemId = item.id
  if (outputIndex !== undefined) metadata.outputIndex = outputIndex
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function toResponsesInput(input: StreamRequestInput): ResponsesInputItem[] {
  const { history, userMessage, systemMessage, attachments, readImageAttachments } = input
  const items: ResponsesInputItem[] = []

  if (systemMessage) {
    items.push({ role: 'system', content: systemMessage })
  }

  for (const msg of history) {
    if (msg.role === 'system') continue
    if (msg.role === 'assistant') {
      if (msg.content) {
        items.push({ role: 'assistant', content: msg.content })
      }
      continue
    }

    if (msg.attachments && msg.attachments.length > 0) {
      items.push({ role: 'user', content: buildUserContent(msg.content, readImageAttachments(msg.attachments)) })
    } else {
      items.push({ role: 'user', content: msg.content })
    }
  }

  const currentImages = readImageAttachments(attachments)
  items.push({ role: 'user', content: buildUserContent(userMessage, currentImages) })

  return items
}

function toResponsesTools(tools: ToolDefinition[]): ResponsesTool[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }))
}

function appendContinuationMessages(
  items: ResponsesInputItem[],
  continuationMessages: ContinuationMessage[],
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      if (contMsg.content) {
        items.push({ role: 'assistant', content: contMsg.content })
      }
      for (const tc of contMsg.toolCalls) {
        const { callId, itemId } = splitResponsesToolCallId(tc.id)
        items.push({
          type: 'function_call',
          ...(itemId ? { id: itemId } : {}),
          call_id: callId,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })
      }
    } else if (contMsg.role === 'tool') {
      for (const result of contMsg.results) {
        const { callId } = splitResponsesToolCallId(result.toolCallId)
        items.push({
          type: 'function_call_output',
          call_id: callId,
          output: result.content,
        })
      }
    }
  }
}

function collectOutputText(items: ResponsesStreamItem[] | undefined): string | null {
  if (!items) return null
  const text = items
    .flatMap((item) => item.content ?? [])
    .map((content) => content.type === 'output_text' ? content.text ?? '' : content.refusal ?? '')
    .join('')
    .trim()
  return text || null
}

function mapResponsesStatusToStopReason(status: string | undefined): string | undefined {
  switch (status) {
    // completed 不主动设置 stopReason：如果本轮产生了工具调用，sse-reader 会根据
    // toolCalls 自动推断为 tool_use；没有工具调用时 Chat 流程也无需依赖 end_turn。
    case 'completed':
      return undefined
    case 'incomplete':
      return 'max_tokens'
    case 'failed':
    case 'cancelled':
      return 'error'
    default:
      return undefined
  }
}

// ===== 适配器实现 =====

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly providerType: ProviderType

  constructor(providerType: ProviderType = 'openai-responses') {
    this.providerType = providerType
  }

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = resolveOpenAIResponsesUrl(input.baseUrl, this.providerType)
    const bodyObj: Record<string, unknown> = {
      model: input.modelId,
      input: toResponsesInput(input),
      stream: true,
    }

    if (input.tools && input.tools.length > 0) {
      bodyObj.tools = toResponsesTools(input.tools)
    }

    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(bodyObj.input as ResponsesInputItem[], input.continuationMessages)
    }

    return {
      url,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const event = JSON.parse(jsonLine) as ResponsesStreamData
      const events: StreamEvent[] = []

      switch (event.type) {
        case 'response.output_text.delta':
        case 'response.refusal.delta':
          if (event.delta) events.push({ type: 'chunk', delta: event.delta })
          break

        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
          if (event.delta) events.push({ type: 'reasoning', delta: event.delta })
          break

        case 'response.reasoning_summary_part.done':
          events.push({ type: 'reasoning', delta: '\n\n' })
          break

        case 'response.output_item.added':
          if (event.item?.type === 'function_call') {
            events.push({
              type: 'tool_call_start',
              toolCallId: buildResponsesToolCallId(event.item, event.output_index),
              toolName: event.item.name || 'function',
              metadata: buildResponsesToolCallMetadata(event.item, event.output_index),
            })
            if (event.item.arguments) {
              events.push({
                type: 'tool_call_delta',
                toolCallId: '',
                argumentsDelta: event.item.arguments,
                metadata: buildResponsesToolCallMetadata(event.item, event.output_index),
              })
            }
          }
          break

        case 'response.function_call_arguments.delta':
          if (event.delta) {
            events.push({
              type: 'tool_call_delta',
              toolCallId: '',
              argumentsDelta: event.delta,
              metadata: event.output_index !== undefined ? { outputIndex: event.output_index } : undefined,
            })
          }
          break

        case 'response.function_call_arguments.done':
          if (event.arguments !== undefined) {
            events.push({
              type: 'tool_call_delta',
              toolCallId: '',
              argumentsDelta: '',
              finalArguments: event.arguments,
              metadata: event.output_index !== undefined ? { outputIndex: event.output_index } : undefined,
            })
          }
          break

        case 'response.output_item.done':
          if (event.item?.type === 'function_call') {
            events.push({
              type: 'tool_call_start',
              toolCallId: buildResponsesToolCallId(event.item, event.output_index),
              toolName: event.item.name || 'function',
              metadata: buildResponsesToolCallMetadata(event.item, event.output_index),
            })
            if (event.item.arguments !== undefined) {
              events.push({
                type: 'tool_call_delta',
                toolCallId: buildResponsesToolCallId(event.item, event.output_index),
                argumentsDelta: '',
                finalArguments: event.item.arguments,
                metadata: buildResponsesToolCallMetadata(event.item, event.output_index),
              })
            }
          }
          break

        case 'response.completed':
        case 'response.incomplete': {
          const stopReason = mapResponsesStatusToStopReason(event.response?.status)
          if (stopReason) events.push({ type: 'done', stopReason })
          break
        }

        case 'response.failed': {
          const error = event.response?.error
          const details = event.response?.incomplete_details
          const message = error?.message ?? details?.reason ?? 'OpenAI Responses 请求失败'
          events.push({ type: 'error', error: error?.code ? `${error.code}: ${message}` : message })
          events.push({ type: 'done', stopReason: 'error' })
          break
        }

        case 'error':
          events.push({ type: 'error', error: event.message ?? event.code ?? 'OpenAI Responses 流式错误' })
          events.push({ type: 'done', stopReason: 'error' })
          break
      }

      return events
    } catch {
      return []
    }
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = resolveOpenAIResponsesUrl(input.baseUrl, this.providerType)

    return {
      url,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        input: [{ role: 'user', content: input.prompt }],
        max_output_tokens: 50,
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as ResponsesTitleResponse
    return data.output_text?.trim() || collectOutputText(data.output) || null
  }
}
