import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import {
  initializeBindingModelSelection,
  resolveFeishuRunTarget,
  resolveSessionMirrorModelSelection,
} from './model-binding'

function makeChannel(
  id: string,
  modelId: string,
  enabled = true,
  modelEnabled = true,
): Channel {
  return {
    id,
    name: id,
    provider: 'deepseek',
    baseUrl: 'https://api.example.com',
    apiKey: 'encrypted',
    enabled,
    models: [{ id: modelId, name: modelId, enabled: modelEnabled }],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('飞书模型绑定初始化', () => {
  test('Given 已有聊天绑定 When Bridge 重启加载 Then 保留原渠道和模型', () => {
    const result = initializeBindingModelSelection(
      { channelId: 'binding-channel', modelId: 'binding-model' },
      { channelId: 'bot-channel', modelId: 'bot-model' },
      { channelId: 'global-channel', modelId: 'global-model' },
    )

    expect(result).toEqual({
      channelId: 'binding-channel',
      modelId: 'binding-model',
    })
  })

  test('Given 绑定字段为空 When Bridge 重启加载 Then 只用 Bot 或全局默认补空值', () => {
    expect(initializeBindingModelSelection(
      { channelId: '', modelId: undefined },
      { channelId: 'bot-channel', modelId: undefined },
      { channelId: 'global-channel', modelId: 'global-model' },
    )).toEqual({
      channelId: 'bot-channel',
      modelId: 'global-model',
    })
  })
})

describe('飞书 Session 镜像模型绑定', () => {
  test('Given 桌面会话有独立渠道和模型 When 创建镜像 Then 成对使用会话值', () => {
    expect(resolveSessionMirrorModelSelection({
      channelId: 'session-channel',
      modelId: 'session-model',
    })).toEqual({
      channelId: 'session-channel',
      modelId: 'session-model',
    })
  })

  test('Given 桌面会话缺少模型 When 创建镜像 Then 不混入全局模型', () => {
    expect(resolveSessionMirrorModelSelection({
      channelId: 'session-channel',
    })).toEqual({
      channelId: 'session-channel',
      modelId: undefined,
    })
  })
})

describe('飞书发送模型解析', () => {
  const bindingChannel = makeChannel('binding-channel', 'binding-model')
  const botChannel = makeChannel('bot-channel', 'bot-model')
  const globalChannel = makeChannel('global-channel', 'global-model')

  test('Given 三级来源都有效 When 发送消息 Then 优先使用聊天绑定', () => {
    expect(resolveFeishuRunTarget({
      binding: { channelId: bindingChannel.id, modelId: 'binding-model' },
      botDefaults: { channelId: botChannel.id, modelId: 'bot-model' },
      globalDefaults: { channelId: globalChannel.id, modelId: 'global-model' },
      channels: [bindingChannel, botChannel, globalChannel],
    })).toEqual({
      channelId: bindingChannel.id,
      modelId: 'binding-model',
      source: 'binding',
    })
  })

  test('Given 绑定渠道已停用 When 发送消息 Then 回落到 Bot 默认并返回实际来源', () => {
    expect(resolveFeishuRunTarget({
      binding: { channelId: 'disabled-channel', modelId: 'disabled-model' },
      botDefaults: { channelId: botChannel.id, modelId: 'bot-model' },
      globalDefaults: { channelId: globalChannel.id, modelId: 'global-model' },
      channels: [makeChannel('disabled-channel', 'disabled-model', false), botChannel, globalChannel],
    })).toEqual({
      channelId: botChannel.id,
      modelId: 'bot-model',
      source: 'bot-default',
    })
  })

  test('Given 旧绑定只有渠道 When 发送消息 Then 保留该渠道并选首个启用模型', () => {
    expect(resolveFeishuRunTarget({
      binding: { channelId: bindingChannel.id, modelId: undefined },
      botDefaults: { channelId: botChannel.id, modelId: 'bot-model' },
      globalDefaults: { channelId: globalChannel.id, modelId: 'global-model' },
      channels: [bindingChannel, botChannel, globalChannel],
    })).toEqual({
      channelId: bindingChannel.id,
      modelId: 'binding-model',
      source: 'binding',
    })
  })

  test('Given 绑定和 Bot 模型均不存在 When 发送消息 Then 回落到全局默认', () => {
    expect(resolveFeishuRunTarget({
      binding: { channelId: bindingChannel.id, modelId: 'missing-binding-model' },
      botDefaults: { channelId: botChannel.id, modelId: 'missing-bot-model' },
      globalDefaults: { channelId: globalChannel.id, modelId: 'global-model' },
      channels: [bindingChannel, botChannel, globalChannel],
    })).toEqual({
      channelId: globalChannel.id,
      modelId: 'global-model',
      source: 'global-default',
    })
  })

  test('Given 所有来源都不可用 When 发送消息 Then 给出清晰错误', () => {
    expect(() => resolveFeishuRunTarget({
      binding: { channelId: 'missing-channel', modelId: 'missing-model' },
      botDefaults: {},
      globalDefaults: {},
      channels: [],
    })).toThrow('没有可用的渠道/模型')
  })
})
