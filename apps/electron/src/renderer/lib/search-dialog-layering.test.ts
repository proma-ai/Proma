import { describe, expect, test } from 'bun:test'
import {
  SEARCH_DIALOG_LAYERS,
  SEARCH_SCOPE_MENU_MODAL,
} from './search-dialog-layering'

describe('全局搜索项目选择器层级', () => {
  test('Given 项目菜单通过 Portal 打开 When 与搜索弹窗叠放 Then 菜单位于弹窗和遮罩上方', () => {
    expect(SEARCH_DIALOG_LAYERS.scopeMenu).toBeGreaterThan(SEARCH_DIALOG_LAYERS.dialog)
    expect(SEARCH_DIALOG_LAYERS.dialog).toBeGreaterThan(SEARCH_DIALOG_LAYERS.overlay)
  })

  test('Given 外层搜索弹窗为非模态 When 打开项目菜单 Then 不额外锁定 body 指针事件', () => {
    expect(SEARCH_SCOPE_MENU_MODAL).toBe(false)
  })
})
