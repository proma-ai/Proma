import { describe, expect, test } from 'bun:test'
import { preventHoverPopoverFocusRestore } from './input-toolbar-popover-focus'

describe('输入工具栏 Hover Popover 焦点恢复', () => {
  test('given Popover 因鼠标移出而关闭 when Radix 请求恢复焦点 then 阻止焦点移回触发按钮', () => {
    const event = new Event('closeAutoFocus', { cancelable: true })

    preventHoverPopoverFocusRestore(event, false)

    expect(event.defaultPrevented).toBe(true)
  })

  test('given 关闭事件仍需被其他监听器感知 when 阻止自动回焦 then 不阻断事件传播', () => {
    const target = new EventTarget()
    let reachedNextListener = false
    target.addEventListener('closeAutoFocus', (event) => preventHoverPopoverFocusRestore(event, false))
    target.addEventListener('closeAutoFocus', () => {
      reachedNextListener = true
    })

    const dispatched = target.dispatchEvent(new Event('closeAutoFocus', { cancelable: true }))

    expect(dispatched).toBe(false)
    expect(reachedNextListener).toBe(true)
  })

  test('given 键盘焦点已进入 Popover when 弹层关闭 then 允许 Radix 把焦点恢复到触发按钮', () => {
    const event = new Event('closeAutoFocus', { cancelable: true })

    preventHoverPopoverFocusRestore(event, true)

    expect(event.defaultPrevented).toBe(false)
  })
})
