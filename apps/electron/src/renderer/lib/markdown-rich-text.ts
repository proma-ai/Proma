import MarkdownIt from 'markdown-it'

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:[?#].*)?$/i
const PREVIEW_BLOCK_RE = /^<div\s+[^>]*data-type=(["'])(?:markdown-table|raw-html-block|math-block)\1/i
const DETAILS_BLOCK_RE = /<details(\s[^>]*)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi

export const MARKDOWN_RENDERER_VERSION = 2

const EMOJI_SHORTCODES: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  clap: '👏',
  confused: '😕',
  cry: '😢',
  heart: '❤️',
  joy: '😂',
  laugh: '😆',
  ok_hand: '👌',
  rocket: '🚀',
  smile: '😄',
  sob: '😭',
  tada: '🎉',
  thinking: '🤔',
  thumbsup: '👍',
  thumbsdown: '👎',
  warning: '⚠️',
}

function escapeAttr(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
}

function isPreviewBlockHtml(value: string): boolean {
  return PREVIEW_BLOCK_RE.test(value.trim())
}

function addMathSupport(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', (state: any, silent: boolean) => {
    const start = state.pos
    if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24) return false

    let end = start + 1
    while ((end = state.src.indexOf('$', end)) !== -1) {
      if (state.src.charCodeAt(end - 1) !== 0x5c) break
      end += 1
    }
    if (end === -1 || end === start + 1) return false

    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = state.src.slice(start + 1, end)
    }
    state.pos = end + 1
    return true
  })

  md.block.ruler.after('blockquote', 'math_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const firstLine = state.src.slice(start, max)
    if (!firstLine.startsWith('$$')) return false

    if (silent) return true

    let nextLine = startLine + 1
    let content = firstLine.slice(2)
    const sameLineEnd = content.lastIndexOf('$$')
    if (sameLineEnd > 0) {
      content = content.slice(0, sameLineEnd)
    } else {
      const lines: string[] = []
      if (content.trim()) lines.push(content)
      for (; nextLine < endLine; nextLine++) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineMax = state.eMarks[nextLine]
        const line = state.src.slice(lineStart, lineMax)
        const end = line.indexOf('$$')
        if (end >= 0) {
          lines.push(line.slice(0, end))
          nextLine += 1
          break
        }
        lines.push(line)
      }
      content = lines.join('\n')
    }

    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = content.trim()
    state.line = nextLine
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  md.renderer.rules.math_inline = (tokens, idx) => (
    `<span data-type="math-inline" data-latex="${escapeAttr(tokens[idx]?.content ?? '')}"></span>`
  )
  md.renderer.rules.math_block = (tokens, idx) => (
    `<div data-type="math-block" data-latex="${escapeAttr(tokens[idx]?.content ?? '')}"></div>\n`
  )
}

const markdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
})

addMathSupport(markdownIt)

markdownIt.core.ruler.after('inline', 'emoji_shortcode', (state: any) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue
    for (const child of token.children) {
      if (child.type !== 'text') continue
      child.content = child.content.replace(/:([a-z0-9_+-]+):/gi, (raw: string, name: string) => (
        EMOJI_SHORTCODES[name] ?? raw
      ))
    }
  }
})

markdownIt.renderer.rules.html_block = (tokens, idx) => {
  const content = (tokens[idx]?.content ?? '').trim()
  if (!content) return ''
  if (isPreviewBlockHtml(content)) return `${content}\n`
  return `<div data-type="raw-html-block" data-markdown="${escapeAttr(content)}" data-html="${escapeAttr(content)}"></div>\n`
}

markdownIt.renderer.rules.html_inline = (tokens, idx) => (
  `<span data-type="raw-html-inline" data-html="${escapeAttr(tokens[idx]?.content ?? '')}"></span>`
)

