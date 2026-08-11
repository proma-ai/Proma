import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { registerPromaDirectoryPath } from './local-file-protocol'

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

function realDirectory(path: string): string {
  const resolved = realpathSync(resolve(path))
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`本地预览根目录不存在或不是目录: ${path}`)
  return resolved
}

/**
 * 把已授权根目录内的 HTML 文件转换为一次性/短期 proma-file 目录 URL。
 * 不接受 file://，也不把绝对路径暴露给 renderer 或模型。
 */
export function createAuthorizedPreviewUrl(inputPath: string, allowedRoots: string[], baseDir?: string): { url: string; filePath: string } {
  if (!inputPath.trim()) throw new Error('本地预览路径不能为空。')
  const target = realpathSync(resolve(baseDir ?? process.cwd(), inputPath))
  const targetStat = statSync(target)
  const roots = allowedRoots.map(realDirectory)
  const root = roots.find((candidate) => isInside(target, candidate))
  if (!root) throw new Error('本地预览路径不在当前 Agent 已授权的项目或附加目录内。')

  let filePath = target
  if (targetStat.isDirectory()) {
    const indexCandidates = ['index.html', 'index.htm']
    const indexPath = indexCandidates.map((name) => resolve(target, name)).find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
    if (!indexPath) throw new Error('本地预览目录中没有 index.html 或 index.htm。')
    filePath = realpathSync(indexPath)
  }
  const extension = extname(filePath).toLowerCase()
  if (!['.html', '.htm'].includes(extension)) throw new Error(`只支持 HTML 本地预览，当前文件为 ${basename(filePath)}。`)
  if (!isInside(filePath, root)) throw new Error('本地预览文件越过了授权目录边界。')

  const directoryUrl = registerPromaDirectoryPath(dirname(filePath))
  const relativeFile = relative(dirname(filePath), filePath).split(sep).map(encodeURIComponent).join('/')
  return { url: `${directoryUrl}/${relativeFile}`, filePath }
}

export function isAuthorizedPreviewProtocol(url: string): boolean {
  return url.startsWith('proma-file://')
}
