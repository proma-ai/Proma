import { describe, expect, test } from 'bun:test'
import type { FeishuChatBinding } from '@proma/shared'
import { restorePersistedFeishuBinding } from './binding-restore'

function createBinding(overrides: Partial<FeishuChatBinding> = {}): FeishuChatBinding {
  return {
    chatId: 'chat-sales-coach-rc',
    botId: 'bot-1',
    userId: 'user-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    channelId: 'sales-coach-crm-gateway-v1',
    modelId: 'deepseek-v4-flash-vision-exp',
    source: 'feishu',
    createdAt: 1,
    ...overrides,
  }
}

describe('restorePersistedFeishuBinding', () => {
  test('Given 聊天已用 /model 写入独立路由 When Bridge 重启 Then 不被全局默认覆盖', () => {
    const binding = createBinding()

    const restored = restorePersistedFeishuBinding(
      binding,
      { archived: false, updatedAt: 2 },
      { channelId: 'global-source-channel', modelId: 'global-default-model' },
    )

    expect(restored.channelId).toBe('sales-coach-crm-gateway-v1')
    expect(restored.modelId).toBe('deepseek-v4-flash-vision-exp')
    expect(binding).toEqual(createBinding())
  })

  test('Given 旧绑定缺少路由字段 When Bridge 重启 Then 只补齐默认渠道和模型', () => {
    const restored = restorePersistedFeishuBinding(
      createBinding({ channelId: '', modelId: undefined }),
      { archived: false, updatedAt: 2 },
      { channelId: 'bot-default-channel', modelId: 'bot-default-model' },
    )

    expect(restored.channelId).toBe('bot-default-channel')
    expect(restored.modelId).toBe('bot-default-model')
  })

  test('Given 镜像会话已归档 When Bridge 重启 Then 保留路由并同步归档状态', () => {
    const restored = restorePersistedFeishuBinding(
      createBinding({ source: 'session-mirror' }),
      { archived: true, updatedAt: 42 },
      { channelId: 'global-source-channel', modelId: 'global-default-model' },
    )

    expect(restored).toMatchObject({
      channelId: 'sales-coach-crm-gateway-v1',
      modelId: 'deepseek-v4-flash-vision-exp',
      archived: true,
      archivedAt: 42,
    })
  })
})
