import { describe, expect, test } from 'bun:test'
import { Schema } from '@tiptap/pm/model'
import { findSuggestionMatch } from '@tiptap/suggestion'
import {
  filterCommandMenuItems,
  formatSessionReferenceDescription,
  getCommandMenuChildQuery,
  getNextCommandMenuIndex,
  shouldOpenSlashCommandMenu,
  shouldOpenSlashCommandMenuInContext,
} from './agent-command-menu-state'

const slashTestSchema = new Schema({
  nodes: {
    doc: { content: 'text*' },
    text: {},
  },
})

function findCurrentSlashMatch(text: string) {
  const doc = slashTestSchema.node('doc', null, text ? [slashTestSchema.text(text)] : [])
  return findSuggestionMatch({
    char: '/',
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes: null,
    startOfLine: false,
    $position: doc.resolve(doc.content.size),
  })
}

function shouldShowSlashMenu(text: string): boolean {
  const match = findCurrentSlashMatch(text)
  return Boolean(
    match && shouldOpenSlashCommandMenuInContext(text.slice(0, match.range.from), match.text),
  )
}

describe('Agent command menu navigation', () => {
  test('wraps keyboard navigation at both ends of a menu', () => {
    expect(getNextCommandMenuIndex(0, -1, 4)).toBe(3)
    expect(getNextCommandMenuIndex(3, 1, 4)).toBe(0)
    expect(getNextCommandMenuIndex(1, 1, 4)).toBe(2)
  })

  test('keeps the selection at zero when there are no choices', () => {
    expect(getNextCommandMenuIndex(0, 1, 0)).toBe(0)
  })

  test('filters entries by id, label, or supporting description', () => {
    const items = [
      { id: 'file', label: '引用文件', description: '会话文件和工作区文件' },
      { id: 'session', label: '引用会话', description: '选择历史 Agent 会话' },
      { id: 'compact-context', label: '压缩上下文', description: '释放上下文空间' },
    ]

    expect(filterCommandMenuItems(items, '工作区')).toEqual([items[0]!])
    expect(filterCommandMenuItems(items, '会话')).toEqual([items[0]!, items[1]!])
    expect(filterCommandMenuItems(items, 'compact-context')).toEqual([items[2]!])
    expect(filterCommandMenuItems(items, '')).toEqual(items)
  })

  test('keeps the root filter out of child resource searches', () => {
    expect(getCommandMenuChildQuery('文件README', '文件')).toBe('README')
    expect(getCommandMenuChildQuery('会话', '会话')).toBe('')
    expect(getCommandMenuChildQuery('README', '文件')).toBe('README')
  })

  test('only accepts a valid active slash token', () => {
    expect(shouldOpenSlashCommandMenu('/')).toBe(true)
    expect(shouldOpenSlashCommandMenu('/引')).toBe(true)
    expect(shouldOpenSlashCommandMenu('/tmp/file')).toBe(false)
    expect(shouldOpenSlashCommandMenu('/a b')).toBe(false)
    expect(shouldOpenSlashCommandMenu('')).toBe(false)
  })

  test('finds the current slash after ordinary slash text earlier in the input', () => {
    const match = findCurrentSlashMatch('常规/路径 已说明，再次输入/')

    expect(match?.text).toBe('/')
    expect(match?.query).toBe('')
    expect(shouldOpenSlashCommandMenu(match?.text ?? '')).toBe(true)
    expect(shouldShowSlashMenu('常规/路径 已说明，再次输入/')).toBe(true)
  })

  test('allows a command slash directly after Chinese text without a space', () => {
    const match = findCurrentSlashMatch('继续调用/')

    expect(match?.text).toBe('/')
    expect(shouldOpenSlashCommandMenu(match?.text ?? '')).toBe(true)
    expect(shouldShowSlashMenu('继续调用/')).toBe(true)
  })

  test('does not treat path or URL segments as a command', () => {
    expect(shouldShowSlashMenu('foo/bar')).toBe(false)
    expect(shouldShowSlashMenu('/tmp/file')).toBe(false)
    expect(shouldShowSlashMenu('${HOME}/foo')).toBe(false)
    expect(shouldShowSlashMenu('https://example.com/path')).toBe(false)
  })

  test('formats a cross-workspace session source without changing its label', () => {
    expect(formatSessionReferenceDescription({
      workspaceName: '产品研发',
      workspaceSlug: 'product-dev',
      snippet: '讨论命令菜单',
    })).toBe('工作区：产品研发 (product-dev) · 讨论命令菜单')
    expect(formatSessionReferenceDescription({ workspaceName: '产品研发' })).toBe('工作区：产品研发')
    expect(formatSessionReferenceDescription({})).toBeUndefined()
  })
})
