/** 文件路径 chip 的纯逻辑，与 React 解耦以便确定性测试。 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])
/** 需与主进程 file-preview-service.ts 的代码及 Markdown 扩展名保持一致。 */
const CODE_EXTS = new Set([
  'md', 'markdown',
  'json', 'jsonc', 'json5',
  'xml', 'html', 'htm',
  'txt', 'log', 'csv',
  'yaml', 'yml', 'toml', 'ini', 'env', 'lock',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'fish',
  'css', 'scss', 'less',
  'sql', 'rb', 'php',
  'diff', 'patch',
])
const DOC_EXTS = new Set(['pdf', 'docx'])
const ALL_PREVIEWABLE_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...CODE_EXTS, ...DOC_EXTS])

/** 路径分隔符正则（同时匹配 / 和 \\） */
const PATH_SEP_RE = /[\\/]/
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/
const UNC_PATH_RE = /^\\\\/

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

export function getFileName(filePath: string): string {
  const parts = filePath.split(PATH_SEP_RE)
  return parts[parts.length - 1] || filePath
}

export function stripLineCol(filePath: string): { path: string; suffix: string } {
  const match = filePath.match(/^(.+?)(:\d+(?::\d+)?)$/)
  if (match && !match[1]!.endsWith(':')) {
    return { path: match[1]!, suffix: match[2]! }
  }
  return { path: filePath, suffix: '' }
}

/** 与主进程 file-preview-service.ts 的绝对路径规则保持一致。 */
export function isAbsolutePreviewPath(filePath: string): boolean {
  return filePath.startsWith('/') || UNC_PATH_RE.test(filePath) || WIN_DRIVE_RE.test(filePath)
}

export function isImageFilePath(filePath: string): boolean {
  return IMAGE_EXTS.has(getExtension(filePath.trim()))
}

export function isAbsoluteFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  const { path: clean } = stripLineCol(trimmed)
  if (clean.startsWith('/')) {
    if (!/^\/[^\n]+\/[^\n]+$/.test(clean)) return false
    if (clean.endsWith('/') && !clean.includes('.')) return false
    return true
  }
  return isAbsolutePreviewPath(clean)
}

export function isRelativeFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3) return false

  const { path: clean } = stripLineCol(trimmed)
  const ext = getExtension(clean)
  if (!ext || !ALL_PREVIEWABLE_EXTS.has(ext)) return false
  if (!/^[\w./@\\-]+$/.test(clean)) return false
  if (clean.startsWith('.') && !PATH_SEP_RE.test(clean)) return false
  return true
}

export interface FilePathDisplayInput {
  originalPath: string
  resolvedPath?: string | null
  lineColSuffix?: string
}

/** 只使用主进程回传的实际路径；未解析时原样回退，不猜测 candidate base。 */
export function getFilePathDisplayPath({ originalPath, resolvedPath, lineColSuffix = '' }: FilePathDisplayInput): string {
  if (!resolvedPath) return originalPath
  return `${resolvedPath}${lineColSuffix}`
}

/** Promise 回调只允许更新仍属于当前组件/请求代次的状态。 */
export function isAsyncResultCurrent(requestGeneration: number, currentGeneration: number, mounted: boolean): boolean {
  return mounted && requestGeneration === currentGeneration
}
