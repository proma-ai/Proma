import { describe, expect, test } from 'bun:test'
import { getPromaCloudRecoveryAction } from './proma-cloud-recovery'

describe('Proma Cloud recovery action', () => {
  test.each([
    ['openai', 'invalid_api_key'],
    ['openai-codex', 'expired_oauth_token'],
    ['xai', 'token_expired'],
  ] as const)('Given third-party %s preflight failure %s When building recovery Then offers Proma Cloud retry', (provider, errorCode) => {
    expect(getPromaCloudRecoveryAction(provider, errorCode)).toEqual({
      key: 'p',
      label: '使用 Proma Cloud 重试',
      action: 'switch_to_proma_cloud',
    })
  })

  test.each([
    ['proma', 'invalid_api_key'],
    ['openai', 'invalid_model'],
    [undefined, 'expired_oauth_token'],
  ] as const)('Given ineligible provider or error %s/%s When building recovery Then does not offer an invalid fallback', (provider, errorCode) => {
    expect(getPromaCloudRecoveryAction(provider, errorCode)).toBeUndefined()
  })
})
