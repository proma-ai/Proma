import { describe, expect, test } from 'bun:test'
import { buildDiffFileTree } from './diff-file-tree'
import type { DiffFileTreeNode } from './diff-file-tree'

interface TestEntry {
  filePath: string
}

function treeOutline(nodes: Array<DiffFileTreeNode<TestEntry>>, depth = 0): string[] {
  const lines: string[] = []
  for (const node of nodes) {
    lines.push(`${'  '.repeat(depth)}${node.kind === 'directory' ? 'D' : 'F'} ${node.name}`)
    if (node.kind === 'directory') lines.push(...treeOutline(node.children, depth + 1))
  }
  return lines
}

describe('改动文件目录树', () => {
  test('given 同一应用下分散的改动 when 构建目录树 then 压缩单分支目录并按目录优先展示', () => {
    const tree = buildDiffFileTree<TestEntry>([
      { filePath: 'apps/electron/package.json' },
      { filePath: 'apps/electron/src/renderer/components/chat/ModelSelector.tsx' },
      { filePath: 'apps/electron/scripts/build-eventkit-native.ts' },
      { filePath: 'apps/electron/src/renderer/components/agent/AgentView.tsx' },
    ])

    expect(treeOutline(tree)).toEqual([
      'D apps/electron',
      '  D scripts',
      '    F build-eventkit-native.ts',
      '  D src/renderer/components',
      '    D agent',
      '      F AgentView.tsx',
      '    D chat',
      '      F ModelSelector.tsx',
      '  F package.json',
    ])
  })

  test('given 根文件、不同顶层目录和 Windows 分隔符 when 构建目录树 then 保留分支并规范化路径', () => {
    const tree = buildDiffFileTree<TestEntry>([
      { filePath: 'README.md' },
      { filePath: 'packages\\shared\\src\\index.ts' },
      { filePath: 'apps/electron/src/main.ts' },
    ])

    expect(treeOutline(tree)).toEqual([
      'D apps/electron/src',
      '  F main.ts',
      'D packages/shared/src',
      '  F index.ts',
      'F README.md',
    ])
    expect(tree[1]?.kind === 'directory' ? tree[1].path : null).toBe('packages/shared/src')
    expect(tree[1]?.kind === 'directory' ? tree[1].children[0]?.path : null).toBe('packages/shared/src/index.ts')
  })
})
