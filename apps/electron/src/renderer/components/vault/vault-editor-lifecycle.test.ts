import { describe, expect, test } from 'bun:test'
import { getVaultEditorKey, shouldRemountVaultEditor } from './vault-editor-lifecycle'

describe('Vault editor lifecycle', () => {
  test('普通重复点击当前笔记不会重建编辑器', () => {
    expect(shouldRemountVaultEditor('notes/large.md', 'notes/large.md', false)).toBe(false)
    expect(getVaultEditorKey('notes/large.md')).toBe('notes/large.md:0')
  })

  test('显式丢弃草稿并重载当前笔记时才重建编辑器', () => {
    expect(shouldRemountVaultEditor('notes/large.md', 'notes/large.md', true)).toBe(true)
    expect(getVaultEditorKey('notes/large.md', 1)).toBe('notes/large.md:1')
  })

  test('切换到另一篇笔记依靠路径变化创建新编辑器，不提升当前笔记的重载版本', () => {
    expect(shouldRemountVaultEditor('notes/large.md', 'notes/other.md', true)).toBe(false)
  })
})
