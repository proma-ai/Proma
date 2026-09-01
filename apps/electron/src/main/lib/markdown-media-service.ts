import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveFilePath } from './file-preview-service'
import type { FileAccessOptions } from '@proma/shared'

function stripQueryAndHash(value: string): string {
  return value.replace(/[?#].*$/, '')
}

/**
 * Markdown 图片源来自文档内容，不能把它当作任意本地文件路径授权。
 * 仅接受不含协议、盘符、UNC 或上溯片段的相对路径；最终还要在 realpath 后
 * 确认没有借符号链接逃出当前 Markdown 所在目录。
 */
export function isSafeMarkdownRelativeMediaSource(src: string): boolean {
  const raw = stripQueryAndHash(src.trim())
  if (!raw || raw.includes('\0')) return false

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }

  if (!decoded || decoded.includes('\0')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return false
  if (decoded.startsWith('/') || decoded.startsWith('\\')) return false

  return decoded.split(/[\\/]+/).every((segment) => segment !== '..')
}

function isUnderRoot(resolvedPath: string, root: string): boolean {
  const pathWithinRoot = relative(root, resolvedPath)
  return pathWithinRoot === '' || (
    pathWithinRoot !== '..'
    && !pathWithinRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathWithinRoot)
  )
}

/**
 * 将相对 Markdown 图片解析为同一文档目录内的真实文件路径。
 * 返回 null 表示源格式不安全、文件不存在或（含符号链接在内）越出文档目录。
 */
export function resolveMarkdownRelativeMediaPath(
  markdownFilePath: string,
  src: string,
  options?: FileAccessOptions,
): string | null {
  if (!isSafeMarkdownRelativeMediaSource(src)) return null

  try {
    const resolvedMarkdownFilePath = resolveFilePath(markdownFilePath, options?.candidateBasePaths)
    if (!resolvedMarkdownFilePath) return null
    const markdownPath = realpathSync(resolvedMarkdownFilePath)
    const markdownDirectory = dirname(markdownPath)
    const source = decodeURIComponent(stripQueryAndHash(src.trim()))
    const mediaPath = realpathSync(resolve(markdownDirectory, ...source.split(/[\\/]+/)))
    return isUnderRoot(mediaPath, markdownDirectory) ? mediaPath : null
  } catch {
    return null
  }
}
