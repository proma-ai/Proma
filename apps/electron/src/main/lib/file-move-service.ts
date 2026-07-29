import { cpSync, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Move a path into an existing directory without replacing an existing entry.
 * Falls back to copy-and-delete when the source and destination are on different volumes.
 */
export function movePathSafely(sourcePath: string, targetDir: string): string {
  const source = resolve(sourcePath)
  const target = resolve(targetDir)
  const destination = join(target, basename(source))

  if (!statSync(target).isDirectory()) {
    throw new Error('目标路径不是文件夹')
  }
  if (source === destination) return destination
  if (existsSync(destination)) {
    throw new Error(`目标文件已存在: ${basename(source)}`)
  }

  try {
    renameSync(source, destination)
    return destination
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') throw error
  }

  const sourceStats = statSync(source)
  cpSync(source, destination, {
    recursive: sourceStats.isDirectory(),
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  })

  try {
    rmSync(source, { recursive: sourceStats.isDirectory(), force: false })
  } catch (error) {
    throw new Error(`已复制到目标，但未能删除源文件: ${error instanceof Error ? error.message : String(error)}`)
  }

  return destination
}
