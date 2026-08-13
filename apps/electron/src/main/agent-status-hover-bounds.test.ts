import { describe, expect, test } from 'bun:test'
import { calculateHoverWindowBounds } from './agent-status-hover-bounds'
import type { Rectangle, Display } from 'electron'

const WINDOW_SIZE = { width: 320, height: 400 }

function makeDisplay(workArea: Rectangle, bounds?: Rectangle): Display {
  return { workArea, bounds: bounds ?? workArea } as Display
}

describe('calculateHoverWindowBounds', () => {
  test('托盘在屏幕底部居中 → 窗口在托盘正上方居中', () => {
    const trayBounds: Rectangle = { x: 940, y: 1040, width: 40, height: 40 }
    const display = makeDisplay({ x: 0, y: 0, width: 1920, height: 1040 })

    const result = calculateHoverWindowBounds(trayBounds, WINDOW_SIZE, display)

    expect(result.x).toBe(800)
    expect(result.y).toBe(640)
    expect(result.width).toBe(320)
    expect(result.height).toBe(400)
  })

  test('托盘在右下角 → 窗口水平 clamp 不出屏', () => {
    const trayBounds: Rectangle = { x: 1880, y: 1040, width: 40, height: 40 }
    const display = makeDisplay({ x: 0, y: 0, width: 1920, height: 1040 })

    const result = calculateHoverWindowBounds(trayBounds, WINDOW_SIZE, display)

    expect(result.x + result.width).toBeLessThanOrEqual(1920)
    expect(result.x).toBe(1600)
    expect(result.y).toBe(640)
  })

  test('窗口高度超过可用空间 → clamp 到 workArea 高度', () => {
    const trayBounds: Rectangle = { x: 800, y: 500, width: 40, height: 40 }
    const display = makeDisplay({ x: 0, y: 0, width: 1920, height: 600 })

    const result = calculateHoverWindowBounds(trayBounds, { width: 320, height: 1000 }, display)

    expect(result.height).toBe(600)
    expect(result.y).toBeGreaterThanOrEqual(0)
    expect(result.y + result.height).toBeLessThanOrEqual(600)
  })

  test('多显示器（display 有 offset）→ 坐标正确', () => {
    const trayBounds: Rectangle = { x: 2000, y: 1040, width: 40, height: 40 }
    const display = makeDisplay({ x: 1920, y: 0, width: 1920, height: 1040 })

    const result = calculateHoverWindowBounds(trayBounds, WINDOW_SIZE, display)

    expect(result.x).toBeGreaterThanOrEqual(1920)
    expect(result.x + result.width).toBeLessThanOrEqual(1920 + 1920)
    expect(result.y).toBe(640)
  })

  test('窗口在 workArea 左边界 clamp', () => {
    const trayBounds: Rectangle = { x: 1900, y: 1040, width: 40, height: 40 }
    const display = makeDisplay({ x: 1920, y: 0, width: 1920, height: 1040 })

    const result = calculateHoverWindowBounds(trayBounds, WINDOW_SIZE, display)

    expect(result.x).toBe(1920)
  })
})
