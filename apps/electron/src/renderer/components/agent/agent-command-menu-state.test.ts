import { describe, expect, test } from 'bun:test'
import {
  filterCommandMenuItems,
  getNextCommandMenuIndex,
  shouldOpenSlashCommandMenu,
} from './agent-command-menu-state'

describe('Agent command menu navigation', () => {
  test('wraps keyboard navigation at both ends of a menu', () => {
    expect(getNextCommandMenuIndex(0, -1, 4)).toBe(3)
    expect(getNextCommandMenuIndex(3, 1, 4)).toBe(0)
    expect(getNextCommandMenuIndex(1, 1, 4)).toBe(2)
  })

  test('keeps the selection at zero when there are no choices', () => {
    expect(getNextCommandMenuIndex(0, 1, 0)).toBe(0)
  })

  test('filters entries by their label or supporting description', () => {
    const items = [
      { id: 'file', label: '引用文件', description: '会话文件和工作区文件' },
      { id: 'session', label: '引用会话', description: '选择历史 Agent 会话' },
      { id: 'compact', label: '压缩上下文', description: '释放上下文空间' },
    ]

    expect(filterCommandMenuItems(items, '工作区')).toEqual([items[0]!])
    expect(filterCommandMenuItems(items, '会话')).toEqual([items[0]!, items[1]!])
    expect(filterCommandMenuItems(items, '')).toEqual(items)
  })

  test('only opens the slash menu for a clean command prefix', () => {
    expect(shouldOpenSlashCommandMenu('/')).toBe(true)
    expect(shouldOpenSlashCommandMenu('/引')).toBe(true)
    expect(shouldOpenSlashCommandMenu('先说 /')).toBe(false)
    expect(shouldOpenSlashCommandMenu('/tmp/file')).toBe(false)
    expect(shouldOpenSlashCommandMenu('')).toBe(false)
  })
})
