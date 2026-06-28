import { test, expect, describe } from 'bun:test'
import {
  readSessionMessagesFromString,
  groupIntoTurns,
  toTranscript,
  searchTurns,
  selectTurns,
  renderTranscriptMarkdown,
  collapseToolSummaries,
  summarizeToolInput,
} from './index'

/** 把对象数组序列化为 JSONL（每行一个 JSON）。 */
function jsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n')
}

describe('快照去重（格式 B）', () => {
  // 同一 assistant 回合的 3 行递增快照，共享 message.id='m1'
  const raw = jsonl([
    { type: 'user', message: { content: [{ type: 'text', text: '读取文件' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hel' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: '想一下' }, { type: 'text', text: 'Hello world' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } }] }, parent_tool_use_id: null },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'data' }] }, parent_tool_use_id: null },
    { type: 'result', subtype: 'success' },
  ])

  const turns = toTranscript(groupIntoTurns(readSessionMessagesFromString(raw)))

  test('合并为 user + assistant 两个 turn，下标稳定', () => {
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(turns.map((t) => t.index)).toEqual([0, 1])
  })

  test('assistant 只取最完整快照，无拼接重复', () => {
    const a = turns[1]!
    expect(a.text).toBe('Hello world')
    expect(a.text).not.toContain('Hel\n')
  })

  test('thinking 块被丢弃', () => {
    expect(turns[1]!.text).not.toContain('想一下')
  })

  test('tool_use 压缩为单行摘要；tool_result 不进正文', () => {
    expect(turns[1]!.toolSummaries).toEqual(['Read file_path=/a'])
    expect(turns[1]!.text).not.toContain('data')
  })

  test('纯 tool_result 的 user 行不产生用户 turn', () => {
    expect(turns.filter((t) => t.role === 'user')).toHaveLength(1)
  })
})

describe('工具折叠 ×N', () => {
  test('连续相同工具摘要折叠计数', () => {
    expect(collapseToolSummaries(['OCR p=1', 'OCR p=1', 'OCR p=1', 'Read f=a'])).toEqual(['OCR p=1 ×3', 'Read f=a'])
  })

  test('summarizeToolInput 跳过空值并截断长值', () => {
    expect(summarizeToolInput('Read', { file_path: '/a', limit: 0, empty: '' })).toBe('Read file_path=/a limit=0')
    const long = 'x'.repeat(200)
    expect(summarizeToolInput('Bash', { command: long }).length).toBeLessThan(100)
  })
})

describe('旧扁平格式（格式 A）归一', () => {
  const raw = jsonl([
    { id: '1', role: 'user', content: '你好', createdAt: 1 },
    { id: '2', role: 'assistant', content: '旧版回复', createdAt: 2 },
    { id: '3', role: 'assistant', content: '', createdAt: 3 },
  ])
  const turns = toTranscript(groupIntoTurns(readSessionMessagesFromString(raw)))

  test('role 字段被识别并转换为 SDKMessage', () => {
    expect(turns[0]).toMatchObject({ role: 'user', text: '你好' })
    expect(turns[1]).toMatchObject({ role: 'assistant', text: '旧版回复' })
  })
})

describe('容错与渐进式读取原语', () => {
  const raw = jsonl([
    { type: 'user', message: { content: [{ type: 'text', text: '问题甲' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: '答案含关键词 needle' }] }, parent_tool_use_id: null },
    { type: 'user', message: { content: [{ type: 'text', text: '问题乙' }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'a2', content: [{ type: 'text', text: '无关回答' }] }, parent_tool_use_id: null },
  ])

  test('损坏行被静默跳过', () => {
    const withBad = raw + '\n{ 坏行不是 json\n'
    const msgs = readSessionMessagesFromString(withBad)
    expect(msgs.length).toBe(4)
  })

  const turns = toTranscript(groupIntoTurns(readSessionMessagesFromString(raw)))

  test('searchTurns 返回命中 turn 下标', () => {
    const hits = searchTurns(turns, 'needle')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.index).toBe(1)
    expect(hits[0]!.snippet).toContain('needle')
  })

  test('selectTurns 按 range 截取', () => {
    expect(selectTurns(turns, { range: [2, 3] }).map((t) => t.index)).toEqual([2, 3])
    expect(selectTurns(turns, { head: 1 }).map((t) => t.index)).toEqual([0])
    expect(selectTurns(turns, { tail: 1 }).map((t) => t.index)).toEqual([3])
  })

  test('renderTranscriptMarkdown 按角色分段', () => {
    const md = renderTranscriptMarkdown(turns, { sessionId: 'demo' })
    expect(md).toContain('# Session: demo')
    expect(md).toContain('## 用户')
    expect(md).toContain('## 助手')
    expect(md).toContain('答案含关键词 needle')
  })
})
