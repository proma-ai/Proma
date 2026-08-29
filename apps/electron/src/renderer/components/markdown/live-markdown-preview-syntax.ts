export type InlineLiveMarkdownPreview =
  | { kind: 'math' | 'autolink'; from: number; to: number; content: string }
  | { kind: 'image'; from: number; to: number; src: string; alt: string; title: string }

/** Returns the closing delimiter for supported display math, if this line opens a block. */
export function getDisplayMathClosingDelimiter(line: string): '$$' | '\\]' | null {
  const trimmed = line.trim()
  if (trimmed === '$$') return '$$'
  if (trimmed === '\\[') return '\\]'
  return null
}

const voidHtmlTags = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * Finds the last zero-based source line for an HTML block that starts on `start`.
 * This deliberately tracks only the opening tag name: it handles nested divs and
 * keeps Markdown outside a raw HTML block available to the normal renderer.
 */
export function findRawHtmlBlockEnd(lines: readonly string[], start: number): number | null {
  const first = lines[start]?.trim()
  if (!first || /^<https?:\/\//i.test(first)) return null
  const opening = /^<([a-z][\w:-]*)(?=\s|\/?>)[^>]*>/i.exec(first)
  if (!opening) return null
  const tag = opening[1]!.toLowerCase()
  if (voidHtmlTags.has(tag) || /\/>\s*$/.test(first)) return start

  const pattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
  let depth = 0
  for (let lineIndex = start; lineIndex < lines.length; lineIndex += 1) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(lines[lineIndex] ?? '')) !== null) {
      if (/^<\//.test(match[0])) depth -= 1
      else if (!/\/>$/.test(match[0])) depth += 1
      if (depth === 0) return lineIndex
    }
  }
  return null
}

/** Raw HTML must occupy a complete Markdown line before the live editor replaces it with a widget. */
export function isStandaloneRawMarkdownHtml(line: string): boolean {
  return findRawHtmlBlockEnd([line], 0) === 0
}

function isEscaped(source: string, offset: number): boolean {
  let slashCount = 0
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function inlineCodeRanges(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let opening: { from: number; length: number } | null = null
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '`' || isEscaped(source, index)) continue
    let end = index + 1
    while (source[end] === '`') end += 1
    const length = end - index
    if (!opening) opening = { from: index, length }
    else if (opening.length === length) {
      ranges.push({ from: opening.from, to: end })
      opening = null
    }
    index = end - 1
  }
  return ranges
}

function overlapsInlineCode(ranges: Array<{ from: number; to: number }>, from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

/**
 * Finds the inline syntaxes that ink-mde leaves literal in reading mode.
 * Ranges include the delimiters so CodeMirror can replace the complete source span.
 */
export function findInlineLiveMarkdownPreviews(line: string): InlineLiveMarkdownPreview[] {
  const previews: InlineLiveMarkdownPreview[] = []
  const codeRanges = inlineCodeRanges(line)
  const mathPatterns = [
    { pattern: /(^|[^\\])\$([^$\n]+)\$/g, contentIndex: 2, markerOffset: (match: RegExpExecArray) => match[1]!.length },
    { pattern: /\\\(([^\n]*?)\\\)/g, contentIndex: 1, markerOffset: () => 0 },
  ]

  for (const { pattern, contentIndex, markerOffset } of mathPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      const from = match.index + markerOffset(match)
      const to = from + match[0]!.length - markerOffset(match)
      if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
      previews.push({
        kind: 'math',
        from,
        to,
        content: match[contentIndex]!,
      })
    }
  }

  const imagePattern = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\)/g
  let image: RegExpExecArray | null
  while ((image = imagePattern.exec(line)) !== null) {
    const from = image.index
    const to = image.index + image[0]!.length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    previews.push({
      kind: 'image',
      from,
      to,
      src: image[2] ?? image[3] ?? '',
      alt: image[1] ?? '',
      title: image[4] ?? image[5] ?? image[6] ?? '',
    })
  }

  const autoLinkPattern = /<(https?:\/\/[^\s<>]+)>/g
  let autoLink: RegExpExecArray | null
  while ((autoLink = autoLinkPattern.exec(line)) !== null) {
    const from = autoLink.index
    const to = autoLink.index + autoLink[0]!.length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    previews.push({
      kind: 'autolink',
      from,
      to,
      content: autoLink[1]!,
    })
  }

  // 图片目标中可能包含尖括号 URL；优先保留完整图片范围，防止 replacement decorations 重叠。
  return previews
    .sort((left, right) => left.from - right.from || right.to - left.to)
    .filter((preview, index, sorted) => !sorted.slice(0, index).some((previous) => previous.from <= preview.from && previous.to >= preview.to))
}
