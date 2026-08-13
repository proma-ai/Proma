/**
 * Repairs a narrow class of malformed strong delimiters commonly emitted by
 * models: `**Label:**value` and the escaped text left behind after rich-text
 * editing, `\*\*Label: \*\*value`.
 *
 * CommonMark treats a closing delimiter as invalid when it is directly
 * followed by a letter or number. The recovery is limited to label or sentence
 * endings so intentional literal asterisks retain their original meaning.
 */

const DIRECT_STRONG_RE = /(?<!\\)\*\*([^*\r\n]*?[,:;!?\u3002\uFF01\uFF1F\uFF1A\uFF1B\u3001\uFF09)\]\u3011}])\s*\*\*(?=[\p{L}\p{N}])/gu
const ESCAPED_STRONG_RE = /\\\*\\\*([^*\r\n]*?[,:;!?\u3002\uFF01\uFF1F\uFF1A\uFF1B\u3001\uFF09)\]\u3011}])\s*\\\*\\\*(?=[\p{L}\p{N}])/gu

function normalizeText(text: string): string {
  return text
    .replace(ESCAPED_STRONG_RE, (_match, content: string) => `**${content}** `)
    .replace(DIRECT_STRONG_RE, (_match, content: string) => `**${content}** `)
}

function normalizeInlineText(line: string): string {
  let normalized = ''
  let cursor = 0
  // Protect code, raw HTML tags, and Markdown link/image destinations. The
  // visible link label remains eligible for correction; only its destination
  // must retain byte-for-byte semantics.
  const protectedInline = /(`+)(.*?)\1|<\/?[A-Za-z][^>\r\n]*>|(!?\[[^\]\r\n]*\]\()((?:\\.|[^)\r\n])*)(\))/g

  for (const match of line.matchAll(protectedInline)) {
    const start = match.index ?? 0
    normalized += normalizeText(line.slice(cursor, start))

    if (match[3] !== undefined) {
      normalized += normalizeText(match[3]) + (match[4] ?? '') + (match[5] ?? '')
    } else {
      normalized += match[0]
    }

    cursor = start + match[0].length
  }

  return normalized + normalizeText(line.slice(cursor))
}

/**
 * Normalizes high-confidence malformed `**...**` sequences outside fenced,
 * indented, and inline code. Markdown preview and chat messages use this
 * function before parsing.
 */
export function normalizeMalformedStrongDelimiters(markdown: string): string {
  if (!markdown.includes('**') && !markdown.includes('\\*')) return markdown

  let inFence: { marker: '`' | '~'; length: number } | null = null

  return markdown.split('\n').map((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    const isCode = Boolean(inFence || fenceMatch || /^(?: {4}|\t)/.test(line))

    if (fenceMatch) {
      const markerText = fenceMatch[1] ?? ''
      const marker = markerText[0] as '`' | '~'
      if (!inFence) {
        inFence = { marker, length: markerText.length }
      } else if (marker === inFence.marker && markerText.length >= inFence.length) {
        inFence = null
      }
    }

    return isCode ? line : normalizeInlineText(line)
  }).join('\n')
}
