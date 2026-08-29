import { describe, expect, test } from 'bun:test'
import { normalizePiBaseUrl } from './pi-model-registry'

describe('normalizePiBaseUrl', () => {
  test('Google Agent 渠道根地址补齐 /v1beta，避免 Pi 请求 404', () => {
    expect(normalizePiBaseUrl('https://generativelanguage.googleapis.com', 'google', 'google-generative-ai'))
      .toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  test('Google 已包含 API 版本时不重复追加', () => {
    expect(normalizePiBaseUrl('https://generativelanguage.googleapis.com/v1beta/', 'google', 'google-generative-ai'))
      .toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizePiBaseUrl('https://proxy.example.com/google/v1', 'google', 'google-generative-ai'))
      .toBe('https://proxy.example.com/google/v1')
  })

  test('非 Google provider 保持原有规范化策略', () => {
    expect(normalizePiBaseUrl('https://api.example.com/v1/', 'custom', 'openai-completions'))
      .toBe('https://api.example.com/v1')
  })
})
