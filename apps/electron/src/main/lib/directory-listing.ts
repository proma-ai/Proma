import { readdirSync, statSync, type Dirent, type Stats } from 'node:fs'
import { resolve } from 'node:path'
import type { FileEntry } from '@proma/shared'

/** 文件浏览器中不展示的系统文件。 */
const HIDDEN_FS_ENTRIES = new Set(['.DS_Store', 'Thumbs.db'])

interface DirectoryListingFs {
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
  statSync(path: string): Stats
}

const nativeFs: DirectoryListingFs = { readdirSync, statSync }

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

/**
 * 浅层列出目录内容。
 *
 * 目录在枚举后可能被 Git、构建工具或同步服务修改；悬空符号链接也会在 stat 时返回
 * ENOENT。此时跳过失效条目，避免一个无效条目阻断整个文件面板。
 */
export function listShallowDirectory(
  directoryPath: string,
  fs: DirectoryListingFs = nativeFs,
): FileEntry[] {
  let items: Dirent[]
  try {
    items = fs.readdirSync(directoryPath, { withFileTypes: true })
  } catch (error) {
    // 根目录在请求期间被删除时，文件面板应退化为空列表。
    if (hasErrorCode(error, 'ENOENT')) return []
    throw error
  }

  const entries: FileEntry[] = []
  for (const item of items) {
    if (HIDDEN_FS_ENTRIES.has(item.name)) continue

    const fullPath = resolve(directoryPath, item.name)
    const isDirectory = item.isDirectory()
    let size: number | undefined

    if (!isDirectory) {
      try {
        size = fs.statSync(fullPath).size
      } catch (error) {
        // readdir 与 stat 之间条目可能消失；悬空符号链接也属于该情况。
        if (hasErrorCode(error, 'ENOENT')) continue
        throw error
      }
    }

    entries.push({
      name: item.name,
      path: fullPath,
      isDirectory,
      size,
    })
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    const aHidden = a.name.startsWith('.')
    const bHidden = b.name.startsWith('.')
    if (aHidden !== bHidden) return aHidden ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return entries
}
