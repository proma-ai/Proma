import { describe, expect, test } from 'bun:test'
import { isGpt6AstraFamily } from './model-family'

describe('GPT-6 Astra model family', () => {
  test.each([
    'gpt-6-astra',
    'gpt-6-astra-1',
    'gpt-6-astra-az',
    'GPT-6-ASTRA-AZ',
    'gpt-6-astra-az[1m]',
  ])('Given %s When checking the Astra family Then returns true', (modelId) => {
    expect(isGpt6AstraFamily(modelId)).toBe(true)
  })

  test.each([
    'gpt-6-astral',
    'gpt-6-astrafoo',
    'gpt-6-astra_',
    'gpt-6-astra-',
    'gpt-5.6-astra',
    undefined,
  ])('Given %s When checking the Astra family Then returns false', (modelId) => {
    expect(isGpt6AstraFamily(modelId)).toBe(false)
  })
})
