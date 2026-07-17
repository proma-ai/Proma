import { describe, expect, test } from 'bun:test'
import { OpenAIResponsesAdapter } from './openai-responses-adapter.ts'

const adapter = new OpenAIResponsesAdapter()

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
      metadata: { itemId: 'fc_1' },
    }])
    expect(delta).toEqual([{ type: 'tool_call_delta', toolCallId: '', argumentsDelta: '{"query":"Proma"}' }])
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
