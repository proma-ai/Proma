/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后通过 IPC 在新窗口中预览文件。
 */

import * as React from 'react'
import { FileText, FileImage, FileVideo, FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 图片扩展名 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
/** 视频扩展名 */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])
/**
 * 代码/结构化文本扩展名
 * 需与主进程 file-preview-service.ts 的 CODE_EXTENSIONS + MARKDOWN_EXTENSIONS 保持一致，
 * 否则消息中的相对路径无法被识别为可点击 chip。
 */
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
/** 文档扩展名 */
const DOC_EXTS = new Set(['pdf', 'docx'])

/** 所有可预览的扩展名集合（用于相对路径检测） */
const ALL_PREVIEWABLE_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...CODE_EXTS, ...DOC_EXTS])

/** 从路径提取文件名 */
function getFileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

/** 从文件名提取扩展名（小写，不含点） */
function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

/** 根据扩展名获取文件图标 */
function getFileIcon(ext: string): React.ReactElement {
  const iconClass = 'size-3 shrink-0'
  if (IMAGE_EXTS.has(ext)) return <FileImage className={iconClass} />
  if (VIDEO_EXTS.has(ext)) return <FileVideo className={iconClass} />
  if (CODE_EXTS.has(ext)) return <FileCode className={iconClass} />
  return <FileText className={iconClass} />
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对） */
  filePath: string
  /** 基础目录路径（向后兼容，单值） */
  basePath?: string
  /** 多个候选基础目录（如主 cwd + 附加目录），点击时由主进程依次解析 */
  basePaths?: string[]
  className?: string
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, basePaths, className }: FilePathChipProps): React.ReactElement {
  const filename = getFileName(filePath)
  const ext = getExtension(filename)

  const trimmedPath = filePath.trim()
  const isAbsolute = trimmedPath.startsWith('/') || /^[A-Z]:\\/.test(trimmedPath)

  // 候选基础目录列表：优先使用 basePaths；否则退化到 basePath 单值
  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])

  // 用于 title 提示：绝对路径直接展示；相对路径展示首个候选拼接（仅作提示）
  const displayPath = React.useMemo(() => {
    if (isAbsolute) return trimmedPath
    if (candidateBases.length > 0) {
      const base = candidateBases[0]!
      return base.endsWith('/') ? `${base}${trimmedPath}` : `${base}/${trimmedPath}`
    }
    return trimmedPath
  }, [trimmedPath, isAbsolute, candidateBases])

  const handleClick = React.useCallback(() => {
    // 绝对路径直接预览；相对路径把候选 basePaths 交给主进程依次尝试
    const target = isAbsolute ? trimmedPath : trimmedPath
    const bases = isAbsolute ? undefined : (candidateBases.length > 0 ? candidateBases : undefined)
    window.electronAPI.previewFile(target, bases).catch((error: unknown) => {
      console.error('[FilePathChip] 预览文件失败:', error)
    })
  }, [trimmedPath, isAbsolute, candidateBases])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={displayPath}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-[2px] text-[12px] font-medium leading-[1.6]',
        'bg-primary/10 text-primary hover:bg-primary/20',
        'cursor-pointer transition-colors duration-150',
        'align-baseline not-prose',
        className
      )}
    >
      {getFileIcon(ext)}
      <span className="truncate max-w-[240px]">{filename}</span>
    </button>
  )
}

/**
 * 检测文本是否为绝对文件路径
 *
 * 匹配规则：
 * - macOS/Linux: 以 / 开头，至少两级路径
 * - Windows: 以 C:\ 等盘符开头
 */
export function isAbsoluteFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2) return false

  // macOS/Linux 绝对路径：以 / 开头，至少两级
  if (trimmed.startsWith('/') && /^\/[^\n]+\/[^\n]+$/.test(trimmed)) {
    // 排除常见的非路径模式（如 /regex/ 模式）
    if (trimmed.endsWith('/') && !trimmed.includes('.')) return false
    return true
  }

  // Windows 绝对路径
  if (/^[A-Z]:\\/.test(trimmed)) return true

  return false
}

/**
 * 检测文本是否为相对文件路径（需要 basePath 才有意义）
 *
 * 匹配规则：
 * - 含有可预览的文件扩展名
 * - 看起来像文件名或相对路径（不含空格、不含特殊字符）
 * - 排除常见的非路径 inline code（如命令、变量名等）
 */
export function isRelativeFilePath(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 3) return false

  // 提取扩展名
  const ext = getExtension(trimmed)
  if (!ext || !ALL_PREVIEWABLE_EXTS.has(ext)) return false

  // 必须看起来像文件路径：允许 字母数字、点、横线、下划线、斜杠
  // 排除含空格或特殊字符的（太可能是其他内容）
  if (!/^[\w./@-]+$/.test(trimmed)) return false

  // 排除以点开头的隐藏文件（如 .gitignore），但保留含子路径的目录相对路径（如 .context/file.md）
  if (trimmed.startsWith('.') && !trimmed.startsWith('./') && !trimmed.includes('/')) return false

  return true
}