markdownIt.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''
  const src = token.attrGet('src') || ''
  const title = token.attrGet('title') || ''
  const alt = token.content || ''

  if (VIDEO_EXT_RE.test(src)) {
    return `<video data-type="markdown-video" src="${escapeAttr(src)}" title="${escapeAttr(alt || title)}" controls></video>`
  }

  const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr}>`
}

function isMarkdownTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false

  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isMarkdownTableHeader(line: string, nextLine?: string): boolean {
  return Boolean(nextLine && line.includes('|') && isMarkdownTableDelimiter(nextLine))
}

function wrapMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n')
  const nextLines: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (!isMarkdownTableHeader(line, lines[i + 1])) {
      nextLines.push(line)
      continue
    }

    const tableLines = [line, lines[i + 1] ?? '']
    i += 2
    while (i < lines.length && (lines[i] ?? '').trim() && (lines[i] ?? '').includes('|')) {
      tableLines.push(lines[i] ?? '')
      i += 1
    }
    i -= 1

    const tableMarkdown = tableLines.join('\n')
    const tableHtml = markdownIt.render(tableMarkdown).trim()
    nextLines.push(
      `<div data-type="markdown-table" data-markdown="${escapeAttr(tableMarkdown)}" data-html="${escapeAttr(tableHtml)}"></div>`,
    )
  }

  return nextLines.join('\n')
}

function wrapMarkdownDetailsBlocks(markdown: string): string {
  return markdown.replace(DETAILS_BLOCK_RE, (raw: string, attrs = '', summary: string, body: string) => {
    const bodyMarkdown = body.trim()
    const bodyHtml = bodyMarkdown ? markdownIt.render(bodyMarkdown) : ''
    const detailsHtml = `<details${attrs}><summary>${summary.trim()}</summary>${bodyHtml}</details>`
    return `<div data-type="raw-html-block" data-markdown="${escapeAttr(raw.trim())}" data-html="${escapeAttr(detailsHtml)}"></div>`
  })
}

function preprocessMarkdown(markdown: string): string {
  return wrapMarkdownTables(wrapMarkdownDetailsBlocks(markdown))
}

function enhanceMarkdownHtml(html: string): string {
  if (typeof document === 'undefined') return html

  const root = document.createElement('div')
  root.innerHTML = html

  for (const li of Array.from(root.querySelectorAll('li'))) {
    const first = li.firstChild
    const textNode = first?.nodeType === Node.TEXT_NODE
      ? first
      : first instanceof HTMLElement && first.tagName.toLowerCase() === 'p' && first.firstChild?.nodeType === Node.TEXT_NODE
        ? first.firstChild
        : null
    const text = textNode?.textContent ?? ''
    const match = text.match(/^\s*\[([ xX])\]\s*/)
    if (!match || !textNode) continue

    textNode.textContent = text.slice(match[0].length)
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', (match[1] ?? '').toLowerCase() === 'x' ? 'true' : 'false')
    li.parentElement?.setAttribute('data-type', 'taskList')
  }

  for (const table of Array.from(root.querySelectorAll('table'))) {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-type', 'markdown-table')
    wrapper.dataset.html = table.outerHTML
    table.replaceWith(wrapper)
  }

  return root.innerHTML
}

export function markdownToHtml(markdown: string): string {
  if (!markdown) return ''
  return enhanceMarkdownHtml(markdownIt.render(preprocessMarkdown(markdown)))
}

/** 将 TipTap 输出的 HTML 转换为 Markdown 格式 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return ''

  const div = document.createElement('div')
  div.innerHTML = html

  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }

    const el = node as HTMLElement
    const tagName = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(processNode).join('')

    switch (tagName) {
      case 'div':
        if (el.getAttribute('data-type') === 'markdown-table') {
          const tableMarkdown = el.getAttribute('data-markdown')
          if (tableMarkdown !== null) return `${tableMarkdown}\n`

          const tableHtml = el.getAttribute('data-html') || ''
          const holder = document.createElement('div')
          holder.innerHTML = tableHtml
          const table = holder.querySelector('table')
          return table ? processNode(table) : ''
        }
        if (el.getAttribute('data-type') === 'raw-html-block') {
          const htmlMarkdown = el.getAttribute('data-markdown')
          if (htmlMarkdown !== null) return `${htmlMarkdown}\n`

          return `${el.getAttribute('data-html') || ''}\n`
        }
        if (el.getAttribute('data-type') === 'math-block') {
          return `$$\n${el.getAttribute('data-latex') || ''}\n$$\n`
        }
        return children
      case 'img': {
        const src = el.getAttribute('src') || ''
        const alt = el.getAttribute('alt') || ''
        const title = el.getAttribute('title') || ''
        return `![${alt}](${src}${title ? ` "${title}"` : ''})`
      }
      case 'video': {
        const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || ''
        const title = el.getAttribute('title') || ''
        return `<video controls src="${src}"${title ? ` title="${title}"` : ''}></video>\n`
      }
      case 'p':
        return children + '\n\n'
      case 'br':
        return '\n'
      case 'strong':
      case 'b':
        return `**${children}**`
      case 'em':
      case 'i':
        return `*${children}*`
      case 'u':
        return `<u>${children}</u>`
      case 's':
      case 'strike':
      case 'del':
        return `~~${children}~~`
      case 'code':
        if (el.parentElement?.tagName.toLowerCase() === 'pre') {
          return children
        }
        return `\`${children}\``
      case 'pre': {
        const codeEl = el.querySelector('code')
        const langClass = codeEl?.className || ''
        const langMatch = langClass.match(/language-(\w+)/)
        const lang = langMatch ? langMatch[1] : ''
        const codeContent = codeEl ? processNode(codeEl) : children
        return `\`\`\`${lang}\n${codeContent}\n\`\`\`\n`
      }
      case 'a': {
        const href = el.getAttribute('href') || ''
        return `[${children}](${href})`
      }
      case 'ul':
        if (el.getAttribute('data-type') === 'taskList') {
          return Array.from(el.children)
            .map((li) => {
              const checked = li.getAttribute('data-checked') === 'true' ? 'x' : ' '
              return `- [${checked}] ${processNode(li).trim()}`
            })
            .join('\n') + '\n'
        }
        return Array.from(el.children)
          .map((li) => `- ${processNode(li).trim()}`)
          .join('\n') + '\n'
      case 'ol':
        return Array.from(el.children)
          .map((li, i) => `${i + 1}. ${processNode(li).trim()}`)
          .join('\n') + '\n'
      case 'li':
        return children
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr')).map((row) =>
          Array.from(row.children).map((cell) => processNode(cell).trim().replace(/\n+/g, ' '))
        ).filter((row) => row.length > 0)
        if (rows.length === 0) return ''
        const columnCount = Math.max(...rows.map((row) => row.length))
        const normalize = (row: string[]) => Array.from({ length: columnCount }, (_, i) => row[i] ?? '')
        const [head, ...body] = rows.map(normalize)
        if (!head) return ''
        return [
          `| ${head.join(' | ')} |`,
          `| ${head.map(() => '---').join(' | ')} |`,
          ...body.map((row) => `| ${row.join(' | ')} |`),
        ].join('\n') + '\n'
      }
      case 'th':
      case 'td':
        return children
      case 'blockquote':
        return children
          .replace(/\n+$/, '')
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') + '\n'
      case 'h1': return `# ${children}\n`
      case 'h2': return `## ${children}\n`
      case 'h3': return `### ${children}\n`
      case 'h4': return `#### ${children}\n`
      case 'h5': return `##### ${children}\n`
      case 'h6': return `###### ${children}\n`
      case 'hr': return '---\n'
      case 'span': {
        if (el.getAttribute('data-type') === 'raw-html-inline') {
          return el.getAttribute('data-html') || ''
        }
        if (el.getAttribute('data-type') === 'math-inline') {
          return `$${el.getAttribute('data-latex') || ''}$`
        }
        const dataType = el.getAttribute('data-type')
        const dataId = el.getAttribute('data-id') || ''
        const suggestionChar = el.getAttribute('data-mention-suggestion-char') || '@'
        if (dataType === 'mention') {
          if (suggestionChar === '/') return `/skill:${dataId}`
          if (suggestionChar === '#') return `#mcp:${dataId}`
          if (suggestionChar === '&') return `&session:${dataId}`
          return `@file:${dataId}`
        }
        return children
      }
      default: return children
    }
  }

  return processNode(div).trim()
}
