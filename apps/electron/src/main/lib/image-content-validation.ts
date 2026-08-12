import type { ImageContent, TextContent } from '@earendil-works/pi-ai'

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false
  let offset = 8
  let hasIhdr = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const end = offset + 12 + length
    if (end > bytes.length) return false
    if (!hasIhdr) {
      if (type !== 'IHDR' || length !== 13) return false
      hasIhdr = true
    }
    if (type === 'IEND') return length === 0 && end === bytes.length
    offset = end
  }
  return false
}

const IMAGE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': isPng,
  'image/jpeg': (bytes) => bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9,
  'image/gif': (bytes) => bytes.length >= 14
    && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
    && bytes[bytes.length - 1] === 0x3b,
  'image/webp': (bytes) => bytes.length >= 16
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.readUInt32LE(4) + 8 === bytes.length
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
}

function decodeBase64(data: string): Buffer | undefined {
  const normalized = data.replace(/\s/g, '')
  if (!normalized || normalized.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return undefined
  const paddingIndex = normalized.indexOf('=')
  if (paddingIndex >= 0 && paddingIndex < normalized.length - (normalized.endsWith('==') ? 2 : 1)) return undefined

  try {
    return Buffer.from(normalized, 'base64')
  } catch {
    return undefined
  }
}

/** Returns whether bytes match the declared image MIME type supported by Pi tool results. */
export function isValidImageBytes(mimeType: string, bytes: Buffer): boolean {
  const matchesSignature = IMAGE_SIGNATURES[mimeType.trim().toLowerCase()]
  return bytes.length > 0 && Boolean(matchesSignature?.(bytes))
}

/** Reject empty, malformed, unsupported, or MIME-mismatched image content before Pi serializes it. */
export function isValidImageContent(content: ImageContent): boolean {
  if (typeof content.data !== 'string' || typeof content.mimeType !== 'string') return false
  const bytes = decodeBase64(content.data)
  return bytes !== undefined && isValidImageBytes(content.mimeType, bytes)
}

/**
 * Removes invalid image blocks while retaining the surrounding textual tool output.
 * The added text makes the failed visual result explicit without letting it poison
 * the persisted Pi transcript or a later provider request.
 */
export function sanitizeToolResultImageContent(
  content: Array<TextContent | ImageContent>,
): Array<TextContent | ImageContent> {
  const invalidImages = content.filter((block) => block.type === 'image' && !isValidImageContent(block)).length
  if (invalidImages === 0) return content

  const validContent = content.filter((block) => block.type !== 'image' || isValidImageContent(block))
  validContent.push({
    type: 'text',
    text: `已忽略 ${invalidImages} 个无效图片工具结果，未将其发送给模型。`,
  })
  return validContent
}

/**
 * Last-resort request boundary for Pi transcripts restored from disk. Fresh tool
 * results are sanitized earlier, but an old persisted transcript can otherwise
 * replay a bad image forever when the session is resumed.
 */
export function sanitizePiMessageImageContent<T extends { role?: unknown; content?: unknown }>(messages: T[]): T[] {
  return messages.map((message) => {
    if ((message.role !== 'user' && message.role !== 'toolResult') || !Array.isArray(message.content)) return message
    const sanitizedContent = sanitizeToolResultImageContent(
      message.content as Array<TextContent | ImageContent>,
    )
    return sanitizedContent === message.content ? message : { ...message, content: sanitizedContent }
  })
}
