import { describe, expect, test } from 'bun:test'
import { CODEX_GPT_56_CONTEXT_WINDOW, inferCodexAlignedGPT5ContextWindow } from './context-window'

describe('Codex-aligned context window', () => {
  test.each(['gpt-6-astra', 'gpt-6-astra-1', 'gpt-6-astra-az'])
    ('Given Astra family model %s When inferring context Then returns the GPT-5.6-aligned 372K window', (modelId) => {
      expect(inferCodexAlignedGPT5ContextWindow(modelId)).toBe(CODEX_GPT_56_CONTEXT_WINDOW)
    })

  test('Given a non-Astra prefix When inferring context Then does not assign Astra context', () => {
    expect(inferCodexAlignedGPT5ContextWindow('gpt-6-astro')).toBeUndefined()
  })
})
