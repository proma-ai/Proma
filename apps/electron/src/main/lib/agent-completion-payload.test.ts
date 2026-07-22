import { describe, expect, test } from 'bun:test'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import type { AgentStreamCompletePayload } from '@proma/shared'
import {
  buildAgentStreamCompletePayload,
  sendAgentStreamComplete,
} from './agent-completion-payload'

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

describe('Agent 完成 IPC sender', () => {
  function createTarget(): {
    sent: Array<{ channel: string; payload: AgentStreamCompletePayload }>
    target: { send: (channel: string, payload: AgentStreamCompletePayload) => void }
  } {
    const sent: Array<{ channel: string; payload: AgentStreamCompletePayload }> = []
    return {
      sent,
      target: {
        send: (channel, payload) => { sent.push({ channel, payload }) },
      },
    }
  }

  test('Given 委派正常完成 When 发送完成 IPC Then 使用正确 channel 并保留 delegation 来源', () => {
    const { sent, target } = createTarget()

    sendAgentStreamComplete(
      target,
      { sessionId: 'child-normal', triggeredBy: 'delegation' },
      { messages: [], stoppedByUser: false },
    )

    expect(sent).toEqual([{
      channel: AGENT_IPC_CHANNELS.STREAM_COMPLETE,
      payload: {
        sessionId: 'child-normal',
        triggeredBy: 'delegation',
        messages: [],
        stoppedByUser: false,
      },
    }])
  })

  test('Given 委派 defensive/catch 完成 When 发送完成 IPC Then 仍保留 delegation 来源', () => {
    const { sent, target } = createTarget()

    sendAgentStreamComplete(
      target,
      { sessionId: 'child-catch', triggeredBy: 'delegation' },
      { messages: [], stoppedByUser: false, startedAt: 100 },
    )

    expect(sent[0]?.channel).toBe(AGENT_IPC_CHANNELS.STREAM_COMPLETE)
    expect(sent[0]?.payload.triggeredBy).toBe('delegation')
  })

  test('Given 历史调用未提供来源 When 发送完成 IPC Then undefined 来源保持兼容', () => {
    const { sent, target } = createTarget()

    sendAgentStreamComplete(target, { sessionId: 'parent-legacy' }, { messages: [] })

    expect(sent[0]?.payload).toEqual({
      sessionId: 'parent-legacy',
      triggeredBy: undefined,
      messages: [],
    })
  })
})
