import MarkdownIt from 'markdown-it'
import { renderMarkdownMath } from '@/lib/markdown-math'
import { isLikelyLiveMarkdownLatex } from './live-markdown-table'

interface TableInlineEnvironment {
  breaks?: Array<{ from: number; to: number }>
}

// 表格单元格是编辑按钮的一部分：只渲染内联格式，不引入嵌套链接、图片或任意 HTML。
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
  .disable(['link', 'image', 'autolink'])

markdown.inline.ruler.before('escape', 'table_math', (state, silent) => {
  const remaining = state.src.slice(state.pos, state.posMax)
  const match = remaining.match(/^(?:\$([^$\n]+)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\])/)
  if (!match) return false
  if (!silent) {
    const token = state.push('table_math', '', 0)
    token.content = match[1] ?? match[2] ?? match[3] ?? ''
    token.block = Boolean(match[3])
  }
  state.pos += match[0].length
  return true
})

markdown.inline.ruler.before('html_inline', 'table_break', (state, silent) => {
  const match = state.src.slice(state.pos, state.posMax).match(/^<br\s*\/?>/i)
  if (!match) return false
  if (!silent) {
    state.push('hardbreak', 'br', 0)
    const environment = state.env as TableInlineEnvironment
    environment.breaks?.push({ from: state.pos, to: state.pos + match[0].length })
  }
  state.pos += match[0].length
  return true
})

function renderMath(latex: string, displayMode: boolean): string {
  const html = renderMarkdownMath(latex, displayMode)
  // 共享公式函数在异常时返回原文；此处的 HTML sink 必须将该 fallback 转义。
  const safeHtml = html === latex ? markdown.utils.escapeHtml(latex) : html
  return `<span class="live-markdown-table-math${displayMode ? ' is-display' : ''}">${safeHtml}</span>`
}

markdown.renderer.rules.table_math = (tokens, index) => {
  const token = tokens[index]!
  return renderMath(token.content, token.block)
}
markdown.renderer.rules.code_inline = (tokens, index) => {
  const value = tokens[index]!.content
  return isLikelyLiveMarkdownLatex(value)
    ? renderMath(value, false)
    : `<code>${markdown.utils.escapeHtml(value)}</code>`
}
markdown.renderer.rules.hardbreak = () => '<br>'
markdown.renderer.rules.softbreak = () => '<br>'

/** 仅转换语义换行；代码、公式、转义文本中的 <br> 保持原样，避免编辑后损坏内容。 */
export function liveMarkdownTableCellDraft(value: string): string {
  const breaks: NonNullable<TableInlineEnvironment['breaks']> = []
  markdown.parseInline(value, { breaks } satisfies TableInlineEnvironment)
  let draft = value
  for (const { from, to } of breaks.sort((a, b) => b.from - a.from)) {
    draft = draft.slice(0, from) + '\n' + draft.slice(to)
  }
  return draft.replace(/\r\n?/g, '\n')
}

export function renderLiveMarkdownTableInline(value: string): string {
  return markdown.renderInline(value)
}
