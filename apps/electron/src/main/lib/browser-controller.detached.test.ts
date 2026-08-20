import { describe, expect, test } from 'bun:test'
import { shouldIgnoreDetachedLayout, shouldIgnoreMainLayout } from './browser-presentation-policy'

describe('受管浏览器独立窗口（方案 A）展示域校验', () => {
  test('主窗口 layout 在独立窗口在场期间被忽略', () => {
    expect(shouldIgnoreMainLayout(true)).toBe(true)
    expect(shouldIgnoreMainLayout(false)).toBe(false)
  })

  test('独立窗口 layout 按窗口域 revision 拒绝旧值与非法值', () => {
    expect(shouldIgnoreDetachedLayout(10, 10)).toBe(true)
    expect(shouldIgnoreDetachedLayout(9, 10)).toBe(true)
    expect(shouldIgnoreDetachedLayout(11, 10)).toBe(false)
    expect(shouldIgnoreDetachedLayout(Number.NaN, 10)).toBe(true)
    expect(shouldIgnoreDetachedLayout(Number.POSITIVE_INFINITY, 10)).toBe(true)
    expect(shouldIgnoreDetachedLayout(1.5, 10)).toBe(true)
  })
})
