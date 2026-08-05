import { describe, expect, test } from 'bun:test'
import { sdkBlockText, sdkMessageText, extractRecentConversationText } from './sdk-messages'
import type { SDKMessage } from '@proma/shared'

describe('suggest/sdk-messages: 块文本提取', () => {
  test('text 块提取文本', () => {
    expect(sdkBlockText({ type: 'text', text: 'hello' })).toBe('hello')
  })

  test('tool_use 块不提取文本', () => {
    expect(sdkBlockText({ type: 'tool_use', id: 'x', name: 'bash', input: {} })).toBe('')
  })

  test('thinking 块不提取文本', () => {
    expect(sdkBlockText({ type: 'thinking', thinking: '...' })).toBe('')
  })

  test('非法输入返回空', () => {
    expect(sdkBlockText(null)).toBe('')
    expect(sdkBlockText('string')).toBe('')
    expect(sdkBlockText(42)).toBe('')
  })
})

describe('suggest/sdk-messages: 消息文本提取', () => {
  test('user 消息（SDK 格式）提取文本', () => {
    const msg = {
      type: 'user',
      message: { content: [{ type: 'text', text: '以后不要用 var' }] },
      parent_tool_use_id: null,
    } as unknown as SDKMessage
    expect(sdkMessageText(msg)).toBe('以后不要用 var')
  })

  test('assistant 消息提取文本', () => {
    const msg = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '好的' }] },
      parent_tool_use_id: null,
    } as unknown as SDKMessage
    expect(sdkMessageText(msg)).toBe('好的')
  })

  test('tool_result 内容块不提取为对话文本', () => {
    const msg = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'output' }] },
      parent_tool_use_id: null,
    } as unknown as SDKMessage
    // 只含 tool_result → 返回 null
    expect(sdkMessageText(msg)).toBeNull()
  })

  test('system/result 消息返回 null', () => {
    expect(sdkMessageText({ type: 'system', subtype: 'compact_boundary' } as unknown as SDKMessage)).toBeNull()
    expect(sdkMessageText({ type: 'result', subtype: 'success' } as unknown as SDKMessage)).toBeNull()
  })

  test('多段 content 拼接', () => {
    const msg = {
      type: 'user',
      message: {
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool_use', id: 'x', name: 'bash', input: {} },
          { type: 'text', text: '第二段' },
        ],
      },
      parent_tool_use_id: null,
    } as unknown as SDKMessage
    expect(sdkMessageText(msg)).toBe('第一段\n第二段')
  })
})

describe('suggest/sdk-messages: 会话提取', () => {
  test('混合消息提取 user/assistant 文本并按时间序', () => {
    const messages = [
      { type: 'system', subtype: 'init' },
      { type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null },
      { type: 'assistant', message: { content: [{ type: 'text', text: '你好！' }] }, parent_tool_use_id: null },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'out' }] }, parent_tool_use_id: null },
      { type: 'user', message: { content: [{ type: 'text', text: '以后不要用 X' }] }, parent_tool_use_id: null },
    ] as unknown as SDKMessage[]

    const result = extractRecentConversationText(messages, 30)
    expect(result.length).toBe(3)
    expect(result[0]).toEqual({ role: 'user', content: '你好' })
    expect(result[1]).toEqual({ role: 'assistant', content: '你好！' })
    expect(result[2]).toEqual({ role: 'user', content: '以后不要用 X' })
  })

  test('limit 截断取最近 N 条', () => {
    const messages: SDKMessage[] = []
    for (let i = 0; i < 10; i++) {
      messages.push({ type: 'user', message: { content: [{ type: 'text', text: `msg${i}` }] }, parent_tool_use_id: null } as unknown as SDKMessage)
    }
    const result = extractRecentConversationText(messages, 3)
    expect(result.length).toBe(3)
    expect(result[0]?.content).toBe('msg7')
    expect(result[2]?.content).toBe('msg9')
  })

  test('空/无效消息返回空数组', () => {
    expect(extractRecentConversationText([], 10)).toEqual([])
    expect(extractRecentConversationText([{ type: 'system', subtype: 'x' } as unknown as SDKMessage], 10)).toEqual([])
  })
})
