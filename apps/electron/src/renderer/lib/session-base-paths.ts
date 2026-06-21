/**
 * 统一的会话 basePaths 构建工具
 *
 * 用于在 FilePathChip 渲染、自动预览、手动预览间保持一致的文件路径解析候选集。
 * 优先级：dirPath > sessionPath > workspaceFilesPath > 附加目录 > 附加文件父目录
 * 去重保留首次出现顺序，避免 resolveTargetPath 因顺序敏感产生不一致。
 */

import { getFileParentPath } from './file-utils'

export interface BasePathsInput {
  /** 会话工作目录（CWD） */
  sessionPath?: string | null
  /** 工作区共享文件目录（~/.proma/agent-workspaces/{slug}/workspace-files） */
  workspaceFilesPath?: string | null
  /** 目标文件所在目录（最精确的 hint） */
  dirPath?: string | null
  /** 会话级附加目录 */
  sessionAttachedDirs?: string[]
  /** 会话级附加文件 */
  sessionAttachedFiles?: string[]
  /** 工作区级附加目录 */
  workspaceAttachedDirs?: string[]
  /** 工作区级附加文件 */
  workspaceAttachedFiles?: string[]
}

/**
 * 按优先级排序、去重的 basePaths 列表
 *
 * 优先级（降序）：
 * 1. dirPath — 目标文件的直接父目录
 * 2. sessionPath — 当前会话 CWD
 * 3. workspaceFilesPath — 工作区共享文件
 * 4. 会话级附加目录
 * 5. 工作区级附加目录
 * 6. 会话级附加文件（父目录）
 * 7. 工作区级附加文件（父目录）
 */
export function buildOrderedBasePaths(input: BasePathsInput): string[] {
  const result: string[] = []

  function add(path: string | null | undefined): void {
    if (path == null || path === '') return
    // 标准化：去除尾部分隔符
    const normalized = path.replace(/[/\\]+$/, '')
    if (normalized && !result.includes(normalized)) {
      result.push(normalized)
    }
  }

  // 1. 最精确 hint：目标文件所在目录
  add(input.dirPath)

  // 2. 会话工作目录
  add(input.sessionPath)

  // 3. 工作区共享文件目录
  add(input.workspaceFilesPath)

  // 4. 会话级附加目录
  for (const d of input.sessionAttachedDirs ?? []) add(d)

  // 5. 工作区级附加目录
  for (const d of input.workspaceAttachedDirs ?? []) add(d)

  // 6. 会话级附加文件（取其父目录）
  for (const f of input.sessionAttachedFiles ?? []) add(getFileParentPath(f))

  // 7. 工作区级附加文件（取其父目录）
  for (const f of input.workspaceAttachedFiles ?? []) add(getFileParentPath(f))

  return result
}
