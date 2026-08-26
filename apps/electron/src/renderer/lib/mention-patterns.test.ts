import { describe, expect, test } from 'bun:test'
import { createMentionPattern } from './mention-patterns'

describe('mention token boundaries', () => {
  test('stops a file chip before adjacent CJK text', () => {
    const text = '@file:Screenshot%202026-08-24%20at%2014.17.47.png还是做一个单独渲染的内容吧'
    const matches = Array.from(text.matchAll(createMentionPattern()))

    expect(matches).toHaveLength(1)
    expect(matches[0]?.[1]).toBe('Screenshot%202026-08-24%20at%2014.17.47.png')
  })

  test('keeps encoded named-reference labels intact before adjacent CJK text', () => {
    const text = `&session:session-123::${encodeURIComponent('上下文整理')}继续查看`
    const matches = Array.from(text.matchAll(createMentionPattern()))

    expect(matches).toHaveLength(1)
    expect(matches[0]?.[4]).toBe('session-123')
    expect(matches[0]?.[5]).toBe(encodeURIComponent('上下文整理'))
  })

  test('supports whitespace-delimited raw Skill and MCP identifiers, including CJK MCP names', () => {
    const text = '/skill:brainstorming #mcp:中文服务器 后续文本'
    const matches = Array.from(text.matchAll(createMentionPattern()))

    expect(matches.map((match) => match[0])).toEqual([
      '/skill:brainstorming',
      '#mcp:中文服务器',
    ])
    expect(matches[1]?.[3]).toBe('中文服务器')
  })
})
