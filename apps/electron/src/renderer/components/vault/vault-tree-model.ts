import type { VaultFileEntry } from '@proma/shared'

/** A fresh file tree intentionally reveals no nested folders. */
export function getInitialVaultExpandedFolders(): ReadonlySet<string> {
  return new Set()
}

export interface VaultFolderNode {
  name: string
  relativePath: string
  folders: Map<string, VaultFolderNode>
  files: VaultFileEntry[]
}

/** Builds the data model once per file-list change; rendering remains demand-driven. */
export function buildVaultTree(files: VaultFileEntry[]): VaultFolderNode {
  const root: VaultFolderNode = { name: '', relativePath: '', folders: new Map(), files: [] }

  for (const file of files) {
    const segments = file.relativePath.split('/')
    const filename = segments.pop()
    if (!filename) continue

    let parent = root
    for (const folderName of segments) {
      const relativePath = parent.relativePath ? `${parent.relativePath}/${folderName}` : folderName
      let folder = parent.folders.get(folderName)
      if (!folder) {
        folder = { name: folderName, relativePath, folders: new Map(), files: [] }
        parent.folders.set(folderName, folder)
      }
      parent = folder
    }
    parent.files.push(file)
  }

  return root
}

/** Returns only the folders needed to reveal a user-selected note. */
/**
 * File sizes and timestamps do not change the visible tree. Reuse the existing
 * model for saves or refreshes that leave every path and label intact.
 */
export function hasSameVaultTreeEntries(current: VaultFileEntry[], next: VaultFileEntry[]): boolean {
  return current.length === next.length
    && current.every((entry, index) => entry.relativePath === next[index]?.relativePath && entry.name === next[index]?.name)
}

export function getVaultFolderAncestors(relativePath: string): string[] {
  const folders = relativePath.split('/').filter(Boolean).slice(0, -1)
  const ancestors: string[] = []
  let currentPath = ''

  for (const folderName of folders) {
    currentPath = currentPath ? `${currentPath}/${folderName}` : folderName
    ancestors.push(currentPath)
  }

  return ancestors
}
