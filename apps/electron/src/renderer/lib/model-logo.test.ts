import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { getModelLogoById, resolveModelDisplayName, resolveModelProvider } from './model-logo'

const channels = [
  { id: 'channel-a', provider: 'anthropic', models: [{ id: 'shared-model', name: '渠道 A 别名' }] },
  { id: 'channel-b', provider: 'openai', models: [{ id: 'shared-model', name: '渠道 B 别名' }] },
] as unknown as Channel[]

describe('GPT-6 Astra Logo', () => {
  test.each(['gpt-6-astra-1', 'gpt-6-astra-az'])
    ('Given Astra family model %s When resolving Logo Then uses the Astra asset', (modelId) => {
      expect(getModelLogoById(modelId)).toBe(getModelLogoById('gpt-6-astra'))
    })

  test('Given a non-Astra prefix When resolving Logo Then does not use the Astra asset', () => {
    expect(getModelLogoById('gpt-6-astro')).not.toBe(getModelLogoById('gpt-6-astra'))
  })
})

describe('模型渠道解析', () => {
  test('Given 同名模型位于多个渠道 When 提供来源渠道 Then 使用该渠道的别名和 provider', () => {
    expect(resolveModelDisplayName('shared-model', channels, 'channel-b')).toBe('渠道 B 别名')
    expect(resolveModelProvider('shared-model', channels, 'channel-b')).toBe('openai')
  })

  test('Given 同名模型的旧消息没有渠道身份 When 解析 Then 不猜测任一渠道别名', () => {
    expect(resolveModelDisplayName('shared-model', channels)).toBe('shared-model')
    expect(resolveModelProvider('shared-model', channels)).toBe('anthropic')
  })

  test('Given 已删除的消息来源渠道 When 解析 Then 不错误匹配另一渠道', () => {
    expect(resolveModelDisplayName('shared-model', channels, 'channel-removed')).toBe('shared-model')
    expect(resolveModelProvider('shared-model', channels, 'channel-removed')).toBeUndefined()
  })

  test('Given 仅 Agent 模型存在于渠道 When 解析 provider Then 使用 Agent 模型集', () => {
    const agentOnlyChannels = [{
      id: 'proma-agent',
      provider: 'proma',
      models: [],
      agentModels: [{ id: 'agent-only', name: 'Agent 专用模型' }],
    }] as unknown as Channel[]
    expect(resolveModelDisplayName('agent-only', agentOnlyChannels, 'proma-agent', 'agent')).toBe('Agent 专用模型')
    expect(resolveModelProvider('agent-only', agentOnlyChannels, 'proma-agent', 'agent')).toBe('proma')
    expect(resolveModelProvider('agent-only', agentOnlyChannels, 'proma-agent')).toBe('proma')
  })
})
