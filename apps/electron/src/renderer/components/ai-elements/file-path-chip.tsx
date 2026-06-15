/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后按用户偏好（标签页 / 侧边分屏）打开文件预览。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'

/** 文件存在性缓存（模块级共享，避免重复 IPC）。key = filePath + basePaths */
const fileExistsCache = new Map<string, boolean>()
function existsCacheKey(filePath: string, bases: string[]): string {
  return `${filePath}\0${bases.join('\0')}`
}

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

/**
 * 从路径中剥离末尾的行号/列号后缀（如 :42 或 :42:15）
 * Agent 模式下模型常输出 file_path:line_number 格式
 */
function stripLineCol(filePath: string): { path: string; suffix: string } {
  const m = filePath.match(/^(.+?)(:\d+(?::\d+)?)$/)
  if (m && !m[1]!.endsWith(':')) {
    return { path: m[1]!, suffix: m[2]! }
  }
  return { path: filePath, suffix: '' }
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对，可能带行号后缀） */
  filePath: string
  /** 基础目录路径（向后兼容，单值） */
  basePath?: string
  /** 多个候选基础目录（如主 cwd + 附加目录），点击时由主进程依次解析 */
  basePaths?: string[]
  className?: string
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, basePaths, className }: FilePathChipProps): React.ReactElement {
  const trimmedPath = filePath.trim()
  const { path: cleanPath, suffix: lineColSuffix } = stripLineCol(trimmedPath)

  const filename = getFileName(cleanPath)

  const isAbsolute = cleanPath.startsWith('/') || /^[A-Z]:\\/.test(cleanPath)

  const chipRef = React.useRef<HTMLButtonElement>(null)
  const [fileStatus, setFileStatus] = React.useState<'idle' | 'resolved' | 'broken'>('idle')
  const store = useStore()
  const openPreview = useOpenPreview()

  // 候选基础目录列表：优先使用 basePaths；否则退化到 basePath 单值
  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])

  // 用于 title 提示：绝对路径直接展示；相对路径优先匹配首段对应的 base 目录
  const displayPath = React.useMemo(() => {
    if (isAbsolute) return trimmedPath
    if (candidateBases.length > 0) {
      const firstSegment = cleanPath.split('/')[0]
      if (firstSegment) {
        for (const base of candidateBases) {
          const baseName = base.endsWith('/') ? base.slice(0, -1).split('/').pop() : base.split('/').pop()
          if (baseName === firstSegment) {
            const parentDir = base.endsWith('/')
              ? base.slice(0, base.slice(0, -1).lastIndexOf('/'))
              : base.slice(0, base.lastIndexOf('/'))
            return parentDir.endsWith('/') ? `${parentDir}${cleanPath}` : `${parentDir}/${cleanPath}`
          }
        }
      }
      const base = candidateBases[0]!
      return base.endsWith('/') ? `${base}${cleanPath}` : `${base}/${cleanPath}`
    }
    return trimmedPath
  }, [trimmedPath, cleanPath, isAbsolute, candidateBases])

  // IntersectionObserver 懒检查文件是否存在
  React.useEffect(() => {
    const el = chipRef.current
    if (!el) return

    const key = existsCacheKey(cleanPath, candidateBases)
    if (fileExistsCache.has(key)) {
      setFileStatus(fileExistsCache.get(key) ? 'resolved' : 'broken')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        const bases = candidateBases.length > 0 ? candidateBases : undefined
        const sessionId = store.get(currentAgentSessionIdAtom)
        window.electronAPI.resolveFilePath(cleanPath, { sessionId: sessionId ?? undefined, candidateBasePaths: bases })
          .then((resolved) => {
            const exists = resolved !== null
            fileExistsCache.set(key, exists)
            setFileStatus(exists ? 'resolved' : 'broken')
          })
          .catch(() => { /* IPC 失败不标记 */ })
      },
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [cleanPath, candidateBases, store])

  const handleClick = React.useCallback(() => {
    const sessionId = store.get(currentAgentSessionIdAtom)
    if (!sessionId) return

    openPreview(sessionId, {
      filePath: cleanPath,
      previewOnly: true,
      basePaths: candidateBases.length > 0 ? candidateBases : undefined,
    })
  }, [store, openPreview, cleanPath, candidateBases])

  const handleShowInFolder = React.useCallback(() => {
    const bases = candidateBases.length > 0 ? candidateBases : undefined
    window.electronAPI.showItemInFolder(cleanPath, bases).catch(console.error)
  }, [cleanPath, candidateBases])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={chipRef}
          type="button"
          onClick={handleClick}
          title={fileStatus === 'broken' ? `文件不存在: ${displayPath}` : displayPath}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-[2px] text-[12px] font-medium leading-[1.6]',
            'cursor-pointer transition-colors duration-150',
            'align-baseline not-prose',
            fileStatus === 'broken'
              ? 'opacity-50 border border-dashed border-muted-foreground/30 text-muted-foreground hover:opacity-70 hover:bg-muted/20'
              : 'bg-primary/10 text-primary hover:bg-primary/20',
            className
          )}
        >
          <FileTypeIcon name={filename} isDirectory={false} size={14} />
          <span className="truncate max-w-[240px]">{filename}{lineColSuffix}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={handleClick}>
          打开预览
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleShowInFolder}>
          在文件管理器中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

  // 剥离末尾行号后缀再检测
  const { path: clean } = stripLineCol(trimmed)

  // macOS/Linux 绝对路径：以 / 开头，至少两级
  if (clean.startsWith('/') && /^\/[^\n]+\/[^\n]+$/.test(clean)) {
    // 排除常见的非路径模式（如 /regex/ 模式）
    if (clean.endsWith('/') && !clean.includes('.')) return false
    return true
  }

  // Windows 绝对路径
  if (/^[A-Z]:\\/.test(clean)) return true

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

  // 剥离末尾行号后缀再检测
  const { path: clean } = stripLineCol(trimmed)

  // 提取扩展名
  const ext = getExtension(clean)
  if (!ext || !ALL_PREVIEWABLE_EXTS.has(ext)) return false

  // 必须看起来像文件路径：允许 字母数字、点、横线、下划线、斜杠
  // 排除含空格或特殊字符的（太可能是其他内容）
  if (!/^[\w./@-]+$/.test(clean)) return false

  // 排除以点开头的隐藏文件（如 .gitignore），但保留含子路径的目录相对路径（如 .context/file.md）
  if (clean.startsWith('.') && !clean.startsWith('./') && !clean.includes('/')) return false

  return true
}
