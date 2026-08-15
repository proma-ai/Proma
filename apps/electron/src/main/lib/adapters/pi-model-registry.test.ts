import { describe, expect, test } from 'bun:test'
import { inferPiProviderFromBaseUrl, resolvePiVisionRelayRoute } from './pi-model-registry'

describe('inferPiProviderFromBaseUrl', () => {
  test('Given opencode.ai/zen/go When 推断 Then 命中 opencode-go（路径优先于 opencode）', () => {
    expect(inferPiProviderFromBaseUrl('https://opencode.ai/zen/go/v1')).toBe('opencode-go')
    expect(inferPiProviderFromBaseUrl('https://opencode.ai/zen/go/v1/chat/completions')).toBe('opencode-go')
  })

  test('Given opencode.ai/zen/v1 When 推断 Then 命中 opencode', () => {
    expect(inferPiProviderFromBaseUrl('https://opencode.ai/zen/v1')).toBe('opencode')
    expect(inferPiProviderFromBaseUrl('https://opencode.ai/zen')).toBe('opencode')
  })

  test('Given xiaomimimo 官方域名 When 推断 Then 命中对应供应商', () => {
    expect(inferPiProviderFromBaseUrl('https://api.xiaomimimo.com/v1')).toBe('xiaomi')
    expect(inferPiProviderFromBaseUrl('https://token-plan-cn.xiaomimimo.com/v1')).toBe('xiaomi-token-plan-cn')
  })

  test('Given 常见供应商域名 When 推断 Then 命中 catalog 供应商', () => {
    expect(inferPiProviderFromBaseUrl('https://api.deepseek.com/anthropic')).toBe('deepseek')
    expect(inferPiProviderFromBaseUrl('https://api.openai.com/v1')).toBe('openai')
    expect(inferPiProviderFromBaseUrl('https://api.moonshot.cn/anthropic')).toBe('moonshotai-cn')
    expect(inferPiProviderFromBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe('zai-coding-cn')
    expect(inferPiProviderFromBaseUrl('https://api.minimaxi.com/anthropic')).toBe('minimax-cn')
  })

  test('Given 未知内网或代理域名 When 推断 Then 返回 undefined', () => {
    expect(inferPiProviderFromBaseUrl('https://gateway.mycompany.com/v1')).toBeUndefined()
    expect(inferPiProviderFromBaseUrl('http://127.0.0.1:8000/v1')).toBeUndefined()
    expect(inferPiProviderFromBaseUrl('')).toBeUndefined()
  })

  test('Given 大小写与尾部斜杠差异 When 推断 Then 归一化后命中', () => {
    expect(inferPiProviderFromBaseUrl('HTTPS://OpenCode.AI/zen/go/v1/')).toBe('opencode-go')
  })
})

describe('resolvePiVisionRelayRoute', () => {
  test('Given custom 渠道 baseUrl 指向 OpenCode Go When mimo-v2.5 Then 命中 opencode-go 视觉版并返回路由', async () => {
    const route = await resolvePiVisionRelayRoute('custom', 'mimo-v2.5', 'https://opencode.ai/zen/go/v1')
    expect(route).toBeDefined()
    expect(route?.adapterProvider).toBe('custom')
  })

  test('Given custom 渠道 baseUrl 指向 OpenCode Go When 该供应商不存在的模型 Then 返回 undefined', async () => {
    const route = await resolvePiVisionRelayRoute('custom', 'deepseek-v4-flash', 'https://opencode.ai/zen/go/v1')
    expect(route).toBeUndefined()
  })

  test('Given custom 渠道 baseUrl 是未知域名 When mimo-v2.5 Then 拒绝，不退回全库猜测', async () => {
    const route = await resolvePiVisionRelayRoute('custom', 'mimo-v2.5', 'https://gateway.mycompany.com/v1')
    expect(route).toBeUndefined()
  })

  test('Given custom 渠道未提供 baseUrl When mimo-v2.5 Then 拒绝', async () => {
    const route = await resolvePiVisionRelayRoute('custom', 'mimo-v2.5')
    expect(route).toBeUndefined()
  })

  test('Given opencode-go-openai 预设渠道 When mimo-v2.5 Then 维持现状正常返回（回归）', async () => {
    const route = await resolvePiVisionRelayRoute('opencode-go-openai', 'mimo-v2.5')
    expect(route).toBeDefined()
    expect(route?.adapterProvider).toBe('opencode-go-openai')
    expect(route?.baseUrl).toBe('https://opencode.ai/zen/go/v1')
  })

  test('Given openai 预设渠道 When 支持图片的模型 Then 维持现状正常返回（回归）', async () => {
    const route = await resolvePiVisionRelayRoute('openai', 'gpt-4o')
    expect(route).toBeDefined()
    expect(route?.adapterProvider).toBe('openai')
  })
})
