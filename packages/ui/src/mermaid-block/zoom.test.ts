import { describe, expect, test } from 'bun:test'
import {
  clampScale,
  INITIAL_SCALE,
  toZoomPercent,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomIn,
  zoomOut,
} from './zoom'

describe('Mermaid zoom', () => {
  test('放大一档后按步长递增', () => {
    expect(zoomIn(INITIAL_SCALE)).toBe(1.15)
    expect(toZoomPercent(zoomIn(INITIAL_SCALE))).toBe(115)
  })

  test('缩小一档后按步长递减', () => {
    expect(zoomOut(INITIAL_SCALE)).toBe(0.85)
    expect(toZoomPercent(zoomOut(INITIAL_SCALE))).toBe(85)
  })

  test('不越过上下限', () => {
    expect(zoomIn(ZOOM_MAX)).toBe(ZOOM_MAX)
    expect(zoomOut(ZOOM_MIN)).toBe(ZOOM_MIN)
    expect(clampScale(99)).toBe(ZOOM_MAX)
    expect(clampScale(0.01)).toBe(ZOOM_MIN)
  })

  test('反复缩放不累积浮点误差', () => {
    let scale = INITIAL_SCALE
    for (let i = 0; i < 12; i += 1) {
      scale = zoomOut(zoomIn(scale))
    }
    expect(scale).toBe(INITIAL_SCALE)
    expect(toZoomPercent(scale)).toBe(100)
  })
})
