import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  inferContextWindow,
  resolveAgentSdkModelId,
  supports1MContext,
} from './context-window'

describe('模型上下文窗口', () => {
  test('Given 当前 1M Claude 模型 When 推断窗口 Then 返回 1M', () => {
    expect(inferContextWindow('claude-opus-4-8-promo-3')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-sonnet-4-6')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-sonnet-5')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })

  test('Given 旧版 Claude 或 Haiku When 推断窗口 Then 保持 200K', () => {
    expect(supports1MContext('claude-sonnet-4-5')).toBe(false)
    expect(inferContextWindow('claude-sonnet-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-opus-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('claude-haiku-4-5-20251001')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  test('Given 支持 1M 的 Agent 模型 When 解析 SDK 模型 Then 追加扩展上下文后缀', () => {
    expect(resolveAgentSdkModelId('claude-opus-4-8-promo-3')).toBe('claude-opus-4-8-promo-3[1m]')
    expect(resolveAgentSdkModelId('claude-sonnet-5')).toBe('claude-sonnet-5[1m]')
    expect(resolveAgentSdkModelId('claude-fable-5')).toBe('claude-fable-5[1m]')
    expect(resolveAgentSdkModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro[1m]')
    expect(resolveAgentSdkModelId('deepseek-v4-flash')).toBe('deepseek-v4-flash[1m]')
    expect(resolveAgentSdkModelId('glm-5.2')).toBe('glm-5.2[1m]')
    expect(resolveAgentSdkModelId('mimo-v2.5-pro')).toBe('mimo-v2.5-pro[1m]')
    expect(resolveAgentSdkModelId('mimo-v2.5')).toBe('mimo-v2.5[1m]')
    expect(resolveAgentSdkModelId('MiniMax-M3')).toBe('MiniMax-M3[1m]')
    expect(resolveAgentSdkModelId('qwen3.7-max')).toBe('qwen3.7-max[1m]')
    expect(resolveAgentSdkModelId('qwen3.7-plus')).toBe('qwen3.7-plus[1m]')
    expect(resolveAgentSdkModelId('qwen3.6-plus')).toBe('qwen3.6-plus[1m]')
    expect(resolveAgentSdkModelId('qwen3.6-flash')).toBe('qwen3.6-flash[1m]')
    expect(resolveAgentSdkModelId('qwen3.5-plus')).toBe('qwen3.5-plus[1m]')
    expect(resolveAgentSdkModelId('qwen3.5-flash')).toBe('qwen3.5-flash[1m]')
    expect(resolveAgentSdkModelId('qwen3-coder-plus')).toBe('qwen3-coder-plus[1m]')
  })

  test('Given 已带后缀或未纳入 SDK 1M 的模型 When 解析 SDK 模型 Then 保持原值', () => {
    expect(resolveAgentSdkModelId('claude-opus-4-8[1m]')).toBe('claude-opus-4-8[1m]')
    expect(resolveAgentSdkModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(resolveAgentSdkModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001')
    expect(resolveAgentSdkModelId('mimo-v2-pro')).toBe('mimo-v2-pro')
    expect(resolveAgentSdkModelId('MiniMax-M2.7')).toBe('MiniMax-M2.7')
    expect(resolveAgentSdkModelId('qwen3-max')).toBe('qwen3-max')
    expect(resolveAgentSdkModelId('qwen3.6-max-preview')).toBe('qwen3.6-max-preview')
    expect(resolveAgentSdkModelId('qwen3.5-397b-a17b')).toBe('qwen3.5-397b-a17b')
    expect(resolveAgentSdkModelId('qwen3-coder-next')).toBe('qwen3-coder-next')
    expect(resolveAgentSdkModelId('unknown-model')).toBe('unknown-model')
  })
})
