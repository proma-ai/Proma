import type { VaultFileEntry, VaultTreeEntry } from '@proma/shared'

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

/** Builds the data model once per tree-entry change; rendering remains demand-driven. */
export function buildVaultTree(entries: VaultTreeEntry[]): VaultFolderNode {
  const root: VaultFolderNode = { name: '', relativePath: '', folders: new Map(), files: [] }

  const getOrCreateFolder = (relativePath: string): VaultFolderNode => {
    let parent = root
    let currentPath = ''
    for (const folderName of relativePath.split('/').filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName
      let folder = parent.folders.get(folderName)
      if (!folder) {
        folder = { name: folderName, relativePath: currentPath, folders: new Map(), files: [] }
        parent.folders.set(folderName, folder)
      }
      parent = folder
    }
    return parent
  }

  for (const entry of entries) {
    if (entry.kind === 'folder') {
      getOrCreateFolder(entry.relativePath)
      continue
    }

    const separatorIndex = entry.relativePath.lastIndexOf('/')
    const parent = separatorIndex < 0 ? root : getOrCreateFolder(entry.relativePath.slice(0, separatorIndex))
    parent.files.push(entry)
  }

  return root
}

/** File contents, sizes, and timestamps do not change the visible tree. Reuse the existing
 * model for saves or refreshes that leave every entry kind, path, and label intact.
 */
export function hasSameVaultTreeEntries(current: VaultTreeEntry[], next: VaultTreeEntry[]): boolean {
  return current.length === next.length
    && current.every((entry, index) => (
      entry.kind === next[index]?.kind
      && entry.relativePath === next[index]?.relativePath
      && entry.name === next[index]?.name
    ))
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
