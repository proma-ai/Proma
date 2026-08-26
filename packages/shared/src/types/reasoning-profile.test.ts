import { describe, expect, test } from 'bun:test'
import { resolveChannelReasoningCapability, resolveChannelReasoningEffort } from './reasoning-profile'

describe('频道模型推理能力声明', () => {
  test('给定有效档位时，返回供会话滑杆使用的频道能力', () => {
    expect(resolveChannelReasoningCapability({
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
      thinkingLevelMap: { off: 'none' },
    })).toEqual({
      source: 'channel',
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
    })
  })

  test('默认档位不在可选档位中时，忽略无效声明', () => {
    expect(resolveChannelReasoningCapability({
      levels: ['off', 'low'],
      defaultLevel: 'high',
    })).toBeUndefined()
  })

  test('将会话档位解析为频道声明的线上 effort', () => {
    const config = {
      levels: ['off', 'low', 'high'] as const,
      defaultLevel: 'high' as const,
      thinkingLevelMap: { off: 'none', low: 'light', high: null },
    }
    expect(resolveChannelReasoningEffort({ ...config, levels: [...config.levels] }, 'off')).toBe('none')
    expect(resolveChannelReasoningEffort({ ...config, levels: [...config.levels] }, 'low')).toBe('light')
    expect(resolveChannelReasoningEffort({ ...config, levels: [...config.levels] }, 'high')).toBeNull()
  })

  test('未配置映射时原样发送档位名称', () => {
    expect(resolveChannelReasoningEffort({ levels: ['medium'], defaultLevel: 'medium' }, 'medium')).toBe('medium')
  })
})