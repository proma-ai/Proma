import { describe, expect, test } from 'bun:test'
import {
  buildQuotedSelectionBlock,
  expandAgentHistoryQuoteMentions,
  parseAgentHistoryQuoteMention,
  parseQuotedSelectionRefs,
  serializeAgentHistoryQuoteMention,
} from './quoted-selection'

describe('quoted selection XML', () => {
  test('Given 文件引用 When 构建并解析引用块 Then 保留文件名并移除隐藏 XML', () => {
    const block = buildQuotedSelectionBlock({
      text: '引用内容</quoted_file>',
      filePath: '/tmp/demo & draft.md',
      sourceType: 'file',
      capturedAt: 1,
    })
    const parsed = parseQuotedSelectionRefs(`${block}我的问题：`)

    expect(block).toContain('path="/tmp/demo &amp; draft.md"')
    expect(block).toContain('</quoted_file_>')
    expect(parsed.quotes).toEqual([
      {
        path: '/tmp/demo & draft.md',
        filename: 'demo & draft.md',
        sourceType: 'file',
      },
    ])
    expect(parsed.text).toBe('我的问题：')
  })

  test('Given Agent 和草稿引用 When 解析引用块 Then 区分来源类型并使用展示标签', () => {
    const content = [
      '<quoted_context source="agent-history" label="Agent 历史 · Agent 回复" message_id="m1" role="assistant">',
      '历史内容',
      '</quoted_context>',
      '<quoted_context source="scratch-pad" label="草稿页" message_id="" role="">',
      '草稿内容',
      '</quoted_context>',
      '继续提问',
    ].join('\n')

    const parsed = parseQuotedSelectionRefs(content)

    expect(parsed.quotes).toEqual([
      {
        path: 'Agent 历史 · Agent 回复',
        filename: 'Agent 历史 · Agent 回复',
        sourceType: 'agent-history',
        label: 'Agent 历史 · Agent 回复',
        quote: {
          text: '历史内容',
          filePath: 'Agent 历史 · Agent 回复',
          sourceType: 'agent-history',
          sourceLabel: 'Agent 历史 · Agent 回复',
          messageId: 'm1',
          messageRole: 'assistant',
          capturedAt: 0,
        },
      },
      {
        path: '草稿页',
        filename: '草稿页',
        sourceType: 'scratch-pad',
        label: '草稿页',
      },
    ])
    expect(parsed.text).toBe('继续提问')
  })

  test('Given 可定位的 Agent 历史选区 When 序列化、发送并解析 Then 保留范围且用 inline marker 展示', () => {
    const quote = {
      text: '第二轮的关键内容',
      filePath: 'Agent 历史 · Agent 回复',
      sourceType: 'agent-history' as const,
      sourceLabel: 'Agent 历史 · Agent 回复',
      messageId: 'message-2',
      messageRole: 'assistant' as const,
      selectionStart: 12,
      selectionEnd: 20,
      turn: 2,
      capturedAt: 1,
    }
    const marker = serializeAgentHistoryQuoteMention(quote)

    expect(marker).not.toBeNull()
    const expanded = expandAgentHistoryQuoteMentions(`问题前 ${marker} 问题后`).replace(/\n/g, '\r\n')
    const parsed = parseQuotedSelectionRefs(expanded, { inlineAgentHistoryQuotes: true })

    expect(parsed.text).toBe(`问题前 ${marker} 问题后`)
    expect(parseAgentHistoryQuoteMention(parsed.text.match(/&quote:\S+/)?.[0] ?? '')).toMatchObject({
      text: quote.text,
      messageId: quote.messageId,
      messageRole: quote.messageRole,
      selectionStart: quote.selectionStart,
      selectionEnd: quote.selectionEnd,
      turn: quote.turn,
    })
  })
})
