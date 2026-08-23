import { describe, expect, test } from 'bun:test'
import {
  inputToolbarButtonClass,
  inputToolbarControlHeightClass,
  inputToolbarSendButtonClass,
} from './input-toolbar-styles'

describe('输入工具栏控件尺寸', () => {
  test('given 模型选择框需要与发送按钮对齐 when 读取共享高度 then 高度固定为 32px', () => {
    expect(inputToolbarControlHeightClass).toBe('h-8')
  })

  test('given 普通工具按钮和发送按钮 when 生成样式 then 两者使用相同高度', () => {
    expect(inputToolbarButtonClass.split(' ')).toContain(inputToolbarControlHeightClass)
    expect(inputToolbarSendButtonClass.split(' ')).toContain(inputToolbarControlHeightClass)
  })
})
