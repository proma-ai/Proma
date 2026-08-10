import { describe, expect, test } from 'bun:test'
import { resolveAgentSessionModelSelection } from './agent-session-model-selection'

describe('Agent 会话模型选择', () => {
  test('Given 已有 Codex 会话 When 打开会话 Then 使用会话绑定且不改变全局默认', () => {
    const globalDefaults = {
      channelId: 'global-channel',
      modelId: 'global-model',
    }

    const selection = resolveAgentSessionModelSelection({
      hasSessionMeta: true,
      sessionChannelId: 'codex-channel',
      sessionModelId: 'gpt-5.6-codex',
      cachedChannelId: undefined,
      cachedModelId: undefined,
      defaultChannelId: globalDefaults.channelId,
      defaultModelId: globalDefaults.modelId,
    })

    expect(selection).toEqual({
      channelId: 'codex-channel',
      modelId: 'gpt-5.6-codex',
    })
    expect(globalDefaults).toEqual({
      channelId: 'global-channel',
      modelId: 'global-model',
    })
  })

  test('Given 已有会话只有渠道 When 打开会话 Then 不拼入另一渠道的全局模型', () => {
    expect(resolveAgentSessionModelSelection({
      hasSessionMeta: true,
      sessionChannelId: 'session-channel',
      sessionModelId: undefined,
      cachedChannelId: undefined,
      cachedModelId: undefined,
      defaultChannelId: 'global-channel',
      defaultModelId: 'global-model',
    })).toEqual({
      channelId: 'session-channel',
      modelId: undefined,
    })
  })

  test('Given 新会话尚无元数据 When 初始化 Then 成对继承全局默认', () => {
    expect(resolveAgentSessionModelSelection({
      hasSessionMeta: false,
      sessionChannelId: undefined,
      sessionModelId: undefined,
      cachedChannelId: undefined,
      cachedModelId: undefined,
      defaultChannelId: 'global-channel',
      defaultModelId: 'global-model',
    })).toEqual({
      channelId: 'global-channel',
      modelId: 'global-model',
    })
  })
})
