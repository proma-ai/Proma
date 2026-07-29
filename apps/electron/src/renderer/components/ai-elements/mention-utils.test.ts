import { describe, expect, test } from 'bun:test'
import { resolveMentionSuggestionChar } from './mention-utils'

describe('Mention 协议字符兼容', () => {
  test('Given 旧草稿含非 slash chip When 仅注册 slash suggestion Then 保留节点自身字符', () => {
    expect(resolveMentionSuggestionChar('@', '/')).toBe('@')
    expect(resolveMentionSuggestionChar('#', '/')).toBe('#')
    expect(resolveMentionSuggestionChar('&', '/')).toBe('&')
  })

  test('Given 节点缺少字符 When 渲染 mention Then 使用 suggestion 或默认文件字符', () => {
    expect(resolveMentionSuggestionChar(undefined, '/')).toBe('/')
    expect(resolveMentionSuggestionChar(undefined)).toBe('@')
  })
})
