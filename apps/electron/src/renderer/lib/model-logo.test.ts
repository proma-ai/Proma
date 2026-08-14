import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { resolveModelDisplayName, resolveModelProvider } from './model-logo'

const channels = [
  { id: 'channel-a', provider: 'anthropic', models: [{ id: 'shared-model', name: '渠道 A 别名' }] },
  { id: 'channel-b', provider: 'openai', models: [{ id: 'shared-model', name: '渠道 B 别名' }] },
] as unknown as Channel[]

describe('模型渠道解析', () => {
  test('Given 同名模型位于多个渠道 When 提供来源渠道 Then 使用该渠道的别名和 provider', () => {
    expect(resolveModelDisplayName('shared-model', channels, 'channel-b')).toBe('渠道 B 别名')
    expect(resolveModelProvider('shared-model', channels, 'channel-b')).toBe('openai')
  })

  test('Given 旧消息没有渠道身份 When 解析 Then 保持既有全渠道 fallback', () => {
    expect(resolveModelDisplayName('shared-model', channels)).toBe('渠道 A 别名')
    expect(resolveModelProvider('shared-model', channels)).toBe('anthropic')
  })

  test('Given 已删除的消息来源渠道 When 解析 Then 不错误匹配另一渠道', () => {
    expect(resolveModelDisplayName('shared-model', channels, 'channel-removed')).toBe('shared-model')
    expect(resolveModelProvider('shared-model', channels, 'channel-removed')).toBeUndefined()
  })
})
