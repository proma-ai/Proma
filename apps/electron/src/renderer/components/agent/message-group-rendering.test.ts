import { describe, expect, test } from 'bun:test'
import type { AssistantTurn } from '@proma/session-core'
import { stabilizeMessageGroups } from './message-group-rendering'

function assistantTurn(channelId: string): AssistantTurn {
  return {
    type: 'assistant-turn',
    assistantMessages: [],
    turnMessages: [],
    model: 'shared-model',
    channelId,
  }
}

describe('消息分组渲染缓存', () => {
  test('Given 同一模型的渠道身份改变 When 稳定化分组 Then 不复用旧 header', () => {
    const previous = assistantTurn('channel-a')
    const next = assistantTurn('channel-b')

    expect(stabilizeMessageGroups([previous], [next])).toEqual([next])
    expect(stabilizeMessageGroups([previous], [next])[0]).toBe(next)
  })
})
