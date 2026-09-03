import { describe, expect, test } from 'bun:test'
import type { VaultTreeEntry } from '@proma/shared'
import { buildVaultTree, hasSameVaultTreeEntries } from './vault-tree-model'

const entries: VaultTreeEntry[] = [
  { kind: 'folder', relativePath: 'Empty', name: 'Empty' },
  { kind: 'folder', relativePath: 'Projects', name: 'Projects' },
  { kind: 'folder', relativePath: 'Projects/2026', name: '2026' },
  { kind: 'file', relativePath: 'Projects/2026/Plan.md', name: 'Plan.md', size: 7, modifiedAt: 1 },
]

describe('Vault 文件树模型', () => {
  test('Given 显式的空文件夹条目 When 构建树 Then 保留空文件夹及其嵌套层级', () => {
    const tree = buildVaultTree(entries)

    expect(tree.folders.get('Empty')).toMatchObject({ name: 'Empty', relativePath: 'Empty' })
    expect(tree.folders.get('Empty')?.files).toEqual([])
    expect(tree.folders.get('Projects')?.folders.get('2026')).toMatchObject({
      name: '2026',
      relativePath: 'Projects/2026',
      files: [expect.objectContaining({ kind: 'file', relativePath: 'Projects/2026/Plan.md' })],
    })
  })

  test('Given file content metadata changes only When 比较树条目 Then 复用现有树模型', () => {
    const refreshedEntries: VaultTreeEntry[] = [
      ...entries.slice(0, 3),
      { kind: 'file', relativePath: 'Projects/2026/Plan.md', name: 'Plan.md', size: 99, modifiedAt: 2 },
    ]

    expect(hasSameVaultTreeEntries(entries, refreshedEntries)).toBe(true)
  })

  test('Given a newly created empty folder When 比较树条目 Then 请求侧栏刷新', () => {
    const refreshedEntries: VaultTreeEntry[] = [
      ...entries,
      { kind: 'folder', relativePath: 'Projects/2026/Archive', name: 'Archive' },
    ]

    expect(hasSameVaultTreeEntries(entries, refreshedEntries)).toBe(false)
  })
})
