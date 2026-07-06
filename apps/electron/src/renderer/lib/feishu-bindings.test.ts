import { describe, expect, test } from 'bun:test'
import type { FeishuChatBinding } from '@proma/shared'
import { filterFeishuBindings, groupFeishuBindings } from './feishu-bindings'

function makeBinding(
  chatId: string,
  extra: Partial<FeishuChatBinding> = {},
): FeishuChatBinding {
  return {
    chatId,
    botId: 'bot-1',
    userId: 'user-1',
    sessionId: `session-${chatId}`,
    workspaceId: 'workspace-1',
    channelId: 'channel-1',
    source: 'feishu',
    chatType: 'p2p',
    createdAt: 1,
    ...extra,
  }
}

describe('filterFeishuBindings', () => {
  test('Given 活跃和已归档绑定 When 查看活跃视图 Then 只返回未归档绑定', () => {
    const result = filterFeishuBindings([
      makeBinding('active'),
      makeBinding('archived', { archived: true, archivedAt: 9 }),
    ], {
      viewMode: 'active',
      chatType: 'all',
      source: 'all',
      query: '',
    })

    expect(result.map((binding) => binding.chatId)).toEqual(['active'])
  })

  test('Given 绑定有最近使用时间 When 筛选 Then 按 lastUsedAt 优先降序排列', () => {
    const result = filterFeishuBindings([
      makeBinding('old', { createdAt: 10 }),
      makeBinding('recent', { createdAt: 1, lastUsedAt: 30 }),
      makeBinding('middle', { createdAt: 20 }),
    ], {
      viewMode: 'active',
      chatType: 'all',
      source: 'all',
      query: '',
    })

    expect(result.map((binding) => binding.chatId)).toEqual(['recent', 'middle', 'old'])
  })

  test('Given 已归档群聊绑定 When 在归档视图搜索群名 Then 返回匹配绑定', () => {
    const result = filterFeishuBindings([
      makeBinding('chat-a', { archived: true, chatType: 'group', groupName: '研发群' }),
      makeBinding('chat-b', { archived: true, chatType: 'group', groupName: '设计群' }),
    ], {
      viewMode: 'archived',
      chatType: 'group',
      source: 'all',
      query: '研发',
    })

    expect(result.map((binding) => binding.chatId)).toEqual(['chat-a'])
  })
})

describe('groupFeishuBindings', () => {
  test('Given 群聊和单聊绑定 When 分组 Then 分别进入群聊和单聊列表', () => {
    const result = groupFeishuBindings([
      makeBinding('group', { chatType: 'group' }),
      makeBinding('p2p', { chatType: 'p2p' }),
    ])

    expect(result.groupBindings.map((binding) => binding.chatId)).toEqual(['group'])
    expect(result.p2pBindings.map((binding) => binding.chatId)).toEqual(['p2p'])
  })
})
