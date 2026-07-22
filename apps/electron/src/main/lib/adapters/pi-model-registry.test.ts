import { describe, expect, test } from 'bun:test'
import {
  getCodexAlignedGPT5Capabilities,
} from './pi-model-registry'

describe('third-party GPT-5 capability extrapolation', () => {
  test.each([
    ['gpt-5.4', 272_000, { xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.4-mini', 400_000, { xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.5', 272_000, { xhigh: 'xhigh', minimal: 'low' }],
    ['gpt-5.6-sol', 372_000, { xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-terra', 372_000, { xhigh: 'xhigh', minimal: 'low', max: 'max' }],
    ['gpt-5.6-luna', 372_000, { xhigh: 'xhigh', minimal: 'low', max: 'max' }],
  ])('Given third-party %s When resolving capabilities Then aligns with Codex', (modelId, contextWindow, thinkingLevelMap) => {
    expect(getCodexAlignedGPT5Capabilities(modelId)).toEqual({ contextWindow, thinkingLevelMap })
  })

  test('Given a Codex-unmarked GPT-5 SKU When resolving capabilities Then preserves catalog ownership', () => {
    expect(getCodexAlignedGPT5Capabilities('gpt-5.4-pro')).toBeUndefined()
    expect(getCodexAlignedGPT5Capabilities('gpt-5.5-pro')).toBeUndefined()
  })
})
