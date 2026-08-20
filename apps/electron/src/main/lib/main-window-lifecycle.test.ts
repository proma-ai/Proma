import { describe, expect, test } from 'bun:test'
import { normalizeWindowBoundsToVisibleArea, type WindowDisplayLike, type WindowBounds } from './main-window-lifecycle'

function display(x: number, y: number, width: number, height: number): WindowDisplayLike {
  return { workArea: { x, y, width, height } }
}

describe('normalizeWindowBoundsToVisibleArea', () => {
  const primary = display(0, 0, 1920, 1040)

  test('窗口仍在副屏可见区内时保留原位置', () => {
    const secondary = display(1920, 0, 1920, 1040)
    const bounds: WindowBounds = { x: 2100, y: 120, width: 1000, height: 720 }

    const result = normalizeWindowBoundsToVisibleArea(bounds, [primary, secondary], primary)

    expect(result).toEqual(bounds)
  })

  test('副屏断开后将窗口居中移动到主屏', () => {
    const result = normalizeWindowBoundsToVisibleArea(
      { x: 2400, y: 120, width: 1000, height: 720 },
      [primary],
      primary,
    )

    expect(result).toEqual({ x: 460, y: 160, width: 1000, height: 720 })
  })

  test('窗口部分超出当前屏幕时夹回可见区', () => {
    const result = normalizeWindowBoundsToVisibleArea(
      { x: -100, y: 900, width: 1000, height: 300 },
      [primary],
      primary,
    )

    expect(result).toEqual({ x: 0, y: 740, width: 1000, height: 300 })
  })

  test('窗口尺寸大于 workArea 时缩到可用区域', () => {
    const result = normalizeWindowBoundsToVisibleArea(
      { x: -200, y: -200, width: 3000, height: 2000 },
      [primary],
      primary,
    )

    expect(result).toEqual({ x: 0, y: 0, width: 1920, height: 1040 })
  })
})
