import { describe, expect, test } from 'bun:test'
import { OpenAIResponsesAdapter } from './openai-responses-adapter.ts'
import { streamSSE } from './sse-reader.ts'

const adapter = new OpenAIResponsesAdapter()

function createSSEFetch(events: unknown[]): typeof fetch {
  return (async () => new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  }), { status: 200 })) as unknown as typeof fetch
}

function buildRequest() {
  return {
    url: 'https://api.openai.com/v1/responses',
    headers: { Authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    body: '{}',
  }
}

describe('OpenAIResponsesAdapter', () => {
  test('Given 基础输入 When buildStreamRequest Then 使用 /responses 和 input 格式', () => {
    const request = adapter.buildStreamRequest({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      modelId: 'gpt-5.1',
      history: [{ id: 'm1', role: 'assistant', content: '历史回复', createdAt: 1 }],
      userMessage: '你好',
      systemMessage: '你是 Proma',
      readImageAttachments: () => [],
    })

    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(request.body) as { model: string; stream: boolean; input: unknown[] }
    expect(body.model).toBe('gpt-5.1')
    expect(body.stream).toBe(true)
    expect(body.input).toEqual([
      { role: 'system', content: '你是 Proma' },
      { role: 'assistant', content: '历史回复' },
      { role: 'user', content: '你好' },
    ])
  })

  test('Given Responses 文本 delta When parseSSELine Then 输出 chunk', () => {
    expect(adapter.parseSSELine(JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' }))).toEqual([
      { type: 'chunk', delta: 'hi' },
    ])
  })

  test('Given Responses 工具调用事件 When parseSSELine Then 输出工具事件', () => {
    const start = adapter.parseSSELine(JSON.stringify({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search' },
    }))
    const delta = adapter.parseSSELine(JSON.stringify({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: '{"query":"Proma"}',
    }))

    expect(start).toEqual([{
      type: 'tool_call_start',
      toolCallId: 'call_1|fc_1',
      toolName: 'search',
      metadata: { itemId: 'fc_1', outputIndex: 0 },
    }])
    expect(delta).toEqual([{
      type: 'tool_call_delta',
      toolCallId: '',
      argumentsDelta: '{"query":"Proma"}',
      metadata: { outputIndex: 0 },
    }])
  })

  test('Given 多个工具调用参数交错 When streamSSE Then 按 output_index 分别累积参数', async () => {
    const result = await streamSSE({
      request: buildRequest(),
      adapter,
      fetchFn: createSSEFetch([
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search' } },
        { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'read' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"query"' },
        { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"path"' },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: ':"Proma"}' },
        { type: 'response.function_call_arguments.delta', output_index: 1, delta: ':"README.md"}' },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
      onEvent: () => {},
    })

    expect(result.stopReason).toBe('tool_use')
    expect(result.toolCalls).toEqual([
      { id: 'call_1|fc_1', name: 'search', arguments: { query: 'Proma' }, metadata: { itemId: 'fc_1', outputIndex: 0 } },
      { id: 'call_2|fc_2', name: 'read', arguments: { path: 'README.md' }, metadata: { itemId: 'fc_2', outputIndex: 1 } },
    ])
  })

  test('Given done 事件携带完整参数 When streamSSE Then 使用 finalArguments 替换增量兜底', async () => {
    const result = await streamSSE({
      request: buildRequest(),
      adapter,
      fetchFn: createSSEFetch([
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"query":"partial"' },
        { type: 'response.function_call_arguments.done', output_index: 0, arguments: '{"query":"Proma"}' },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
      onEvent: () => {},
    })

    expect(result.toolCalls).toEqual([
      { id: 'call_1|fc_1', name: 'search', arguments: { query: 'Proma' }, metadata: { itemId: 'fc_1', outputIndex: 0 } },
    ])
  })

  test('Given 仅 output_item.done 携带工具调用 When streamSSE Then 仍可恢复工具参数', async () => {
    const result = await streamSSE({
      request: buildRequest(),
      adapter,
      fetchFn: createSSEFetch([
        { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search', arguments: '{"query":"Proma"}' } },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
      onEvent: () => {},
    })

    expect(result.toolCalls).toEqual([
      { id: 'call_1|fc_1', name: 'search', arguments: { query: 'Proma' }, metadata: { itemId: 'fc_1', outputIndex: 0 } },
    ])
  })

  test('Given completed 事件 When parseSSELine Then 不提前固定 stopReason 以允许工具调用推断', () => {
    expect(adapter.parseSSELine(JSON.stringify({
      type: 'response.completed',
      response: { status: 'completed' },
    }))).toEqual([])
  })

  test('Given 标题响应 When parseTitleResponse Then 提取 output_text', () => {
    expect(adapter.parseTitleResponse({ output_text: ' 简短标题 ' })).toBe('简短标题')
  })
})
