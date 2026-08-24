import { describe, expect, test } from 'bun:test'
import {
  buildQueuedMessageSendPayload,
  getQueuedMessageDisplayParts,
  parseQueuedMessageMentions,
} from './agent-message-queue'

describe('queued message @file mention path decoding (Agent 侧真实路径)', () => {
  test('decodes percent-encoded @file path back to the real path with spaces', () => {
    const text = '请查看 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('请查看 @file:/Users/me/My report.pdf 这份报告')
  })

  test('keeps legacy unencoded @file paths unchanged', () => {
    const text = '参考 @file:notes/brief.md 内容'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('参考 @file:notes/brief.md 内容')
  })

  test('decode does not affect skill / mcp / session mentions removal', () => {
    const text = '@file:%2FUsers%2Fme%2FMy%20report.pdf /skill:brainstorming #mcp:playwright &session:session-123'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('@file:/Users/me/My report.pdf')
    expect(result.mentionedSkills).toEqual(['brainstorming'])
    expect(result.mentionedMcpServers).toEqual(['playwright'])
    expect(result.mentionedSessionIds).toEqual(['session-123'])
  })

  test('buildQueuedMessageSendPayload sdkText contains the real (decoded) file path', () => {
    const payload = buildQueuedMessageSendPayload({
      id: 'msg-1',
      text: '看下 @file:%2FUsers%2Fme%2FMy%20report.pdf',
      createdAt: Date.now(),
    })
    expect(payload.sdkText).toContain('@file:/Users/me/My report.pdf')
  })

  test('getQueuedMessageDisplayParts shows the full filename for encoded paths with spaces', () => {
    const parts = getQueuedMessageDisplayParts('看下 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告')
    const fileRef = parts.find((p) => p.type === 'reference' && p.referenceType === 'file')
    expect(fileRef).toBeDefined()
    if (fileRef && 'referenceType' in fileRef) {
      // id 保留协议原始值（编码）；label 是展示层解码后的完整文件名
      expect(fileRef.id).toBe('%2FUsers%2Fme%2FMy%20report.pdf')
      expect(fileRef.label).toBe('My report.pdf')
    }
  })

  test('preserves text immediately after a file mention without whitespace', () => {
    const text = '@file:Screenshot%202026-08-24%20at%2014.17.47.png还是做一个单独渲染的内容吧'
    const result = parseQueuedMessageMentions(text)

    expect(result.cleanedText).toBe('@file:Screenshot 2026-08-24 at 14.17.47.png还是做一个单独渲染的内容吧')
    expect(getQueuedMessageDisplayParts(text)).toEqual([
      {
        type: 'reference',
        referenceType: 'file',
        id: 'Screenshot%202026-08-24%20at%2014.17.47.png',
        label: 'Screenshot 2026-08-24 at 14.17.47.png',
      },
      { type: 'text', value: '还是做一个单独渲染的内容吧' },
    ])
  })
})
