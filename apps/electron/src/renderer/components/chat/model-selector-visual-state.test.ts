import { describe, expect, test } from 'bun:test'
import { getModelSelectorOptionVisualState } from './model-selector-visual-state'

describe('模型选择器选项视觉状态', () => {
  test('given 当前模型 when 计算视觉状态 then 显示选中态', () => {
    expect(getModelSelectorOptionVisualState(true, false)).toBe('selected')
  })

  test('given 未选中模型被高亮 when 计算视觉状态 then 显示高亮态', () => {
    expect(getModelSelectorOptionVisualState(false, true)).toBe('highlighted')
  })

  test('given 当前模型同时被高亮 when 计算视觉状态 then 选中态保持优先', () => {
    expect(getModelSelectorOptionVisualState(true, true)).toBe('selected')
  })
})
