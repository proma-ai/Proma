import { describe, expect, test } from 'bun:test'
import type { AgentStreamPayload, SDKMessage } from '@proma/shared'
import { createInitialState, reduce } from './card-run-state'

function assistantMessage(text: string, partial = false): AgentStreamPayload {
  return {
    kind: 'sdk_message',
    message: {
      type: 'assistant',
      uuid: 'assistant-1',
      message: { content: [{ type: 'text', text }] },
      ...(partial && { _partial: true }),
    } as unknown as SDKMessage,
  }
}

describe('飞书流式卡状态', () => {
  test('将 Pi 累计全文的 partial 预览帧转换为增量，终态不重复追加', () => {
    const initial = createInitialState()

    const afterFirstPreview = reduce(initial, assistantMessage('H', true))
    const afterSecondPreview = reduce(afterFirstPreview, assistantMessage('He', true))
    const afterFinal = reduce(afterSecondPreview, assistantMessage('Hello'))

    expect(afterFirstPreview.blocks).toEqual([{ kind: 'text', content: 'H', streaming: true }])
    expect(afterSecondPreview.blocks).toEqual([{ kind: 'text', content: 'He', streaming: true }])
    expect(afterFinal.blocks).toEqual([{ kind: 'text', content: 'Hello', streaming: true }])
    expect(afterFinal.partialAssistantSnapshots).toEqual({})
  })

  test('合并 Pi partial 与最终工具帧，不重复创建同一个工具面板', () => {
    const toolMessage = (partial: boolean, input: Record<string, unknown>): AgentStreamPayload => ({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        uuid: 'assistant-1',
        message: {
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input }],
        },
        ...(partial && { _partial: true }),
      } as unknown as SDKMessage,
    })

    const afterPreview = reduce(createInitialState(), toolMessage(true, {}))
    const afterFinal = reduce(afterPreview, toolMessage(false, { command: 'ls' }))

    expect(afterFinal.blocks).toEqual([{
      kind: 'tool',
      tool: { id: 'tool-1', name: 'Bash', input: { command: 'ls' }, status: 'running' },
    }])
  })
})
