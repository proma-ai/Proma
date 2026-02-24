/**
 * 共享 SSE 流式读取器
 *
 * 封装所有供应商通用的 SSE 解析逻辑：
 * - fetch 调用 + 错误检查
 * - ReadableStream reader + TextDecoder 管理
 * - 逐行 buffer 分割 + data: 前缀检测 + [DONE] 哨兵处理
 * - 通过 adapter.parseSSELine() 委托供应商特定解析
 * - 通过回调分发事件
 * - 累积工具调用信息（tool use 支持）
 */

import type { ProviderAdapter, ProviderRequest, StreamEventCallback, ToolCall } from './types.ts'

// ===== 流式请求 =====

/** streamSSE 的输入选项 */
export interface StreamSSEOptions {
  /** 构建好的 HTTP 请求配置 */
  request: ProviderRequest
  /** 供应商适配器（用于解析 SSE 行） */
  adapter: ProviderAdapter
  /** 事件回调 */
  onEvent: StreamEventCallback
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 自定义 fetch 函数（代理等场景下由调用方注入） */
  fetchFn?: typeof globalThis.fetch
}

/** streamSSE 的返回结果 */
export interface StreamSSEResult {
  /** 累积的完整文本内容 */
  content: string
  /** 累积的推理内容 */
  reasoning: string
  /** 本轮返回的工具调用列表 */
  toolCalls: ToolCall[]
  /** 停止原因（'tool_use' 表示需要执行工具后继续） */
  stopReason?: string
}

/**
 * 执行流式 SSE 请求
 *
 * 通用流程：
 * 1. 发起 fetch POST 请求
 * 2. 检查响应状态
 * 3. 获取 ReadableStream reader，逐 chunk 读取
 * 4. 按换行分行，过滤 "data: " 前缀和 "[DONE]" 哨兵
 * 5. 调用 adapter.parseSSELine() 解析供应商特定 JSON
 * 6. 累积 content/reasoning/toolCalls，通过 onEvent 回调分发
 * 7. 返回完整内容
 */
export async function streamSSE(options: StreamSSEOptions): Promise<StreamSSEResult> {
  const { request, adapter, onEvent, signal, fetchFn = fetch } = options

  // 1. 发起请求（支持通过 fetchFn 注入代理）
  const response = await fetchFn(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal,
  })

  // 2. 错误检查
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${adapter.providerType} API 错误 (${response.status}): ${text.slice(0, 300)}`)
  }

  if (!response.body) {
    throw new Error('响应体为空')
  }

  // 3. 读取流
  let content = ''
  let reasoning = ''
  let stopReason: string | undefined
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // 工具调用追踪
  const pendingToolCalls = new Map<string, { id: string; name: string; args: string; metadata?: Record<string, unknown> }>()
  let currentToolCallId: string | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6).trim()
        if (data === '[DONE]' || !data) continue

        // 4. 委托给 adapter 解析供应商特定 JSON
        const events = adapter.parseSSELine(data)

        for (const event of events) {
          if (event.type === 'chunk') {
            content += event.delta
          } else if (event.type === 'reasoning') {
            reasoning += event.delta
          } else if (event.type === 'tool_call_start') {
            currentToolCallId = event.toolCallId
            pendingToolCalls.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolName,
              args: '',
              metadata: event.metadata,
            })
          } else if (event.type === 'tool_call_delta') {
            const tcId = event.toolCallId || currentToolCallId
            if (tcId) {
              const pending = pendingToolCalls.get(tcId)
              if (pending) {
                pending.args += event.argumentsDelta
              }
            }
          } else if (event.type === 'done' && event.stopReason) {
            stopReason = event.stopReason
          }
          onEvent(event)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // 将 pending 工具调用解析为最终结果
  const toolCalls: ToolCall[] = []
  for (const [, pending] of pendingToolCalls) {
    try {
      toolCalls.push({
        id: pending.id,
        name: pending.name,
        arguments: pending.args ? JSON.parse(pending.args) : {},
        metadata: pending.metadata,
      })
    } catch {
      // JSON 解析失败仍保留工具调用（空参数）
      toolCalls.push({
        id: pending.id,
        name: pending.name,
        arguments: {},
        metadata: pending.metadata,
      })
    }
  }

  // 有工具调用但无显式 stopReason 时自动推断
  if (toolCalls.length > 0 && !stopReason) {
    stopReason = 'tool_use'
  }

  onEvent({ type: 'done', stopReason })
  return { content, reasoning, toolCalls, stopReason }
}

// ===== 非流式标题请求 =====

/**
 * 执行非流式标题生成请求
 *
 * @param request 构建好的 HTTP 请求配置
 * @param adapter 供应商适配器（用于解析响应）
 * @returns 提取的标题文本，失败返回 null
 */
export async function fetchTitle(
  request: ProviderRequest,
  adapter: ProviderAdapter,
  fetchFn: typeof globalThis.fetch = fetch,
): Promise<string | null> {
  try {
    console.log('[fetchTitle] 发送请求:', {
      url: request.url,
      provider: adapter.providerType,
      bodyPreview: request.body.slice(0, 200),
    })

    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })

    console.log('[fetchTitle] 收到响应:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown')
      console.warn('[fetchTitle] 请求失败:', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      return null
    }

    const data: unknown = await response.json()
    console.log('[fetchTitle] 解析响应体:', {
      provider: adapter.providerType,
      dataPreview: JSON.stringify(data).slice(0, 500),
    })

    const title = adapter.parseTitleResponse(data)
    console.log('[fetchTitle] 解析标题结果:', { title })
    return title
  } catch (error) {
    console.error('[fetchTitle] 异常:', error)
    return null
  }
}
