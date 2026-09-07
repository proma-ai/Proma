import { describe, expect, test } from 'bun:test'
import type { ChannelModel } from '@proma/shared'
import { applyOfficialModelEnabledStates, preserveOfficialModelEnabledStates } from './official-channel-models'

const officialModels: ChannelModel[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    enabled: true,
    modelListHint: '日常任务 1×',
    apiProtocol: 'anthropic-messages',
    contextWindow: 1_000_000,
    maxOutputTokens: 640_000,
  },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', enabled: true, apiProtocol: 'anthropic-messages' },
]

describe('applyOfficialModelEnabledStates', () => {
  test('Given a user toggles an existing official model, when applying the update, then preserves server metadata', () => {
    const updated = applyOfficialModelEnabledStates(officialModels, [
      { id: 'deepseek-v4-flash', name: 'tampered display name', enabled: false },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', enabled: true },
    ])

    expect(updated).toEqual([
      { ...officialModels[0]!, enabled: false },
      officialModels[1]!,
    ])
  })

  test('Given an update injects or removes an official model, when applying it, then rejects the mutation', () => {
    expect(() => applyOfficialModelEnabledStates(officialModels, [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: false },
    ])).toThrow('Proma Cloud 渠道的模型目录由 Proma 管理，无法编辑')

    expect(() => applyOfficialModelEnabledStates(officialModels, [
      ...officialModels,
      { id: 'untrusted-model', name: 'Untrusted model', enabled: true },
    ])).toThrow('Proma Cloud 渠道的模型目录由 Proma 管理，无法编辑')
  })
})

describe('preserveOfficialModelEnabledStates', () => {
  test('Given a fresh server catalog, when reconciling it, then only preserves existing enabled flags', () => {
    const freshCatalog: ChannelModel[] = [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true, modelListHint: '更新后的说明' },
      { id: 'new-model', name: 'New Model', enabled: true },
    ]

    expect(preserveOfficialModelEnabledStates(freshCatalog, [
      { id: 'deepseek-v4-flash', name: 'stale local name', enabled: false },
      { id: 'removed-model', name: 'Removed Model', enabled: false },
    ])).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: false, modelListHint: '更新后的说明' },
      { id: 'new-model', name: 'New Model', enabled: true },
    ])
  })
})
