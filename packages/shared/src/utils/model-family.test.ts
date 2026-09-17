import { describe, expect, test } from 'bun:test'
import { isGpt6AstraFamily, resolvePromaOfficialModelCapabilityId } from './model-family'

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

describe('Proma official discount model capabilities', () => {
  test.each([
    ['claude-opus-5-1', 'claude-opus-5'],
    ['claude-opus-4-8-1', 'claude-opus-4-8'],
    ['claude-sonnet-5-1', 'claude-sonnet-5'],
    ['claude-fable-5-1', 'claude-fable-5-1'],
    ['gpt-5.6-terra-2', 'gpt-5.6-terra-2'],
  ])('resolves %s to the capability baseline %s', (modelId, expected) => {
    expect(resolvePromaOfficialModelCapabilityId(modelId)).toBe(expected)
  })
})
