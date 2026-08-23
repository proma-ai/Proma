import { describe, expect, test } from 'bun:test'
import { iconButtonNoRingFocusClass } from './icon-button-styles'

describe('图标按钮焦点样式', () => {
  const classes = iconButtonNoRingFocusClass.split(' ')

  test('given 图标按钮被鼠标点击 when 应用共享焦点样式 then 不显示浏览器默认描边', () => {
    expect(classes).toContain('focus:outline-none')
  })

  test('given 图标按钮通过键盘获得焦点 when 应用共享焦点样式 then 不显示边框式焦点环', () => {
    expect(classes).toContain('focus-visible:ring-0')
    expect(classes).not.toContain('focus-visible:ring-2')
  })
})
