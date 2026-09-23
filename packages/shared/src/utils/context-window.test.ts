import { describe, expect, test } from 'bun:test'
import {
  CODEX_GPT_56_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  inferContextWindow,
  inferCodexAlignedGPT5ContextWindow,
  isMimoV26Model,
  ONE_MILLION_CONTEXT_WINDOW,
  supports1MContext,
} from './context-window'

describe('Codex-aligned context window', () => {
  test.each(['gpt-6-astra', 'gpt-6-astra-1', 'gpt-6-astra-az'])
    ('Given Astra family model %s When inferring context Then returns the GPT-5.6-aligned 372K window', (modelId) => {
      expect(inferCodexAlignedGPT5ContextWindow(modelId)).toBe(CODEX_GPT_56_CONTEXT_WINDOW)
    })

  test('Given GLM-5.3-FlashX When inferring context Then returns the 1M window', () => {
    expect(inferContextWindow('glm-5.3-flashx')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })

  test('Given a non-Astra prefix When inferring context Then does not assign Astra context', () => {
    expect(inferCodexAlignedGPT5ContextWindow('gpt-6-astro')).toBeUndefined()
  })
})

describe('MiMo-V2.6 context window', () => {
  test.each(['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed', ' MiMo-V2.6-FLASH '])
    ('Given canonical MiMo V2.6 model %s When inferring context Then returns the 1M window', (modelId) => {
      expect(isMimoV26Model(modelId)).toBe(true)
      expect(supports1MContext(modelId)).toBe(true)
      expect(inferContextWindow(modelId)).toBe(ONE_MILLION_CONTEXT_WINDOW)
    })

  test.each(['mimo-v2.60-pro', 'mimo-v2.6-prototype', 'mimo-v2.6-pro-ultraspeed-v2'])
    ('Given non-canonical MiMo model %s When inferring context Then does not use the V2.6 fallback', (modelId) => {
      expect(isMimoV26Model(modelId)).toBe(false)
      expect(supports1MContext(modelId)).toBe(false)
      expect(inferContextWindow(modelId)).toBe(DEFAULT_CONTEXT_WINDOW)
    })
})
