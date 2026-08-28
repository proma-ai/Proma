import { createRoot, type Root } from 'react-dom/client'
import katex from 'katex'
import { RangeSetBuilder, StateEffect, StateField, type Extension, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { highlightCode, highlightToTokens } from '@proma/core'
import type { HighlightTokensResult } from '@proma/core'
import { CodeBlock, MermaidBlock } from '@proma/ui'
import { shouldRenderMermaidCodeBlock } from '@/lib/mermaid-detection'
import { copyTextToClipboard } from '@/lib/clipboard'

type PreviewKind = 'code' | 'table' | 'mermaid' | 'thematic-break' | 'math'

interface PreviewBlock {
  kind: PreviewKind
  from: number
  to: number
  decoration: Decoration
}

interface FencedCodeBlock {
  language: string
  code: string
  from: number
  to: number
}

const shikiRefreshEffect = StateEffect.define<string>()
const shikiTokenCache = new Map<string, HighlightTokensResult>()
const SHIKI_CACHE_LIMIT = 160

function currentShikiTheme(): string {
  return document.documentElement.classList.contains('dark') ? 'github-dark' : 'github-light'
}

/** CodeMirror 会在状态事务期间销毁 widget；推迟 React root 卸载避免与并发渲染竞争。 */
function unmountRootAfterRender(root: Root | null): void {
  if (!root) return
  queueMicrotask(() => root.unmount())
}

function findFencedCodeBlocks(markdown: string): FencedCodeBlock[] {
  const lines = markdown.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) { starts.push(offset); offset += line.length + 1 }
  const blocks: FencedCodeBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = (lines[index] ?? '').match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!opening) continue
    const marker = opening[1]![0]!
    const length = opening[1]!.length
    let closing = index + 1
    while (closing < lines.length && !new RegExp(`^ {0,3}\\${marker}{${length},}\\s*$`).test(lines[closing] ?? '')) closing += 1
    if (closing >= lines.length) continue
    const from = starts[index + 1] ?? starts[closing] ?? markdown.length
    const closingFrom = starts[closing] ?? markdown.length
    blocks.push({ language: opening[2]?.trim().split(/\s+/)[0] ?? '', code: markdown.slice(from, Math.max(from, closingFrom - 1)), from, to: Math.max(from, closingFrom - 1) })
    index = closing
  }
  return blocks
}

function needsShikiLoad(language: string, result: HighlightTokensResult | null): boolean {
  return language !== 'text' && (!result || result.language === 'text')
}

function shikiTokens(code: string, language: string, theme: string): HighlightTokensResult | null {
  const key = `${theme}\u0000${language}\u0000${code}`
  const cached = shikiTokenCache.get(key)
  if (cached) return cached
  const result = highlightToTokens({ code, language, theme })
  if (result && !needsShikiLoad(language, result)) {
    shikiTokenCache.set(key, result)
    if (shikiTokenCache.size > SHIKI_CACHE_LIMIT) shikiTokenCache.delete(shikiTokenCache.keys().next().value!)
  }
  return result
}

function shikiDecorations(state: EditorState, theme: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of findFencedCodeBlocks(state.doc.toString())) {
    if (shouldRenderMermaidCodeBlock(block.language ? `language-${block.language}` : undefined, block.code)) continue
    const result = shikiTokens(block.code, block.language || 'text', theme)
    if (!result) continue
    let offset = block.from
    for (const [lineIndex, line] of result.lines.entries()) {
      for (const token of line) {
        const from = offset
        const to = Math.min(from + token.content.length, block.to)
        if (token.color && from < to) builder.add(from, to, Decoration.mark({ attributes: { style: `color: ${token.color}` } }))
        offset = to
      }
      if (lineIndex < result.lines.length - 1 && offset < block.to) offset += 1
    }
  }
  return builder.finish()
}

const shikiDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    const refresh = transaction.effects.find((effect) => effect.is(shikiRefreshEffect))
    return refresh ? shikiDecorations(transaction.state, refresh.value) : value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const liveMarkdownShikiHighlight: Extension = [
  shikiDecorationsField,
  ViewPlugin.fromClass(class {
    private pending = new Set<string>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private destroyed = false
    private theme = currentShikiTheme()
    private observer: MutationObserver
    constructor(private readonly view: EditorView) {
      this.observer = new MutationObserver(() => {
        const next = currentShikiTheme()
        if (next !== this.theme) { this.theme = next; this.refresh(0) }
      })
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      this.refresh(0)
    }
    update(update: { docChanged: boolean }): void { if (update.docChanged) this.refresh(120) }
    destroy(): void { this.destroyed = true; this.observer.disconnect(); if (this.timer) clearTimeout(this.timer) }
    private refresh(delay: number): void {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        const languages = new Set(findFencedCodeBlocks(this.view.state.doc.toString()).map((block) => block.language || 'text'))
        for (const language of languages) {
          const probe = highlightToTokens({ code: '', language, theme: this.theme })
          if (probe && !needsShikiLoad(language, probe)) continue
          const key = `${this.theme}:${language}`
          if (this.pending.has(key)) continue
          this.pending.add(key)
          void highlightCode({ code: '', language, theme: this.theme }).catch(() => {}).finally(() => {
            this.pending.delete(key)
            if (!this.destroyed) this.view.dispatch({ effects: shikiRefreshEffect.of(this.theme) })
          })
        }
        if (!this.destroyed) this.view.dispatch({ effects: shikiRefreshEffect.of(this.theme) })
      }, delay)
    }
  }),
]

