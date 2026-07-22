import { describe, expect, test } from 'bun:test'
import { buildAgentStreamCompletePayload } from './agent-completion-payload'

describe('Agent 完成载荷来源', () => {
  test('Given 委派子会话 When 构建完成载荷 Then 保留 delegation 来源', () => {
    expect(
      buildAgentStreamCompletePayload(
        { sessionId: 'child-1', triggeredBy: 'delegation' },
        { stoppedByUser: false, startedAt: 100 },
      ),
    ).toEqual({
      sessionId: 'child-1',
      triggeredBy: 'delegation',
      stoppedByUser: false,
      startedAt: 100,
    })
  })

  test('Given 普通历史调用未提供来源 When 构建完成载荷 Then 保持字段可选', () => {
    expect(
      buildAgentStreamCompletePayload(
        { sessionId: 'parent-1' },
        { messages: [] },
      ),
    ).toEqual({
      sessionId: 'parent-1',
      triggeredBy: undefined,
      messages: [],
    })
  })
})
