/**
 * Anthropic 供应商适配器
 *
 * 实现 Anthropic Messages API 的消息转换、请求构建和 SSE 解析。
 * 特点：
 * - 角色：user / assistant（不支持 system 角色，system 通过 body.system 传递）
 * - 图片格式：{ type: 'image', source: { type: 'base64', media_type, data } }
 * - SSE 解析：content_block_delta → text，thinking_delta → reasoning，tool_use 支持
 * - 认证：x-api-key + Authorization: Bearer（Kimi Coding Plan 只用 Bearer）
 * - 同时适配 Anthropic 原生 API、DeepSeek、Kimi API、Kimi Coding Plan
 *
 * 思考模式按模型能力分支（见 thinking-capability.ts）：
 * - Opus 4.7 / Mythos Preview：adaptive 唯一模式（发 `{type: 'adaptive'}`）
 * - Opus 4.6 / Sonnet 4.6：推荐 adaptive
 * - DeepSeek v4 系列：`{type: 'enabled'}` + `output_config.effort = 'max'`
 * - 更老的 Claude 系列及 DeepSeek v3：manual（旧版 `{type: 'enabled', budget_tokens}`）
 * - Kimi（kimi-api / kimi-coding）：不发 thinking 字段（K2 系列非 reasoning 模型）
 *
 * Kimi Coding Plan 特殊要求：
 * - Base URL：`https://api.kimi.com/coding/v1`
 * - 必须发送 `User-Agent: KimiCLI/1.3`，服务端会校验 coding agent 白名单
 * - 禁止伪造 User-Agent（违反服务条款可能导致会员停权）
 */

import type { ProviderType } from '@proma/shared'
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
import { normalizeAnthropicBaseUrl, normalizeBaseUrl } from './url-utils.ts'
import { detectThinkingCapability } from './thinking-capability.ts'

// ===== Anthropic 特有类型 =====

/** Anthropic 内容块（扩展支持 tool_use / tool_result） */
interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  source?: {
    type: 'base64'
    media_type: string
    data: string
  }
  // thinking 字段
  thinking?: string
  /** thinking 块签名（Anthropic 协议 + DeepSeek v4：续接回传时必须包含） */
  signature?: string
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
    /** 思考签名增量 (signature_delta) */
    signature?: string
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
 *
 * **为什么历史 assistant 消息不回传 thinking 块**：
 * Anthropic 协议要求 thinking 块带 `signature`（服务端签发的加密签名）才能合法回传。
 * 但我们持久化到 JSONL 的只有 `reasoning` 文本，签名不会持久化（也无法跨轮次保持有效）。
 * 若把无签名的历史 thinking 块发回服务端，DeepSeek v4 / Anthropic 原生都会以
 * "content[].thinking must be passed back" / 签名验证失败拒绝请求。
 * 所以 history 只发 `text`；thinking 块仅在**当前这次 send 的续接消息**里回传
 * （见 appendContinuationMessages，那里用刚抓到的带签名的块）。
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
 *
 * 块顺序遵循 Anthropic 协议：thinking → text → tool_use。
 *
 * 思考块回传策略：
 * - 优先用结构化的 `thinkingBlocks`（每块含 thinking + 可选 signature），严格对齐服务端
 *   原始块结构，DeepSeek v4 / Anthropic 原生都要求签名匹配
 * - 若 thinkingBlocks 缺失但有扁平 `reasoning` 文本，降级成单个无签名 thinking 块
 * - 当前请求关闭思考时**不**回传任何 thinking 块（否则服务端判定思考仍激活）
 */