interface PreviewState {
  activeLines: Set<number>
  blocks: PreviewBlock[]
  decorations: DecorationSet
}

function activeLines(state: EditorState): Set<number> {
  return new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.head).number))
}

function sameLines(left: Set<number>, right: Set<number>): boolean {
  return left.size === right.size && [...left].every((line) => right.has(line))
}

abstract class LiveMarkdownBlockWidget extends WidgetType {
  private observer: ResizeObserver | null = null

  protected observeSize(element: HTMLElement, view: EditorView): void {
    if (typeof ResizeObserver === 'undefined') return
    this.observer = new ResizeObserver(() => view.requestMeasure())
    this.observer.observe(element)
  }

  override destroy(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  override ignoreEvent(): boolean { return false }
}

class CodeBlockWidget extends LiveMarkdownBlockWidget {
  private root: Root | null = null
  constructor(
    private readonly code: string,
    private readonly language: string,
    private readonly from: number,
  ) { super() }
  override eq(other: CodeBlockWidget): boolean {
    return this.from === other.from && this.code === other.code && this.language === other.language
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'live-markdown-code-block'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    this.root = createRoot(wrapper)
    this.root.render(
      <CodeBlock onCopy={copyTextToClipboard}>
        <code className={this.language ? `language-${this.language}` : undefined}>{this.code}</code>
      </CodeBlock>,
    )
    this.observeSize(wrapper, view)
    return wrapper
  }
  override destroy(): void {
    super.destroy()
    unmountRootAfterRender(this.root)
    this.root = null
  }
}

class TableWidget extends LiveMarkdownBlockWidget {
  constructor(private readonly rows: string[][], private readonly from: number) { super() }
  override eq(other: TableWidget): boolean { return this.from === other.from && JSON.stringify(this.rows) === JSON.stringify(other.rows) }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'vault-markdown-table'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    const table = document.createElement('table')
    table.setAttribute('aria-label', 'Markdown 表格')
    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((value) => {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td')
        cell.textContent = value
        tr.appendChild(cell)
      })
      table.appendChild(tr)
    })
    wrapper.appendChild(table)
    this.observeSize(wrapper, view)
    return wrapper
  }
}

class HorizontalRuleWidget extends LiveMarkdownBlockWidget {
  constructor(private readonly from: number) { super() }
  override eq(other: HorizontalRuleWidget): boolean { return this.from === other.from }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'vault-horizontal-rule'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    wrapper.appendChild(document.createElement('hr'))
    this.observeSize(wrapper, view)
    return wrapper
  }
}

class MermaidWidget extends LiveMarkdownBlockWidget {
  private root: Root | null = null
  constructor(private readonly code: string, private readonly from: number) { super() }
  override eq(other: MermaidWidget): boolean { return this.from === other.from && this.code === other.code }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'vault-mermaid-block'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    this.root = createRoot(wrapper)
    this.root.render(<MermaidBlock code={this.code} />)
    this.observeSize(wrapper, view)
    return wrapper
  }
  override destroy(): void {
    super.destroy()
    unmountRootAfterRender(this.root)
    this.root = null
  }
}

class MathWidget extends LiveMarkdownBlockWidget {
  constructor(private readonly latex: string, private readonly from: number) { super() }
  override eq(other: MathWidget): boolean { return this.from === other.from && this.latex === other.latex }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'live-markdown-math-block'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    try {
      wrapper.innerHTML = katex.renderToString(this.latex, { displayMode: true, throwOnError: false })
    } catch {
      wrapper.textContent = this.latex
    }
    this.observeSize(wrapper, view)
    return wrapper
  }
}

class InlineMathWidget extends WidgetType {
  constructor(private readonly latex: string) { super() }
  override eq(other: InlineMathWidget): boolean { return this.latex === other.latex }
  override toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'live-markdown-math-inline'
    try {
      element.innerHTML = katex.renderToString(this.latex, { throwOnError: false })
    } catch {
      element.textContent = this.latex
    }
    return element
  }
  override ignoreEvent(): boolean { return false }
}

function splitTableRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false
  for (const character of content) {
    if (escaped) { cell += character; escaped = false }
    else if (character === '\\') escaped = true
    else if (character === '|') { cells.push(cell.trim()); cell = '' }
    else cell += character
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function buildBlocks(state: EditorState): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  const lines = Array.from({ length: state.doc.lines }, (_, index) => state.doc.line(index + 1).text)
  for (let number = 1; number <= lines.length; number += 1) {
    const line = lines[number - 1] ?? ''
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const marker = fence[1]![0]!
      const length = fence[1]!.length
      let closing = number + 1
      while (closing <= lines.length && !new RegExp(`^ {0,3}\\${marker}{${length},}\\s*$`).test(lines[closing - 1] ?? '')) closing += 1
      if (closing <= lines.length) {
        const info = fence[2]?.trim().split(/\s+/)[0] ?? ''
        const from = state.doc.line(number).from
        const to = state.doc.line(closing).to
        const code = lines.slice(number, closing - 1).join('\n')
        if (shouldRenderMermaidCodeBlock(info ? `language-${info}` : undefined, code)) {
          blocks.push({ kind: 'mermaid', from, to, decoration: Decoration.replace({ widget: new MermaidWidget(code, from), block: true }) })
        } else {
          blocks.push({ kind: 'code', from, to, decoration: Decoration.replace({ widget: new CodeBlockWidget(code, info, from), block: true }) })
        }
        number = closing
      }
      continue
    }
    if (line.trim() === '$$') {
      let closing = number + 1
      while (closing <= lines.length && (lines[closing - 1] ?? '').trim() !== '$$') closing += 1
      if (closing <= lines.length) {
        const from = state.doc.line(number).from
        const to = state.doc.line(closing).to
        blocks.push({ kind: 'math', from, to, decoration: Decoration.replace({ widget: new MathWidget(lines.slice(number, closing - 1).join('\n'), from), block: true }) })
        number = closing
      }
      continue
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      const from = state.doc.line(number).from
      blocks.push({ kind: 'thematic-break', from, to: state.doc.line(number).to, decoration: Decoration.replace({ widget: new HorizontalRuleWidget(from), block: true }) })
      continue
    }
    if (line.includes('|') && number < lines.length && isTableSeparator(lines[number] ?? '')) {
      let end = number + 1
      while (end < lines.length && (lines[end] ?? '').trim() && (lines[end] ?? '').includes('|')) end += 1
      const header = splitTableRow(line)
      const body = lines.slice(number + 1, end).map(splitTableRow)
      const width = Math.max(header.length, ...body.map((row) => row.length))
      const rows = [header, ...body].map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
      const from = state.doc.line(number).from
      blocks.push({ kind: 'table', from, to: state.doc.line(end).to, decoration: Decoration.replace({ widget: new TableWidget(rows, from), block: true }) })
      number = end
    }
  }
  return blocks
}

function buildDecorations(state: EditorState, blocks: PreviewBlock[], lines: Set<number>): DecorationSet {
  const entries: Array<{ from: number; to: number; decoration: Decoration }> = []
  const protectedRanges = blocks.map((block) => ({ from: block.from, to: block.to }))
  for (const block of blocks) {
    const first = state.doc.lineAt(block.from).number
    const last = state.doc.lineAt(block.to).number
    if (![...lines].some((line) => line >= first && line <= last)) entries.push(block)
  }
  for (let number = 1; number <= state.doc.lines; number += 1) {
    if (lines.has(number)) continue
    const line = state.doc.line(number)
    const pattern = /(^|[^\\])\$([^$\n]+)\$/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line.text)) !== null) {
      const markerOffset = match.index + match[1]!.length
      const from = line.from + markerOffset
      const to = from + match[0]!.length - match[1]!.length
      if (protectedRanges.some((range) => from >= range.from && to <= range.to)) continue
      entries.push({ from, to, decoration: Decoration.replace({ widget: new InlineMathWidget(match[2]!) }) })
    }
  }
  entries.sort((left, right) => left.from - right.from || left.to - right.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const entry of entries) builder.add(entry.from, entry.to, entry.decoration)
  return builder.finish()
}

/** Common live preview for block Markdown that ink-mde does not render itself. */
export const liveMarkdownBlockPreview: Extension = [
  liveMarkdownShikiHighlight,
  StateField.define<PreviewState>({
    create: (state) => {
      const lines = activeLines(state)
      const blocks = buildBlocks(state)
      return { activeLines: lines, blocks, decorations: buildDecorations(state, blocks, lines) }
    },
    update: (value, transaction) => {
      const lines = activeLines(transaction.state)
      if (!transaction.docChanged && sameLines(lines, value.activeLines)) return value
      const blocks = transaction.docChanged ? buildBlocks(transaction.state) : value.blocks
      return { activeLines: lines, blocks, decorations: buildDecorations(transaction.state, blocks, lines) }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  }),
  EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      const block = target?.closest<HTMLElement>('[data-live-markdown-block-from]')
      if (!block) return false
      // CodeBlock 的复制按钮必须在外层选区切换之前收到完整 click 序列。
      // 否则 mousedown 会把预览切回源码并卸载按钮，导致 click 永远无法触发。
      if (target?.closest('button, a, input, select, textarea, [role="button"]')) return true
      const from = Number(block.dataset.liveMarkdownBlockFrom)
      if (!Number.isSafeInteger(from)) return false
      event.preventDefault()
      view.dispatch({ selection: { anchor: from } })
      view.focus()
      return true
    },
  }),
]
