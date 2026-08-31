import { describe, expect, test } from 'bun:test'
import {
  consumeProjectSearchMenuCloseAutoFocus,
  scheduleProjectSearchOpen,
} from './project-search-menu-action'

describe('项目菜单搜索打开时序', () => {
  test('Given 菜单项刚被选中 When 请求打开项目搜索 Then 应在当前选择事件结束后执行', async () => {
    const openedProjects: Array<{ workspaceId: string; workspaceName: string }> = []

    scheduleProjectSearchOpen((workspaceId, workspaceName) => {
      openedProjects.push({ workspaceId, workspaceName })
    }, 'workspace-1', '示例项目')

    expect(openedProjects).toHaveLength(0)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(openedProjects).toEqual([
      {
        workspaceId: 'workspace-1',
        workspaceName: '示例项目',
      },
    ])
  })

  test('Given 项目搜索等待打开 When 菜单恢复焦点 Then 仅阻止本次恢复并消费标记', () => {
    const pendingProjectSearch = { current: true }
    let preventDefaultCount = 0
    const event = {
      preventDefault: () => {
        preventDefaultCount += 1
      },
    }

    consumeProjectSearchMenuCloseAutoFocus(pendingProjectSearch, event)
    consumeProjectSearchMenuCloseAutoFocus(pendingProjectSearch, event)

    expect(preventDefaultCount).toBe(1)
    expect(pendingProjectSearch.current).toBeFalse()
  })
})