function appendContinuationMessages(
  messages: AnthropicMessage[],
  continuationMessages: ContinuationMessage[],
  thinkingEnabled: boolean,
): void {
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      const content: AnthropicContentBlock[] = []

      if (thinkingEnabled) {
        if (contMsg.thinkingBlocks && contMsg.thinkingBlocks.length > 0) {
          for (const block of contMsg.thinkingBlocks) {
            const thinkingBlock: AnthropicContentBlock = {
              type: 'thinking',
              thinking: block.thinking,
            }
            if (block.signature) {
              thinkingBlock.signature = block.signature
            }
            content.push(thinkingBlock)
          }
        } else if (contMsg.reasoning && contMsg.reasoning.length > 0) {
          content.push({ type: 'thinking', thinking: contMsg.reasoning })
        }
      }

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
  readonly providerType: ProviderType

  constructor(providerType: ProviderType = 'anthropic') {
    this.providerType = providerType
  }

  /** 根据 provider 类型选择 URL 规范化方式 */
  private normalizeUrl(baseUrl: string): string {
    // DeepSeek / Kimi：baseUrl 本身已含非版本路径（如 /anthropic、/coding/v1），不追加 /v1
    if (
      this.providerType === 'deepseek' ||
      this.providerType === 'kimi-api' ||
      this.providerType === 'kimi-coding'
    ) {
      return normalizeBaseUrl(baseUrl)
    }
    return normalizeAnthropicBaseUrl(baseUrl)
  }

  /**
   * 构造请求头
   *
   * Kimi Coding Plan 要求：
   * - 只使用 Bearer（服务端会校验 User-Agent 白名单，不接受伪装为浏览器/SDK）
   * - User-Agent 必须是真实 coding agent 身份（如 KimiCLI/1.3）
   */
  private buildHeaders(apiKey: string): Record<string, string> {
    const base: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
    if (this.providerType === 'kimi-coding') {
      base['Authorization'] = `Bearer ${apiKey}`
      base['User-Agent'] = 'KimiCLI/1.3'
      return base
    }
    // 其它渠道：保持双认证头（Anthropic 原生 + Bearer 兼容）
    base['x-api-key'] = apiKey
    base['Authorization'] = `Bearer ${apiKey}`
    return base
  }

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = this.normalizeUrl(input.baseUrl)
    const messages = toAnthropicMessages(input)
    const capability = detectThinkingCapability(this.providerType, input.modelId)

    // manual 模式：budget_tokens 必须 < max_tokens，所以开启时放大上限
    // adaptive / effort-based 模式：max_tokens 作为「思考+回答」的总硬上限，给充足空间
    const manualThinkingBudget = 16384
    let maxTokens: number
    if (!input.thinkingEnabled) {
      maxTokens = 8192
    } else if (capability.mode === 'manual-only') {
      maxTokens = manualThinkingBudget + 16384
    } else {
      maxTokens = 32000
    }

    const body: Record<string, unknown> = {
      model: input.modelId,
      max_tokens: maxTokens,
      messages,
      stream: true,
    }

    // 根据模型能力选择思考协议
    // - adaptive-only / adaptive-preferred：发 { type: 'adaptive', display: 'summarized' }
    //   （Opus 4.7 的 display 默认是 'omitted'，需显式 'summarized' 才能收到 thinking 文本流）
    // - manual-only：发旧版 { type: 'enabled', budget_tokens }
    // - effort-based-max（DeepSeek v4 系列）：{type: 'enabled'} + output_config.effort='max'
    //   DeepSeek v4 默认就开启思考，所以关闭时必须显式 {type: 'disabled'}
    if (capability.mode === 'effort-based-max') {
      if (input.thinkingEnabled) {
        body.thinking = { type: 'enabled' }
        body.output_config = { effort: 'max' }
      } else {
        body.thinking = { type: 'disabled' }
      }
    } else if (input.thinkingEnabled) {
      if (capability.mode === 'adaptive-only' || capability.mode === 'adaptive-preferred') {
        body.thinking = {
          type: 'adaptive',
          display: 'summarized',
        }
      } else if (capability.mode === 'manual-only') {
        body.thinking = {
          type: 'enabled',
          budget_tokens: manualThinkingBudget,
        }
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
      appendContinuationMessages(messages, input.continuationMessages, !!input.thinkingEnabled)
    }

    const requestBody = JSON.stringify(body)

    // 调试：开启 PROMA_DEBUG_REQUEST 时打印请求体，便于排查思考+工具场景的消息结构
    const procReq = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    if (procReq?.env?.PROMA_DEBUG_REQUEST) {
      console.log('[Request]', this.providerType, input.modelId, '→', requestBody.slice(0, 4000))
    }

    return {
      url: `${url}/messages`,
      headers: this.buildHeaders(input.apiKey),
      body: requestBody,
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const event = JSON.parse(jsonLine) as AnthropicSSEEvent
      const events: StreamEvent[] = []

      // 调试：开启 PROMA_DEBUG_SSE 时打印原始事件，便于排查 Provider 的 SSE 格式差异
      const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      if (proc?.env?.PROMA_DEBUG_SSE) {
        console.log('[SSE]', jsonLine.slice(0, 400))
      }

      // 内容块开始
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'tool_use') {
          events.push({
            type: 'tool_call_start',
            toolCallId: event.content_block.id || '',
            toolName: event.content_block.name || '',
          })
        } else if (event.content_block?.type === 'thinking') {
          events.push({ type: 'reasoning_block_start' })
        }
      }

      if (event.type === 'content_block_stop') {
        // 无法从 stop 事件判断具体块类型，但 sse-reader 会忽略不相关的停止
        events.push({ type: 'reasoning_block_stop' })
      }

      if (event.type === 'content_block_delta') {
        // 推理文本增量
        if (event.delta?.type === 'thinking_delta' && event.delta?.thinking) {
          events.push({ type: 'reasoning', delta: event.delta.thinking })
        } else if (event.delta?.type === 'signature_delta' && event.delta?.signature) {
          // 推理签名增量（Anthropic 协议：thinking 块必须附带 signature 才能在续接里回传）
          events.push({ type: 'reasoning_signature', signature: event.delta.signature })
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
    const url = this.normalizeUrl(input.baseUrl)
    const capability = detectThinkingCapability(this.providerType, input.modelId)

    const body: Record<string, unknown> = {
      model: input.modelId,
      max_tokens: 50,
      messages: [{ role: 'user', content: input.prompt }],
    }

    // 标题生成不需要思考：按模型能力选择禁用方式
    // - Mythos Preview 不接受 disabled，省略字段即可
    // - 其它 Claude 显式 disabled（对 manual / adaptive 模型都有效）
    if (capability.disableStrategy === 'explicit-disabled') {
      body.thinking = { type: 'disabled' }
    }

    return {
      url: `${url}/messages`,
      headers: this.buildHeaders(input.apiKey),
      body: JSON.stringify(body),
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
