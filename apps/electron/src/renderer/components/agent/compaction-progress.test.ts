import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { getContextCompactionProgress, isCompactionControlHistoryGroup } from './AgentMessages'

function systemMessage(fields: Record<string, unknown>): SDKMessage {
  return { type: 'system', ...fields } as unknown as SDKMessage
}

describe('context compaction progress overlay state', () => {
  test('hides /compact control messages from conversation history', () => {
    expect(isCompactionControlHistoryGroup({
      type: 'user',
      message: { type: 'user', message: { content: [{ type: 'text', text: '/compact' }] } },
    } as never)).toBe(true)
    expect(isCompactionControlHistoryGroup({
      type: 'system',
      message: { type: 'system', subtype: 'compact_boundary' },
    } as never)).toBe(true)
    expect(isCompactionControlHistoryGroup({
      type: 'user',
      message: { type: 'user', message: { content: [{ type: 'text', text: '继续任务' }] } },
    } as never)).toBe(false)
  })


  test('shows a running state before the SDK emits a compacting message', () => {
    expect(getContextCompactionProgress([], true)).toMatchObject({
      status: 'running',
      label: '正在整理上下文',
    })
  })

  test('maps successful compaction to a continue-ready state', () => {
    expect(getContextCompactionProgress([
      systemMessage({ subtype: 'compact_boundary', summary: '已完成的工作已整理。' }),
    ], false)).toMatchObject({
      status: 'success',
      label: '上下文已压缩',
      summary: '已完成的工作已整理。',
    })
  })

  test('maps a no-op result to a clear terminal state', () => {
    expect(getContextCompactionProgress([
      systemMessage({
        subtype: 'status',
        compact_result: 'noop',
        message: '当前上下文较小，暂时无需压缩。',
      }),
    ], false)).toMatchObject({
      status: 'noop',
      label: '当前上下文无需压缩',
    })
  })

  test('keeps compaction failures visible with their error details', () => {
    expect(getContextCompactionProgress([
      systemMessage({
        subtype: 'status',
        compact_result: 'failed',
        compact_error: 'provider unavailable',
      }),
    ], false)).toMatchObject({
      status: 'failed',
      detail: 'provider unavailable',
    })
  })
})
