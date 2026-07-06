import { describe, expect, test } from 'bun:test'
import { createAgentQueuedMessage, buildQueuedMessageSendPayload } from './agent-message-queue'
import { buildQuotedSelectionBlock } from './quoted-selection'
import type { QuotedSelection } from '@/atoms/preview-atoms'

describe('agent-message-queue', () => {
  test('Given 带引用选区的队列消息 When 构建发送 payload Then 保留引用并剥离 mention 语法', () => {
    const quotedSelection: QuotedSelection = {
      text: '被引用的内容',
      filePath: '/tmp/demo.md',
      capturedAt: 123,
    }

    const message = createAgentQueuedMessage(
      '继续解释 /skill:writer #mcp:docs &session:abc',
      'queued-1',
      456,
      quotedSelection,
    )
    const payload = buildQueuedMessageSendPayload(message, buildQuotedSelectionBlock(quotedSelection))

    expect(payload.rawText).toContain('<quoted_file path="/tmp/demo.md">')
    expect(payload.rawText).toContain('被引用的内容')
    expect(payload.rawText).toContain('继续解释 /skill:writer #mcp:docs &session:abc')
    expect(payload.sdkText).toContain('<quoted_file path="/tmp/demo.md">')
    expect(payload.sdkText).toContain('继续解释')
    expect(payload.sdkText).not.toContain('/skill:writer')
    expect(payload.mentions).toEqual({
      cleanedText: '继续解释',
      mentionedSkills: ['writer'],
      mentionedMcpServers: ['docs'],
      mentionedSessionIds: ['abc'],
    })
  })
})
