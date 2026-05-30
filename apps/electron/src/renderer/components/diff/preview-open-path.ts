import type { FileAccessOptions } from '@proma/shared'
import type { PreviewFile } from '@/atoms/preview-atoms'

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith('/') || filePath.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(filePath)
}

function joinFilePath(basePath: string, filePath: string): string {
  const base = basePath.replace(/[\\/]+$/, '')
  const child = filePath.replace(/^[\\/]+/, '')
  return `${base}/${child}`
}

function uniqueTruthyPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

/**
 * Diff 服务需要相对 git 路径；系统默认 App 打开文件则必须使用实际文件路径。
 */
export function getDefaultAppTargetPath(file: PreviewFile, sessionPath: string): string {
  if (isAbsoluteFilePath(file.filePath)) return file.filePath

  const basePath = file.previewOnly
    ? (file.basePaths?.[0] ?? file.dirPath ?? sessionPath)
    : (file.gitRoot ?? file.dirPath ?? sessionPath)

  return basePath ? joinFilePath(basePath, file.filePath) : file.filePath
}

export function getPreviewFileAccess(
  sessionId: string,
  file: PreviewFile,
  sessionPath: string,
): FileAccessOptions {
  return {
    sessionId,
    candidateBasePaths: uniqueTruthyPaths([
      ...(file.basePaths ?? []),
      file.gitRoot,
      file.dirPath,
      sessionPath,
    ]),
  }
}
