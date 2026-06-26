import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

const FORK_WORKSPACE_COPY_BLOCKLIST = new Set([
  '.claude',
  '.DS_Store',
  '.git',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '__pycache__',
  'coverage',
  'target',
])

export interface ForkWorkspaceCopyResult {
  copiedCount: number
  skippedCount: number
  failedCount: number
}

export function shouldCopyForkWorkspacePath(src: string): boolean {
  return !FORK_WORKSPACE_COPY_BLOCKLIST.has(basename(src))
}

export function copyForkWorkspaceFiles(sourceDir: string, destDir: string): ForkWorkspaceCopyResult {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

  const result: ForkWorkspaceCopyResult = {
    copiedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  }

  const entries = readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(sourceDir, entry.name)
    const destPath = join(destDir, entry.name)

    if (!shouldCopyForkWorkspacePath(srcPath)) {
      result.skippedCount += 1
      continue
    }

    try {
      cpSync(srcPath, destPath, {
        recursive: true,
        filter: shouldCopyForkWorkspacePath,
      })
      result.copiedCount += 1
    } catch (err) {
      result.failedCount += 1
      console.warn(`[Agent 会话] fork 工作区条目复制失败，已跳过 (${srcPath}):`, err)
    }
  }

  return result
}
