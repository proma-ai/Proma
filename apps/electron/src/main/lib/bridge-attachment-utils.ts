/**
 * Bridge 附件处理工具函数
 *
 * 为微信、钉钉、飞书等 Bridge 提供图片/文件的保存、类型推断、
 * 以及 <attached_files> XML 构建能力。
 */

import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, basename, relative } from 'node:path'
import { getAgentSessionWorkspacePath, resolveAgentSessionWorkspacePath } from './config-paths'

/** 图片大小警告阈值 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024

/** 允许的图片扩展名白名单 */
const SAFE_IMAGE_EXTENSIONS: Record<string, string> = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  svg: 'svg',
}

/**
 * 通过 magic bytes 推断图片 MIME 类型
 */
export function inferImageMediaType(buffer: Buffer): string {
  if (buffer.length < 4) return 'image/jpeg'

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg'
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png'
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif'
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp'
  }

  return 'image/jpeg'
}

/**
 * MIME 类型 → 文件扩展名（白名单，不识别的一律回退 jpg）
 */
export function inferExtension(mediaType: string): string {
  const sub = mediaType.split('/')[1]?.toLowerCase() ?? ''
  return SAFE_IMAGE_EXTENSIONS[sub] ?? 'jpg'
}

/**
 * 校验路径是否在目标目录内（防路径穿越）
 */
function ensurePathWithin(targetPath: string, parentDir: string): void {
  const resolved = resolve(targetPath)
  const resolvedParent = resolve(parentDir)
  const rel = relative(resolvedParent, resolved)
  if (rel.startsWith('..') || resolve(resolvedParent, rel) !== resolved) {
    throw new Error(`路径穿越: ${resolved} 超出 ${resolvedParent}`)
  }
}

/**
 * 清理文件名，移除路径分隔符和危险字符
 */
