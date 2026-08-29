import { describe, expect, it } from 'bun:test'
import { shouldReturnLayoutSnapshotOnHide } from './browser-presentation-policy'

describe('shouldReturnLayoutSnapshotOnHide', () => {
  const baseInput = {
    visible: false,
    boundsWidth: 800,
    boundsHeight: 600,
    tabCurrentlyVisible: true,
    isPresented: true,
  }

  it('场景：加号菜单避让隐藏（真实尺寸 + 页面正在展示）→ 返回快照占位', () => {
    expect(shouldReturnLayoutSnapshotOnHide(baseInput)).toBe(true)
  })

  it('边界：卸载清理使用零尺寸 → 不返回快照', () => {
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, boundsWidth: 0, boundsHeight: 0 })).toBe(false)
  })

  it('边界：尺寸过小（≤4px）→ 不返回快照', () => {
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, boundsWidth: 4 })).toBe(false)
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, boundsHeight: 2 })).toBe(false)
  })

  it('边界：显示请求（visible=true）→ 与快照无关', () => {
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, visible: true })).toBe(false)
  })

  it('边界：页面本就未展示（重复 hide）→ 不返回快照', () => {
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, tabCurrentlyVisible: false })).toBe(false)
  })

  it('边界：该 tab 并非当前展示的 Pane → 不返回快照', () => {
    expect(shouldReturnLayoutSnapshotOnHide({ ...baseInput, isPresented: false })).toBe(false)
  })
})
