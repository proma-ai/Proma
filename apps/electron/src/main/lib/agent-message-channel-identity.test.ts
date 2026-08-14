import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@proma/shared'
import { withAgentMessageChannelIdentity } from './agent-message-channel-identity'

describe('Agent 消息渠道身份', () => {
  test('Given assistant/result 输出 When 持久化前归档 Then 记录实际渠道且不修改原消息', () => {
    const assistant = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '完成' }] },
      parent_tool_use_id: null,
      _partial: true,
    } as SDKMessage
    const result = { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } } as SDKMessage

    const persistedAssistant = withAgentMessageChannelIdentity(assistant, 'channel-official')
    const persistedResult = withAgentMessageChannelIdentity(result, 'channel-official')

    expect(persistedAssistant).toMatchObject({ _channelId: 'channel-official', _partial: true })
    expect(persistedResult).toMatchObject({ _channelId: 'channel-official' })
    expect(assistant).not.toHaveProperty('_channelId')
  })

  test('Given 已有渠道身份或非输出消息 When 归档 Then 保留原值', () => {
    const existing = {
      type: 'assistant',
      message: { content: [] },
      parent_tool_use_id: null,
      _channelId: 'channel-original',
    } as SDKMessage
    const user = { type: 'user', parent_tool_use_id: null } as SDKMessage

    expect(withAgentMessageChannelIdentity(existing, 'channel-new')).toBe(existing)
    expect(withAgentMessageChannelIdentity(user, 'channel-new')).toBe(user)
  })
})