function sanitizeFileName(name: string): string {
  return basename(name).replace(/[/\\:*?"<>|]/g, '_')
}

/**
 * 保存图片到 Agent session 工作目录
 *
 * @returns 图片文件的绝对路径
 */
export function saveImageToSession(
  workspaceSlug: string,
  sessionId: string,
  fileNameHint: string,
  mediaType: string,
  data: Buffer,
): string {
  const sessionDir = getAgentSessionWorkspacePath(workspaceSlug, sessionId)
  const ext = inferExtension(mediaType)
  const filename = `${sanitizeFileName(fileNameHint)}.${ext}`
  const targetPath = join(sessionDir, filename)
  ensurePathWithin(targetPath, sessionDir)

  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(targetPath, data)
  console.log(`[Bridge 附件] 图片已保存: ${targetPath} (${data.length} bytes)`)

  return targetPath
}

/**
 * 保存文件到 Agent session 工作目录
 *
 * @returns 文件的绝对路径
 */
export function saveFileToSession(
  workspaceSlug: string,
  sessionId: string,
  fileName: string,
  data: Buffer,
): string {
  const sessionDir = getAgentSessionWorkspacePath(workspaceSlug, sessionId)
  const targetPath = join(sessionDir, sanitizeFileName(fileName))
  ensurePathWithin(targetPath, sessionDir)

  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(targetPath, data)
  console.log(`[Bridge 附件] 文件已保存: ${targetPath} (${data.length} bytes)`)

  return targetPath
}

/**
 * 构建 <attached_files> XML 块
 *
 * 返回空字符串表示无附件。
 */
export function buildAttachedFilesBlock(refs: Array<{ label: string; path: string }>): string {
  if (refs.length === 0) return ''
  const lines = refs.map(r => `- ${r.label}: ${r.path}`)
  return `<attached_files>\n${lines.join('\n')}\n</attached_files>\n\n`
}

/** 文件树渲染时忽略的非点前缀条目（点文件统一由 startsWith('.') 过滤） */
const FILE_TREE_IGNORE = new Set(['node_modules'])

/** 文件树展示选项 */
interface FileTreeOptions {
  /** 目录图标，默认 '📁 ' */
  dirIcon?: string
  /** 文件图标，默认 '📄 ' */
  fileIcon?: string
  /** 最大递归深度（根为 0），默认 3 */
  maxDepth?: number
  /** 总条目上限，默认 50 */
  maxEntries?: number
}

// 树形连接符。用全角空格（U+3000）做对齐，避免飞书 markdown 折叠连续半角空格。
const TREE_BRANCH = '├─　'   // 非末尾节点
const TREE_LAST = '└─　'     // 末尾节点
const TREE_VERTICAL = '│　'  // 祖先分支延续
const TREE_BLANK = '　　' // 祖先分支已结束

/** 触达条目上限时的提示文案 */
const TREE_TRUNCATED_NOTICE = '（由于到达显示上限，文件夹子内容不在此展开）'

function walkFileTree(
  dir: string,
  depth: number,
  ancestorPrefix: string,
  opts: Required<FileTreeOptions>,
  out: string[],
  counter: { count: number; truncated: boolean },
): void {
  if (depth > opts.maxDepth) return
  if (counter.truncated) return

  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  const visible = entries
    .filter((e) => !e.name.startsWith('.') && !FILE_TREE_IGNORE.has(e.name))
    // 目录在前，同类按名称排序
    .sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1
      const bd = b.isDirectory() ? 0 : 1
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name)
    })

  for (let i = 0; i < visible.length; i++) {
    const e = visible[i]
    if (!e) continue
    if (counter.count >= opts.maxEntries) {
      // 触达上限：停止展开，由顶层统一追加单次提示
      counter.truncated = true
      return
    }
    const isLast = i === visible.length - 1
    counter.count++
    const connector = isLast ? TREE_LAST : TREE_BRANCH
    if (e.isDirectory()) {
      out.push(`${ancestorPrefix}${connector}${opts.dirIcon}${e.name}/`)
      const childPrefix = ancestorPrefix + (isLast ? TREE_BLANK : TREE_VERTICAL)
      walkFileTree(join(dir, e.name), depth + 1, childPrefix, opts, out, counter)
      if (counter.truncated) return
    } else {
      out.push(`${ancestorPrefix}${connector}${opts.fileIcon}${e.name}`)
    }
  }
}

/**
 * 递归构建任意目录的文件树文本行
 *
 * 用树形连接符（├─ └─ │）体现文件夹-文件层级。
 * 过滤所有点文件（.context、.claude、.git 等）及 node_modules。
 * 每行以可见字符开头、用全角空格对齐，避免 markdown 折叠行首/连续空格。
 * 条目数触达上限时停止展开并在末尾追加单次提示。
 *
 * @returns 文本行数组；目录不存在/为空时返回空数组
 */
export function buildFileTree(rootDir: string, options: FileTreeOptions = {}): string[] {
  const opts: Required<FileTreeOptions> = {
    dirIcon: options.dirIcon ?? '📁 ',
    fileIcon: options.fileIcon ?? '📄 ',
    maxDepth: options.maxDepth ?? 3,
    maxEntries: options.maxEntries ?? 50,
  }
  const out: string[] = []
  const counter = { count: 0, truncated: false }
  walkFileTree(rootDir, 0, '', opts, out, counter)
  if (counter.truncated) {
    out.push(TREE_TRUNCATED_NOTICE)
  }
  return out
}

/**
 * 构建会话目录的文件树文本行
 *
 * 递归遍历 ~/.proma/agent-workspaces/{slug}/{sessionId}/（只读，不创建目录）。
 *
 * @returns 文本行数组；目录不存在/无可见文件时返回空数组
 */
export function buildSessionFileTree(
  workspaceSlug: string,
  sessionId: string,
  options: FileTreeOptions = {},
): string[] {
  const sessionDir = resolveAgentSessionWorkspacePath(workspaceSlug, sessionId)
  return buildFileTree(sessionDir, options)
}
