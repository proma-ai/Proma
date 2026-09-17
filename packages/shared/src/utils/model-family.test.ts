import { describe, expect, test } from 'bun:test'
import { getPromaOfficialClaudeCapabilityFamily, isGpt6AstraFamily } from './model-family'

describe('GPT-6 Astra model family', () => {
  test.each([
    'gpt-6-astra',
    'gpt-6-astra-1',
    'gpt-6-astra-az',
    'gpt-6-astra-2026-09',
    'GPT-6-ASTRA-AZ',
    'gpt-6-astra-az[1m]',
  ])('Given valid Astra family model %s When checking Then returns true', (modelId) => {
    expect(isGpt6AstraFamily(modelId)).toBe(true)
  })

  test.each(['gpt-6-astral', 'gpt-6-astrafoo', 'gpt-6-astra_', 'gpt-6-astra-', 'gpt-6-astro', 'gpt-5.6-astra', undefined])
    ('Given non-Astra model %s When checking Then returns false', (modelId) => {
      expect(isGpt6AstraFamily(modelId)).toBe(false)
    })
})

describe('Proma official Claude capability families', () => {
  test.each([
    ['claude-opus-5', 'claude-opus-5'],
    ['claude-opus-5-1', 'claude-opus-5'],
    ['claude-opus-5-12', 'claude-opus-5'],
    ['claude-opus-4-8-1', 'claude-opus-4-8'],
    ['claude-sonnet-5-1', 'claude-sonnet-5'],
    ['CLAUDE-SONNET-5-9[1m]', 'claude-sonnet-5'],
  ] as const)('recognizes %s as %s', (modelId, expected) => {
    expect(getPromaOfficialClaudeCapabilityFamily(modelId)).toBe(expected)
  })

  test.each([
    'claude-fable-5-1',
    'claude-opus-5-latest',
    'claude-opus-50-1',
    'claude-sonnet-5-1-beta',
    'gpt-5.6-terra-2',
    undefined,
  ])('does not infer an official capability family for %s', (modelId) => {
    expect(getPromaOfficialClaudeCapabilityFamily(modelId)).toBeUndefined()
  })
})
