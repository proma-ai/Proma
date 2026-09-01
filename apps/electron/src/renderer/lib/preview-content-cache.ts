import type { FilePreviewMetadata } from '@proma/shared'

/** 单份文件预览的已解析内容，按 session、路径、version 与解析范围缓存。 */
export interface PreviewContentCacheEntry {
  oldContent: string
  newContent: string
  /** 非文本文件预览数据 */
  pdfSrc?: string
  imageDataUrl?: string
  imagePath?: string
  officeHtml?: string
  officeHtmlUrl?: string
  officeText?: string
  /** HTML 预览的目录级 token URL，允许加载同目录相对资源 */
  htmlPreviewUrl?: string
  /** 二进制或其他不可安全内联渲染的文件提示 */
  unsupportedPreviewReason?: string
  /** 无法内联预览时由主进程返回的安全基础元数据。 */
  previewMetadata?: FilePreviewMetadata
}

const CACHE_MAX = 50
const contentCache = new Map<string, PreviewContentCacheEntry>()

/** 读取并提升 LRU 热度。 */
export function getPreviewContentCache(key: string): PreviewContentCacheEntry | undefined {
  const value = contentCache.get(key)
  if (!value) return undefined
  contentCache.delete(key)
  contentCache.set(key, value)
  return value
}

/** 写入并按最近访问顺序限制预览缓存规模。 */
export function setPreviewContentCache(key: string, value: PreviewContentCacheEntry): void {
  if (contentCache.has(key)) contentCache.delete(key)
  contentCache.set(key, value)
  if (contentCache.size > CACHE_MAX) {
    const oldestKey = contentCache.keys().next().value
    if (oldestKey !== undefined) contentCache.delete(oldestKey)
  }
}

/** 清理一个会话的所有文件预览缓存。 */
export function clearPreviewContentCacheForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of contentCache.keys()) {
    if (key.startsWith(prefix)) contentCache.delete(key)
  }
}

/**
 * 清理一份纯文件预览的所有版本缓存。
 *
 * 关闭后重新打开会从 version 0 开始；若保留旧的 v0 条目，会把首开时的内容
 * 错当作当前磁盘内容。手动刷新也必须先清缓存，才能保证本次操作真正读盘。
 */
export function clearPreviewContentCacheForFile(sessionId: string, filePath: string): void {
  const prefix = `${sessionId}:preview:${filePath}@`
  for (const key of contentCache.keys()) {
    if (key.startsWith(prefix)) contentCache.delete(key)
  }
}
