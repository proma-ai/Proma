import type { FileAccessOptions } from '@proma/shared'
import type { PreviewFile } from '@/atoms/preview-atoms'
import { arePathsEqual } from '@/lib/session-file-changes'

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
 * 将调用方已有候选目录与会话 workbench 根合并，以便 plan/*.md、attachments/*
 * 及历史 .context/plan/*.md 等文件正确解析。
 */
export function getPreviewCandidateBasePaths(
  basePaths: readonly string[] | undefined,
  ...contextPaths: Array<string | null | undefined>
): string[] {
  return uniqueTruthyPaths([...(basePaths ?? []), ...contextPaths])
}

/** Returns every absolute candidate represented by a preview file descriptor. */
export function getPreviewFileCandidatePaths(file: PreviewFile, sessionPath?: string): string[] {
  if (isAbsoluteFilePath(file.filePath)) return [file.filePath]

  return getPreviewCandidateBasePaths(
    file.basePaths,
    file.gitRoot,
    file.dirPath,
    sessionPath,
  ).map((basePath) => joinFilePath(basePath, file.filePath))
}

/** Whether a workspace watcher event modifies the file represented by this preview. */
export function doesWorkspaceChangeAffectPreview(
  file: PreviewFile,
  changedPaths: readonly string[],
  sessionPath?: string,
  caseInsensitive = false,
): boolean {
  const candidatePaths = getPreviewFileCandidatePaths(file, sessionPath)
  return candidatePaths.some((candidatePath) => (
    changedPaths.some((changedPath) => arePathsEqual(candidatePath, changedPath, caseInsensitive))
  ))
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
    // 与右侧文件面板一致：预览 Agent 实际操作过的外部路径不受附件白名单限制。
    unrestricted: true,
    ...(file.workspaceSkillSlug ? { workspaceSkillSlug: file.workspaceSkillSlug } : {}),
    ...(file.legacySkillFilePath ? { legacySkillFilePath: file.legacySkillFilePath } : {}),
    candidateBasePaths: getPreviewCandidateBasePaths(
      file.basePaths,
      file.gitRoot,
      file.dirPath,
      sessionPath,
    ),
  }
}
