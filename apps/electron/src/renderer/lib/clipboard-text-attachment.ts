import type { AgentPendingFile } from '@proma/shared'

export interface ClipboardTextDraft {
  filename: string
  mediaType: string
  size: number
}

export function makeUniqueAttachmentName(originalName: string, existingNames: string[]): string {
  if (!existingNames.includes(originalName)) return originalName
  const dotIdx = originalName.lastIndexOf('.')
  const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : ''
  let counter = 1
  while (existingNames.includes(`${baseName}-${counter}${ext}`)) {
    counter++
  }
  return `${baseName}-${counter}${ext}`
}

export function createClipboardTextDraft(text: string, existingNames: string[], now = new Date()): ClipboardTextDraft {
  const isMarkdown = looksLikeMarkdown(text)
  const extension = isMarkdown ? 'md' : 'txt'
  const mediaType = isMarkdown ? 'text/markdown' : 'text/plain'
  const filename = makeUniqueAttachmentName(`clipboard-${formatClipboardTimestamp(now)}.${extension}`, existingNames)
  const size = new TextEncoder().encode(text).byteLength
  return { filename, mediaType, size }
}

export function createClipboardPendingFile(draft: ClipboardTextDraft, sourcePath: string, id: string): AgentPendingFile {
  return {
    id,
    filename: draft.filename,
    mediaType: draft.mediaType,
    size: draft.size,
    // 临时文件是待发送长文本的唯一真实数据源；预览/外部编辑后发送端读取该路径最新内容拷贝进 session。
    sourcePath,
    isClipboardDraft: true,
  }
}

function formatClipboardTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function looksLikeMarkdown(text: string): boolean {
  return [
    /^#{1,6}\s+\S/m,
    /```[\s\S]*?```/,
    /^\s*\|.+\|\s*\n\s*\|[\s:-]+\|/m,
    /^---\n[\s\S]*?\n---\n/,
    /^\s*> .+/m,
    /^\s*[-*+]\s+\S/m,
    /^\s*\d+\.\s+\S/m,
    /\[[^\]]+\]\([^)]+\)/,
  ].some((pattern) => pattern.test(text))
}
