import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { getContextCompactionProgress, isCompactionControlHistoryGroup } from './AgentMessages'
import { shouldClearRetainedCompactionForResumedStream, shouldRestoreCompactionProgress } from './TaskProgressOverlay'

function systemMessage(fields: Record<string, unknown>): SDKMessage {
  return { type: 'system', ...fields } as unknown as SDKMessage
}

function assistantMessage(): SDKMessage {
  return { type: 'assistant', message: { content: [] } } as unknown as SDKMessage
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
      message: { type: 'user', message: { content: [{ type: 'text', text: '继续处理当前任务' }] } },
    } as never)).toBe(false)
  })


  test('shows a running state before the SDK emits a compacting message', () => {
    expect(getContextCompactionProgress([], true, undefined)).toMatchObject({
      status: 'running',
      label: '正在整理上下文',
    })
  })

  test('retains a no-op terminal state after live messages are cleared', () => {
    expect(getContextCompactionProgress([], false, {
      status: 'noop',
      message: '当前上下文较小，暂时无需压缩。',
    })).toMatchObject({
      status: 'noop',
      label: '当前上下文无需压缩',
    })
  })

  test('does not restore an already dismissed success or no-op feedback state', () => {
    expect(shouldRestoreCompactionProgress('success:上下文已压缩::', 'success:上下文已压缩::')).toBe(false)
    expect(shouldRestoreCompactionProgress('noop:当前上下文无需压缩::', 'noop:当前上下文无需压缩::')).toBe(false)
    expect(shouldRestoreCompactionProgress('running:正在整理上下文::', 'noop:当前上下文无需压缩::')).toBe(true)
  })

  test('clears retained compaction feedback when the same stream resumes normal work', () => {
    const completed = { status: 'success' as const, label: '上下文已压缩' }

    expect(shouldClearRetainedCompactionForResumedStream(true, undefined, completed)).toBe(true)
    expect(shouldClearRetainedCompactionForResumedStream(false, undefined, completed)).toBe(false)
    expect(shouldClearRetainedCompactionForResumedStream(true, completed, completed)).toBe(false)
    expect(shouldClearRetainedCompactionForResumedStream(true, undefined, undefined)).toBe(false)
  })

  test('maps successful compaction to a terminal state', () => {
    expect(getContextCompactionProgress([
      systemMessage({ subtype: 'compact_boundary', summary: '已完成的工作已整理。' }),
    ], false, undefined)).toMatchObject({
      status: 'success',
      label: '上下文已压缩',
      summary: '已完成的工作已整理。',
    })
  })

  test('does not revive an old compaction boundary after Pi continues with assistant or task work', () => {
    const compactionBoundary = systemMessage({ subtype: 'compact_boundary', summary: '已完成的工作已整理。' })

    expect(getContextCompactionProgress([
      compactionBoundary,
      assistantMessage(),
    ], false, { status: 'success' })).toBeUndefined()
    expect(getContextCompactionProgress([
      compactionBoundary,
      systemMessage({ subtype: 'task_started', task_id: 'continued-task' }),
    ], false, { status: 'success' })).toBeUndefined()
  })

  test('maps a no-op result to a clear terminal state', () => {
    expect(getContextCompactionProgress([
      systemMessage({
        subtype: 'status',
        compact_result: 'noop',
        message: '当前上下文较小，暂时无需压缩。',
      }),
    ], false, undefined)).toMatchObject({
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
    ], false, undefined)).toMatchObject({
      status: 'failed',
      detail: 'provider unavailable',
    })
  })
})
