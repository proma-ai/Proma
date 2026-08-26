import { describe, expect, test } from 'bun:test'
import {
  addChannelReasoningLevel,
  createReasoningCapabilityKey,
  createChannelReasoningConfig,
  removeChannelReasoningLevel,
  resolveConversationReasoningCapability,
  resolveConversationRequestReasoningLevel,
  updateChannelReasoningEffort,
} from './channel-model-reasoning'

describe('频道模型自定义推理档位', () => {
  test('开启配置时不预置任何推理档位', () => {
    expect(createChannelReasoningConfig()).toEqual({
      levels: [],
      defaultLevel: 'high',
      thinkingLevelMap: {},
    })
  })

  test('添加首个档位时将它设为默认档位', () => {
    expect(addChannelReasoningLevel(createChannelReasoningConfig(), 'minimal')).toMatchObject({
      levels: ['minimal'],
      defaultLevel: 'minimal',
    })
  })

  test('删除默认档位时选择剩余首档并移除对应线上映射', () => {
    expect(removeChannelReasoningLevel({
      levels: ['low', 'high'],
      defaultLevel: 'low',
      thinkingLevelMap: { low: 'light', high: 'deep' },
    }, 'low')).toEqual({
      levels: ['high'],
      defaultLevel: 'high',
      thinkingLevelMap: { high: 'deep' },
    })
  })

  test('允许为每个档位设置和清除自定义线上 effort', () => {
    const configured = updateChannelReasoningEffort({
      levels: ['off'],
      defaultLevel: 'off',
      thinkingLevelMap: {},
    }, 'off', 'none')
    expect(configured.thinkingLevelMap).toEqual({ off: 'none' })
    expect(updateChannelReasoningEffort(configured, 'off', '  ').thinkingLevelMap).toEqual({})
  })

  test('同一模型的推理配置变化时生成不同 capability 缓存键', () => {
    const base = { channelId: 'channel-a', modelId: 'custom-model', channelUpdatedAt: 1 }
    expect(createReasoningCapabilityKey({
      ...base,
      reasoning: { levels: ['low'], defaultLevel: 'low' },
    })).not.toBe(createReasoningCapabilityKey({
      ...base,
      reasoning: { levels: ['low', 'high'], defaultLevel: 'high' },
    }))
  })

  test('IPC 尚未返回能力时直接使用频道模型声明', () => {
    expect(resolveConversationReasoningCapability({
      channelReasoning: { levels: ['low', 'high'], defaultLevel: 'high' },
    })).toEqual({
      source: 'channel',
      levels: ['low', 'high'],
      defaultLevel: 'high',
    })
  })

  test('内置 profile 仍优先于频道声明和远端目录', () => {
    expect(resolveConversationReasoningCapability({
      profile: { source: 'profile', levels: ['off', 'high'], defaultLevel: 'high' },
      channelReasoning: { levels: ['low'], defaultLevel: 'low' },
      remote: { source: 'pi-catalog', levels: ['medium'], defaultLevel: 'medium' },
    })?.source).toBe('profile')
  })

  test('Chat 开启思考时使用当前会话档位，缺省使用模型默认档位', () => {
    const config = { levels: ['off', 'low', 'high'] as const, defaultLevel: 'high' as const }
    expect(resolveConversationRequestReasoningLevel({ config: { ...config, levels: [...config.levels] }, selectedLevel: 'low', enabled: true })).toBe('low')
    expect(resolveConversationRequestReasoningLevel({ config: { ...config, levels: [...config.levels] }, enabled: true })).toBe('high')
  })

  test('Chat 关闭思考时仅在模型声明 off 时发送关闭档位', () => {
    expect(resolveConversationRequestReasoningLevel({
      config: { levels: ['off', 'high'], defaultLevel: 'high' },
      enabled: false,
    })).toBe('off')
    expect(resolveConversationRequestReasoningLevel({
      config: { levels: ['low', 'high'], defaultLevel: 'high' },
      enabled: false,
    })).toBeUndefined()
  })
})