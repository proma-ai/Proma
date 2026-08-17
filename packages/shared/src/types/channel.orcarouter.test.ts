import { describe, expect, test } from 'bun:test'
import { PROVIDER_DEFAULT_URLS, PROVIDER_LABELS } from './channel'
import { inferReasoningTransport } from './reasoning-profile'

describe('OrcaRouter provider 注册', () => {
  test('Given orcarouter When 查询默认 Base URL Then 指向 OrcaRouter 网关', () => {
    expect(PROVIDER_DEFAULT_URLS.orcarouter).toBe('https://api.orcarouter.ai/v1')
  })

  test('Given orcarouter When 查询显示名 Then OrcaRouter', () => {
    expect(PROVIDER_LABELS.orcarouter).toBe('OrcaRouter')
  })

  test('Given orcarouter When 推导推理传输 Then openai-completions', () => {
    expect(inferReasoningTransport('orcarouter')).toBe('openai-completions')
  })
})
