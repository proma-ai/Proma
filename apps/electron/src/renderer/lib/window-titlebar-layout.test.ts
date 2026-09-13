import { describe, expect, test } from 'bun:test'
import { getSidebarTitlebarLayout } from './window-titlebar-layout'

describe('侧栏开关与原生标题栏对齐', () => {
  test('Given macOS 页面缩放，When 展开、收起或处于动画中途，Then 按钮原生坐标和尺寸保持不变', () => {
    for (const zoomFactor of [0.25, 0.5, 0.8, 1, 1.2, 1.5, 2, 3]) {
      for (const sidebarOccupiedWidth of [61, 100, 160, 200, 241, 421]) {
        const layout = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth })

        expect(layout.toggleLeft * zoomFactor).toBeCloseTo(90)
        expect(layout.searchLeft * zoomFactor).toBeCloseTo(122)
        expect((layout.searchLeft - layout.toggleLeft - 28 * layout.toggleScale) * zoomFactor).toBeCloseTo(4)
        expect(layout.controlsEnd * zoomFactor).toBeCloseTo(162)
        expect((layout.toggleTop + 14 * layout.toggleScale) * zoomFactor).toBeCloseTo(25)
        expect(28 * layout.toggleScale * zoomFactor).toBeCloseTo(28)
        expect(layout.titlebarHeight * zoomFactor).toBeCloseTo(50)
        expect(layout.sidebarTopInset * zoomFactor).toBeCloseTo(50)
      }
    }
  })

  test('Given macOS 窄侧栏及缩放，When 计算标题位置，Then 标题始终位于搜索按钮右侧且保留间距', () => {
    for (const zoomFactor of [0.25, 0.5, 0.8, 1, 1.5, 2]) {
      for (const sidebarOccupiedWidth of [61, 100, 162, 241, 421]) {
        const layout = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth })
        const titleStart = (sidebarOccupiedWidth + layout.mainLeadingInset) * zoomFactor

        // 搜索按钮左边距 122、宽 28，标题至少再留出 12 个原生像素。
        expect(titleStart).toBeGreaterThanOrEqual(162 - 0.000001)
        if (sidebarOccupiedWidth * zoomFactor >= 162) expect(layout.mainLeadingInset).toBe(0)
      }
    }
  })

  test('Given 无效缩放值，When 初始化标题栏，Then 使用 100% 布局避免按钮消失', () => {
    for (const zoomFactor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layout = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth: 61 })
      expect(layout.toggleScale).toBe(1)
      expect(layout.toggleTop).toBe(11)
      expect(layout.mainLeadingInset).toBe(101)
    }
  })

  test('Given 侧栏与标题同步过渡，When 连续展开或收起，Then 标题及主区拖拽区域均不穿过按钮', () => {
    for (const zoomFactor of [0.25, 0.5, 0.8, 1, 1.5, 2]) {
      const collapsedWidth = 61
      for (const expandedWidth of [241, 301, 421]) {
        const collapsed = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth: collapsedWidth })
        const expanded = getSidebarTitlebarLayout({ isMac: true, isWindows: false, zoomFactor, sidebarOccupiedWidth: expandedWidth })
        // 两边使用相同 easing，任意插值进度也包括反向切换的动画过程。
        for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const sidebarWidth = collapsedWidth + (expandedWidth - collapsedWidth) * progress
          const leadingInset = collapsed.mainLeadingInset + (expanded.mainLeadingInset - collapsed.mainLeadingInset) * progress
          const dragStart = (sidebarWidth + leadingInset) * zoomFactor
          const searchRight = (collapsed.searchLeft + 28 * collapsed.toggleScale) * zoomFactor

          expect(dragStart - searchRight).toBeGreaterThanOrEqual(12 - 0.000001)
        }
      }
    }
  })

  test('Given Windows，When 放置按钮，Then 使用独立的 32px 标题栏且不给会话标题添加 macOS 留白', () => {
    const layout = getSidebarTitlebarLayout({ isMac: false, isWindows: true, zoomFactor: 0.8, sidebarOccupiedWidth: 61 })
    expect(layout.toggleLeft).toBe(12)
    expect(layout.searchLeft).toBe(44)
    expect(layout.toggleTop + 14).toBe(16)
    expect(layout.toggleScale).toBe(1)
    expect(layout.sidebarTopInset).toBe(8)
    expect(layout.mainLeadingInset).toBe(0)
  })

  test('Given Linux，When 放置按钮，Then 侧栏内容位于按钮下方', () => {
    const layout = getSidebarTitlebarLayout({ isMac: false, isWindows: false, zoomFactor: 1, sidebarOccupiedWidth: 61 })
    expect(layout.toggleLeft).toBe(12)
    expect(layout.sidebarTopInset).toBeGreaterThan(layout.toggleTop + 28)
    expect(layout.mainLeadingInset).toBe(23)
  })
})
