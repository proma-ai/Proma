import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  inferAgentSdkContextWindow,
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
    expect(resolveAgentSdkModelId('claude-opus-4-8-promo-3', 'anthropic')).toBe('claude-opus-4-8-promo-3[1m]')
    expect(resolveAgentSdkModelId('claude-sonnet-5', 'anthropic')).toBe('claude-sonnet-5[1m]')
    expect(resolveAgentSdkModelId('claude-fable-5', 'anthropic')).toBe('claude-fable-5[1m]')
    expect(resolveAgentSdkModelId('deepseek-v4-pro', 'deepseek')).toBe('deepseek-v4-pro[1m]')
    expect(resolveAgentSdkModelId('deepseek-v4-flash', 'deepseek')).toBe('deepseek-v4-flash[1m]')
    expect(resolveAgentSdkModelId('glm-5.2', 'zhipu-coding')).toBe('glm-5.2[1m]')
    expect(resolveAgentSdkModelId('mimo-v2.5-pro', 'xiaomi')).toBe('mimo-v2.5-pro[1m]')
    expect(resolveAgentSdkModelId('mimo-v2.5', 'xiaomi-token-plan')).toBe('mimo-v2.5[1m]')
    expect(resolveAgentSdkModelId('MiniMax-M3', 'minimax')).toBe('MiniMax-M3[1m]')
  })

  test('Given 已带后缀或未纳入 SDK 1M 的模型 When 解析 SDK 模型 Then 保持原值', () => {
    expect(resolveAgentSdkModelId('claude-opus-4-8[1m]', 'anthropic')).toBe('claude-opus-4-8[1m]')
    expect(resolveAgentSdkModelId('claude-sonnet-4-5', 'anthropic')).toBe('claude-sonnet-4-5')
    expect(resolveAgentSdkModelId('claude-haiku-4-5-20251001', 'anthropic')).toBe('claude-haiku-4-5-20251001')
    expect(resolveAgentSdkModelId('mimo-v2-pro', 'xiaomi')).toBe('mimo-v2-pro')
    expect(resolveAgentSdkModelId('MiniMax-M2.7', 'minimax')).toBe('MiniMax-M2.7')
    expect(resolveAgentSdkModelId('qwen3-max', 'qwen-anthropic')).toBe('qwen3-max')
    expect(resolveAgentSdkModelId('qwen3.6-max-preview', 'qwen-anthropic')).toBe('qwen3.6-max-preview')
    expect(resolveAgentSdkModelId('qwen3.5-397b-a17b', 'qwen-anthropic')).toBe('qwen3.5-397b-a17b')
    expect(resolveAgentSdkModelId('qwen3-coder-next', 'qwen-anthropic')).toBe('qwen3-coder-next')
    expect(resolveAgentSdkModelId('unknown-model', 'anthropic')).toBe('unknown-model')
  })

  test('Given Qwen Anthropic 协议渠道 When 模型名命中 1M 规则 Then 保持真实模型 ID', () => {
    expect(resolveAgentSdkModelId('qwen3.7-max', 'qwen-anthropic')).toBe('qwen3.7-max')
    expect(resolveAgentSdkModelId('qwen3.7-plus', 'qwen-anthropic')).toBe('qwen3.7-plus')
    expect(resolveAgentSdkModelId('qwen3.6-plus', 'qwen-anthropic')).toBe('qwen3.6-plus')
    expect(resolveAgentSdkModelId('qwen3.6-flash', 'qwen-anthropic')).toBe('qwen3.6-flash')
    expect(resolveAgentSdkModelId('qwen3.5-plus', 'qwen-anthropic')).toBe('qwen3.5-plus')
    expect(resolveAgentSdkModelId('qwen3.5-flash', 'qwen-anthropic')).toBe('qwen3.5-flash')
    expect(resolveAgentSdkModelId('qwen3-coder-plus', 'qwen-anthropic')).toBe('qwen3-coder-plus')
  })

  test('Given 通用 Anthropic-compatible 端点 When 模型名命中 1M 规则 Then 保持真实模型 ID', () => {
    expect(resolveAgentSdkModelId('qwen3.7-plus', 'anthropic-compatible')).toBe('qwen3.7-plus')
    expect(resolveAgentSdkModelId('deepseek-v4-pro', 'anthropic-compatible')).toBe('deepseek-v4-pro')
    expect(resolveAgentSdkModelId('glm-5.2', 'anthropic-compatible')).toBe('glm-5.2')
  })

  test('Given Agent SDK 运行窗口推断 When 模型名命中 1M 规则 Then 按模型能力返回 1M', () => {
    expect(inferAgentSdkContextWindow('glm-5.2', 'zhipu-coding')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferAgentSdkContextWindow('glm-5.2', 'anthropic-compatible')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferAgentSdkContextWindow('deepseek-v4-pro', 'deepseek')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferAgentSdkContextWindow('deepseek-v4-pro', 'anthropic-compatible')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferAgentSdkContextWindow('qwen3.7-plus', 'qwen-anthropic')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferAgentSdkContextWindow('claude-sonnet-5', 'anthropic-compatible')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })
})
