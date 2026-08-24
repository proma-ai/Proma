/**
 * 文件改动面板使用的轻量目录树。
 * 仅包含存在改动的路径，并压缩没有分支的连续目录，减少无意义的纵向层级。
 */

export interface DiffFileTreeEntry {
  filePath: string
}

export interface DiffFileTreeDirectoryNode<T extends DiffFileTreeEntry> {
  kind: 'directory'
  /** 展示名；连续单分支目录会合并为带斜杠的路径。 */
  name: string
  /** 相对 Git 根目录的完整目录路径，用作稳定状态 key。 */
  path: string
  children: Array<DiffFileTreeNode<T>>
}

export interface DiffFileTreeFileNode<T extends DiffFileTreeEntry> {
  kind: 'file'
  name: string
  path: string
  entry: T
}

export type DiffFileTreeNode<T extends DiffFileTreeEntry> =
  | DiffFileTreeDirectoryNode<T>
  | DiffFileTreeFileNode<T>

interface MutableDirectory<T extends DiffFileTreeEntry> {
  name: string
  path: string
  directories: Map<string, MutableDirectory<T>>
  files: Map<string, DiffFileTreeFileNode<T>>
}

function createMutableDirectory<T extends DiffFileTreeEntry>(name: string, path: string): MutableDirectory<T> {
  return {
    name,
    path,
    directories: new Map(),
    files: new Map(),
  }
}

function compareNodes<T extends DiffFileTreeEntry>(left: DiffFileTreeNode<T>, right: DiffFileTreeNode<T>): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

function finalizeDirectory<T extends DiffFileTreeEntry>(directory: MutableDirectory<T>): DiffFileTreeDirectoryNode<T> {
  let name = directory.name
  let path = directory.path
  let children = finalizeChildren(directory)

  // 只压缩纯目录链；同层存在文件或其他目录时保留真实层级。
  while (children.length === 1 && children[0]?.kind === 'directory') {
    const onlyChild = children[0]
    name = `${name}/${onlyChild.name}`
    path = onlyChild.path
    children = onlyChild.children
  }

  return { kind: 'directory', name, path, children }
}

function finalizeChildren<T extends DiffFileTreeEntry>(directory: MutableDirectory<T>): Array<DiffFileTreeNode<T>> {
  return [
    ...Array.from(directory.directories.values(), finalizeDirectory),
    ...directory.files.values(),
  ].sort(compareNodes)
}

/** 根据 Git 相对路径生成“目录优先、文件随后”的改动目录树。 */
export function buildDiffFileTree<T extends DiffFileTreeEntry>(entries: readonly T[]): Array<DiffFileTreeNode<T>> {
  const root = createMutableDirectory<T>('', '')

  for (const entry of entries) {
    const normalizedPath = entry.filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!normalizedPath) continue

    const segments = normalizedPath.split('/').filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) continue

    let parent = root
    let currentPath = ''
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let directory = parent.directories.get(segment)
      if (!directory) {
        directory = createMutableDirectory(segment, currentPath)
        parent.directories.set(segment, directory)
      }
      parent = directory
    }

    parent.files.set(fileName, {
      kind: 'file',
      name: fileName,
      path: normalizedPath,
      entry,
    })
  }

  return finalizeChildren(root)
}
