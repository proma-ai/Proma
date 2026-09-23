import { test, expect, describe } from 'bun:test'
import { DEFAULT_CONTEXT_WINDOW, ONE_MILLION_CONTEXT_WINDOW, inferContextWindow, isMimoV26Model, supports1MContext } from './context-window'

describe('小米 MiMo 上下文窗口推断', () => {
  test('MiMo-V2.6 系列精确 ID 均为 1M', () => {
    for (const modelId of ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed']) {
      expect(supports1MContext(modelId)).toBe(true)
      expect(inferContextWindow(modelId)).toBe(ONE_MILLION_CONTEXT_WINDOW)
    }
  })

  test('近似或无关 ID 不误判为 1M', () => {
    for (const modelId of ['mimo-v2.60-preview', 'vendor-mimo-v2.6-compatible', 'mimo-v2.6-pro-compatible', 'mimo-v2.6-pros']) {
      expect(supports1MContext(modelId)).toBe(false)
      expect(inferContextWindow(modelId)).toBe(DEFAULT_CONTEXT_WINDOW)
    }
  })

  test('isMimoV26Model 精确匹配并归一空白与大小写', () => {
    expect(isMimoV26Model('mimo-v2.6-pro')).toBe(true)
    expect(isMimoV26Model(' MIMO-V2.6-Flash ')).toBe(true)
    expect(isMimoV26Model('mimo-v2.60-preview')).toBe(false)
    expect(isMimoV26Model(undefined)).toBe(false)
  })

  test('历史 mimo-v2.5 系列保留 1M 推断', () => {
    expect(inferContextWindow('mimo-v2.5')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('mimo-v2.5-pro')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    expect(inferContextWindow('mimo-v2.50-preview')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  test('已废弃的 mimo-v2-pro 仅保留历史显示推断', () => {
    expect(inferContextWindow('mimo-v2-pro')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })
})
