import type { FileAccessOptions } from '@proma/shared'
import type { PreviewFile } from '@/atoms/preview-atoms'

export function isAbsoluteFilePath(filePath: string): boolean {
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
 * 相对路径预览必须携带会话工作目录；历史工具调用通常只持久化了 filePath。
 * 将调用方已有候选目录与其上下文目录合并，以便 .context/plan/*.md 等文件正确解析。
 */
export function getPreviewCandidateBasePaths(
  basePaths: readonly string[] | undefined,
  ...contextPaths: Array<string | null | undefined>
): string[] {
  return uniqueTruthyPaths([...(basePaths ?? []), ...contextPaths])
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
    candidateBasePaths: getPreviewCandidateBasePaths(
      file.basePaths,
      file.gitRoot,
      file.dirPath,
      sessionPath,
    ),
  }
}
