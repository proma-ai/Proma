import { describe, expect, test } from 'bun:test'
import { injectCodexFastMode } from './pi-codex-fast-mode'

describe('Pi Codex Fast Mode', () => {
  test.each(['gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    'Given supported %s When injecting Then requests priority tier',
    (model) => {
      expect(injectCodexFastMode({ model })).toEqual({ model, service_tier: 'priority' })
    },
  )

  test('Given unsupported model When injecting Then leaves payload unchanged', () => {
    const payload = { model: 'gpt-5.4-mini' }
    expect(injectCodexFastMode(payload)).toBe(payload)
  })

  test('Given existing service tier When injecting Then respects prior value', () => {
    const payload = { model: 'gpt-5.6-terra', service_tier: 'flex' }
    expect(injectCodexFastMode(payload)).toBe(payload)
  })

  test('Given non-object payload When injecting Then leaves payload unchanged', () => {
    expect(injectCodexFastMode('not-a-request')).toBe('not-a-request')
  })
})
