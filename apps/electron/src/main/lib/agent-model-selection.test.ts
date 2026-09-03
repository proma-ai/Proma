import { describe, expect, test } from 'bun:test'
import { resolveDelegationModelTargetFromChannels } from './agent-model-target'
import type { Channel } from '@proma/shared'

function makeChannel(
  id: string,
  models: Array<{ id: string; enabled: boolean }>,
  enabled = true,
): Channel {
  const now = Date.now()
  return {
    id,
    name: id,
    provider: 'openai' as Channel['provider'],
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    enabled,
    createdAt: now,
    updatedAt: now,
    models: models.map((model) => ({
      id: model.id,
      name: model.id,
      enabled: model.enabled,
      source: 'manual' as const,
    })),
  }
}

const fixtures = (): Channel[] => [
  makeChannel('chA', [
    { id: 'glm-large', enabled: true },
    { id: 'glm-flash', enabled: true },
  ]),
  makeChannel('chB', [{ id: 'k3', enabled: true }]),
  makeChannel('chC', [{ id: 'glm-large', enabled: true }], false),
]

describe('resolveDelegationModelTargetFromChannels', () => {
  test('显式渠道 + 模型：合法组合直接通过', () => {
    const target = resolveDelegationModelTargetFromChannels(
      { channelId: 'chA', modelId: 'glm-large', purpose: '测试' },
      fixtures(),
    )
    expect(target.channelId).toBe('chA')
    expect(target.modelId).toBe('glm-large')
  })

  test('显式渠道 + 模型：模型不属于该渠道时抛错', () => {
    expect(() =>
      resolveDelegationModelTargetFromChannels(
        { channelId: 'chB', modelId: 'glm-large', purpose: '测试' },
        fixtures(),
      ),
    ).toThrow(/不属于当前渠道或未启用/)
  })

  test('仅 modelId：唯一命中时解析到所在渠道', () => {
    const target = resolveDelegationModelTargetFromChannels(
      { modelId: 'k3', purpose: '测试' },
      fixtures(),
    )
    expect(target.channelId).toBe('chB')
    expect(target.modelId).toBe('k3')
  })

  test('仅 modelId：多渠道命中时要求消歧（禁用渠道不参与）', () => {
    // glm-large 存在于 chA（启用）与 chC（禁用）：禁用渠道不参与解析，chA 唯一命中
    const target = resolveDelegationModelTargetFromChannels(
      { modelId: 'glm-large', purpose: '测试' },
      fixtures(),
    )
    expect(target.channelId).toBe('chA')

    // chD 也启用 glm-large 时命中多个渠道，要求消歧
    const channels = [...fixtures(), makeChannel('chD', [{ id: 'glm-large', enabled: true }])]
    expect(() =>
      resolveDelegationModelTargetFromChannels({ modelId: 'glm-large', purpose: '测试' }, channels),
    ).toThrow(/消歧/)
  })

  test('仅 modelId：所有渠道均无此模型时抛错', () => {
    expect(() =>
      resolveDelegationModelTargetFromChannels(
        { modelId: 'no-such-model', purpose: '测试' },
        fixtures(),
      ),
    ).toThrow(/均不存在或未启用/)
  })

  test('仅 channelId：使用该渠道第一个启用模型', () => {
    const target = resolveDelegationModelTargetFromChannels(
      { channelId: 'chB', purpose: '测试' },
      fixtures(),
    )
    expect(target.channelId).toBe('chB')
    expect(target.modelId).toBe('k3')
  })

  test('仅 channelId：渠道内没有启用模型时抛错', () => {
    const channels = [...fixtures(), makeChannel('chEmpty', [{ id: 'm1', enabled: false }])]
    expect(() =>
      resolveDelegationModelTargetFromChannels({ channelId: 'chEmpty', purpose: '测试' }, channels),
    ).toThrow(/没有已启用的模型/)
  })

  test('都不传：回退父会话渠道与模型', () => {
    const target = resolveDelegationModelTargetFromChannels(
      { fallbackChannelId: 'chA', fallbackModelId: 'glm-flash', purpose: '测试' },
      fixtures(),
    )
    expect(target.channelId).toBe('chA')
    expect(target.modelId).toBe('glm-flash')
  })

  test('回退：父会话模型已失效时抛错', () => {
    expect(() =>
      resolveDelegationModelTargetFromChannels(
        { fallbackChannelId: 'chA', fallbackModelId: 'no-such-model', purpose: '测试' },
        fixtures(),
      ),
    ).toThrow(/不属于当前渠道或未启用/)
  })
})
