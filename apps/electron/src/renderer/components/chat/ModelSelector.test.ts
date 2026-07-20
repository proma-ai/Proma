import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { buildModelOptions } from './ModelSelector'

const channels: Channel[] = [
  {
    id: 'anthropic-channel',
    name: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', enabled: true }],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'custom-channel',
    name: 'Custom',
    provider: 'custom',
    baseUrl: 'https://api.example.com/v2',
    apiKey: '',
    models: [{ id: 'custom-model', name: 'Custom Model', enabled: true }],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('buildModelOptions', () => {
  test('Given an explicit empty Claude whitelist When building options Then show no channels', () => {
    expect(buildModelOptions(channels, undefined, [])).toEqual([])
  })

  test('Given an omitted channel filter When building options Then show all enabled channels', () => {
    expect(buildModelOptions(channels)).toHaveLength(2)
  })
})
