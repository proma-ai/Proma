import { createRoot, type Root } from 'react-dom/client'
import DOMPurify from 'dompurify'
import { RangeSetBuilder, StateEffect, StateField, type Extension, type EditorState } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import { highlightCode, highlightToTokens } from '@proma/core'
import type { HighlightTokensResult } from '@proma/core'
import { CodeBlock, MermaidBlock } from '@proma/ui'
import { shouldRenderMermaidCodeBlock } from '@/lib/mermaid-detection'
import { copyTextToClipboard } from '@/lib/clipboard'
import { renderMarkdownMath } from '@/lib/markdown-math'
import {
  findInlineLiveMarkdownPreviews,
  findRawHtmlBlockEnd,
  getDisplayMathClosingDelimiter,
} from './live-markdown-preview-syntax'
import {
  isLiveMarkdownTableSeparator,
  parseLiveMarkdownTable,
  serializeLiveMarkdownTable,
  type LiveMarkdownTable,
} from './live-markdown-table'
import { LiveMarkdownTableEditor } from './LiveMarkdownTableEditor'
import { getLeadingFrontmatter, type LiveMarkdownPropertyEntry } from './live-markdown-frontmatter'

type PreviewKind = 'code' | 'table' | 'frontmatter' | 'mermaid' | 'thematic-break' | 'math' | 'raw-html'

export type ResolveLiveMarkdownImageSrc = (src: string) => Promise<string | null>
export type SaveLiveMarkdownPastedImage = (file: File) => Promise<string | null>
export type { LiveMarkdownPropertyEntry } from './live-markdown-frontmatter'
export type ChangeLiveMarkdownProperties = (entries: LiveMarkdownPropertyEntry[], documentValue?: string) => void

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

  override ignoreEvent(_event?: Event): boolean { return false }
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
  private root: Root | null = null

  constructor(
    private readonly table: LiveMarkdownTable,
    private readonly from: number,
    private readonly to: number,
  ) { super() }

  override eq(other: TableWidget): boolean {
    return this.from === other.from && this.to === other.to && JSON.stringify(this.table) === JSON.stringify(other.table)
  }

  override ignoreEvent(): boolean { return true }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'live-markdown-table-editor-root'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    wrapper.dataset.liveMarkdownBlockKind = 'table'
    this.root = createRoot(wrapper)
    const onMeasure = () => view.requestMeasure()
    this.root.render(
      <LiveMarkdownTableEditor
        table={this.table}
        readOnly={view.state.readOnly}
        onMeasure={onMeasure}
        onCommit={(nextTable, focusCell) => {
          if (view.state.readOnly) return
          const nextSource = serializeLiveMarkdownTable(nextTable)
          const currentBlock = buildBlocks(view.state).find((block) => block.kind === 'table' && block.from === this.from)
          if (!currentBlock) return
          view.dispatch({ changes: { from: currentBlock.from, to: currentBlock.to, insert: nextSource } })
          if (focusCell) requestAnimationFrame(() => {
            const target = view.dom.querySelector<HTMLButtonElement>(`[data-live-markdown-table-cell="${focusCell.row}:${focusCell.column}"]`)
            target?.focus()
            target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          })
        }}
      />,
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

class FrontmatterWidget extends LiveMarkdownBlockWidget {
  constructor(
    private readonly entries: LiveMarkdownPropertyEntry[],
    private readonly from: number,
    private readonly onChange?: ChangeLiveMarkdownProperties,
  ) { super() }

  override eq(other: FrontmatterWidget): boolean {
    return this.from === other.from && JSON.stringify(this.entries) === JSON.stringify(other.entries)
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('section')
    wrapper.className = 'vault-properties'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    wrapper.dataset.liveMarkdownBlockKind = 'frontmatter'
    wrapper.setAttribute('aria-label', 'Properties')

    const heading = document.createElement('div')
    heading.className = 'vault-properties-heading'
    const title = document.createElement('span')
    title.textContent = 'Properties'
    const count = document.createElement('span')
    count.className = 'vault-properties-count'
    count.textContent = `${this.entries.length} 个字段`
    heading.append(title, count)
    wrapper.appendChild(heading)

    const list = document.createElement('div')
    list.className = 'vault-properties-list'
    this.entries.forEach((entry, index) => {
      const dateValue = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-]+)?$/.test(entry.value)
      const row = document.createElement('div')
      row.className = 'vault-property-row'

      const icon = document.createElement('span')
      icon.className = `vault-property-icon ${dateValue ? 'vault-property-icon-date' : 'vault-property-icon-text'}`
      icon.setAttribute('aria-hidden', 'true')

      const key = document.createElement(this.onChange ? 'input' : 'span')
      key.className = `vault-property-key${this.onChange ? ' vault-property-input' : ''}`
      if (key instanceof HTMLInputElement) {
        key.value = entry.key
        key.setAttribute('aria-label', `Property ${entry.key} 名称`)
        key.spellcheck = false
      } else {
        key.textContent = entry.key
      }

      const value = document.createElement(this.onChange ? 'input' : 'span')
      value.className = `vault-property-value${this.onChange ? ' vault-property-input' : ''}${dateValue ? ' vault-property-value-date' : ''}`
      if (value instanceof HTMLInputElement) {
        value.value = entry.value
        value.setAttribute('aria-label', `${entry.key} 属性值`)
        value.spellcheck = false
      } else {
        value.textContent = entry.value || '未设置'
      }

      if (this.onChange && key instanceof HTMLInputElement && value instanceof HTMLInputElement) {
        let pendingKey: string | null = null
        let skipKeyBlurCommit = false
        const commit = (): void => {
          const nextKey = (pendingKey ?? key.value).trim()
          if (!nextKey) return
          this.onChange?.(this.entries.map((current, currentIndex) => currentIndex === index
            ? { key: nextKey, value: value.value }
            : current), view.state.doc.toString())
        }
        key.addEventListener('blur', () => {
          if (skipKeyBlurCommit) {
            skipKeyBlurCommit = false
            return
          }
          commit()
        })
        value.addEventListener('blur', commit)
        key.addEventListener('keydown', (event) => {
          if (event.key === 'Tab' && !event.shiftKey) {
            // Do not rebuild the widget between key and value editing. The
            // pending key is persisted together with the value on its blur.
            event.preventDefault()
            pendingKey = key.value
            skipKeyBlurCommit = true
            value.focus()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            key.blur()
          }
        })
        value.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); value.blur() }
        })

        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'vault-property-remove'
        remove.textContent = '×'
        remove.setAttribute('aria-label', `删除属性 ${entry.key}`)
        // Preserve field focus for pointer users. Native button click still
        // handles mouse, Enter, and Space accessibly.
        remove.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })
        remove.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          this.onChange?.(this.entries.filter((_, currentIndex) => currentIndex !== index), view.state.doc.toString())
        })
        row.append(icon, key, value, remove)
      } else {
        row.append(icon, key, value)
      }

      list.appendChild(row)
    })
    wrapper.appendChild(list)
    this.observeSize(wrapper, view)
    return wrapper
  }

  override ignoreEvent(): boolean { return true }
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
    wrapper.innerHTML = renderMarkdownMath(this.latex, true)
    this.observeSize(wrapper, view)
    return wrapper
  }
}

class InlineMathWidget extends WidgetType {
  constructor(private readonly latex: string, private readonly from: number) { super() }
  override eq(other: InlineMathWidget): boolean { return this.latex === other.latex && this.from === other.from }
  override toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'live-markdown-math-inline'
    element.dataset.liveMarkdownInlineFrom = String(this.from)
    element.setAttribute('aria-label', '点击编辑公式')
    element.innerHTML = renderMarkdownMath(this.latex)
    return element
  }
  override ignoreEvent(): boolean { return false }
}

/** Raw HTML 在阅读态保持可用，但先经 DOMPurify 处理，避免 Markdown 文件执行脚本。 */
class RawHtmlBlockWidget extends LiveMarkdownBlockWidget {
  constructor(private readonly html: string, private readonly from: number) { super() }
  override eq(other: RawHtmlBlockWidget): boolean { return this.from === other.from && this.html === other.html }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'live-markdown-raw-html-block'
    wrapper.dataset.liveMarkdownBlockFrom = String(this.from)
    wrapper.innerHTML = DOMPurify.sanitize(this.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style'],
      FORBID_ATTR: ['style'],
    })
    for (const link of Array.from(wrapper.querySelectorAll('a'))) {
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
    }
    this.observeSize(wrapper, view)
    return wrapper
  }
}

class InlineImageWidget extends WidgetType {
  private destroyed = false

  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly title: string,
    private readonly from: number,
    private readonly resolveImageSrc?: ResolveLiveMarkdownImageSrc,
  ) { super() }

  override eq(other: InlineImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt && this.title === other.title && this.from === other.from
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span')
    element.className = 'live-markdown-image'
    element.dataset.liveMarkdownInlineFrom = String(this.from)
    element.setAttribute('aria-label', '点击编辑图片')

    const image = document.createElement('img')
    image.alt = this.alt
    image.title = this.title
    image.loading = 'lazy'
    image.addEventListener('load', () => view.requestMeasure())
    image.addEventListener('error', () => view.requestMeasure())
    element.appendChild(image)

    if (/^(?:https?:|data:|blob:|proma-file:)/i.test(this.src)) {
      image.src = this.src
    } else if (this.resolveImageSrc) {
      void this.resolveImageSrc(this.src).then((resolved) => {
        if (!this.destroyed && resolved) image.src = resolved
      }).catch(() => {})
    }
    return element
  }

  override destroy(): void { this.destroyed = true }
  override ignoreEvent(): boolean { return false }
}

/** CommonMark angle autolinks are not interpreted by ink-mde, so retain their normal link behavior. */
class AngleAutolinkWidget extends WidgetType {
  constructor(private readonly href: string) { super() }
  override eq(other: AngleAutolinkWidget): boolean { return this.href === other.href }
  override toDOM(): HTMLElement {
    const link = document.createElement('a')
    link.className = 'live-markdown-autolink'
    link.href = this.href
    link.target = '_blank'
    link.rel = 'noreferrer noopener'
    link.textContent = this.href
    return link
  }
  override ignoreEvent(): boolean { return false }
}

function buildBlocks(
  state: EditorState,
  onChangeProperties?: ChangeLiveMarkdownProperties,
  enableProperties = false,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = []
  const lines = Array.from({ length: state.doc.lines }, (_, index) => state.doc.line(index + 1).text)
  const frontmatter = enableProperties ? getLeadingFrontmatter(lines) : null
  if (frontmatter) {
    const from = state.doc.line(1).from
    const to = state.doc.line(frontmatter.endLine).to
    blocks.push({ kind: 'frontmatter', from, to, decoration: Decoration.replace({ widget: new FrontmatterWidget(frontmatter.entries, from, onChangeProperties), block: true }) })
  }
  // Only hide the source when an editable flat mapping was recognized. Complex
  // frontmatter remains in the normal editor, preserving the original YAML.
  for (let number = frontmatter ? frontmatter.endLine + 1 : 1; number <= lines.length; number += 1) {
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
    const closingDelimiter = getDisplayMathClosingDelimiter(line)
    if (closingDelimiter) {
      let closing = number + 1
      while (closing <= lines.length && (lines[closing - 1] ?? '').trim() !== closingDelimiter) closing += 1
      if (closing <= lines.length) {
        const from = state.doc.line(number).from
        const to = state.doc.line(closing).to
        blocks.push({ kind: 'math', from, to, decoration: Decoration.replace({ widget: new MathWidget(lines.slice(number, closing - 1).join('\n'), from), block: true }) })
        number = closing
      }
      continue
    }
    const rawHtmlEnd = findRawHtmlBlockEnd(lines, number - 1)
    if (rawHtmlEnd !== null) {
      const from = state.doc.line(number).from
      const to = state.doc.line(rawHtmlEnd + 1).to
      const html = lines.slice(number - 1, rawHtmlEnd + 1).join('\n')
      blocks.push({ kind: 'raw-html', from, to, decoration: Decoration.replace({ widget: new RawHtmlBlockWidget(html, from), block: true }) })
      number = rawHtmlEnd + 1
      continue
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      const from = state.doc.line(number).from
      blocks.push({ kind: 'thematic-break', from, to: state.doc.line(number).to, decoration: Decoration.replace({ widget: new HorizontalRuleWidget(from), block: true }) })
      continue
    }
    if (line.includes('|') && number < lines.length && isLiveMarkdownTableSeparator(lines[number] ?? '')) {
      let end = number + 1
      while (end < lines.length && (lines[end] ?? '').trim() && (lines[end] ?? '').includes('|')) end += 1
      const from = state.doc.line(number).from
      const to = state.doc.line(end).to
      const table = parseLiveMarkdownTable(state.sliceDoc(from, to))
      if (table) blocks.push({ kind: 'table', from, to, decoration: Decoration.replace({ widget: new TableWidget(table, from, to), block: true }) })
      number = end
    }
  }
  return blocks
}

function buildDecorations(
  state: EditorState,
  blocks: PreviewBlock[],
  lines: Set<number>,
  resolveImageSrc?: ResolveLiveMarkdownImageSrc,
): DecorationSet {
  const entries: Array<{ from: number; to: number; decoration: Decoration }> = []
  const protectedRanges = blocks.map((block) => ({ from: block.from, to: block.to }))
  for (const block of blocks) {
    const first = state.doc.lineAt(block.from).number
    const last = state.doc.lineAt(block.to).number
    const hasActiveSelectionInBlock = [...lines].some((line) => line >= first && line <= last)
    if (block.kind === 'table' || block.kind === 'frontmatter' || !hasActiveSelectionInBlock) entries.push(block)
  }
  for (let number = 1; number <= state.doc.lines; number += 1) {
    if (lines.has(number)) continue
    const line = state.doc.line(number)
    for (const preview of findInlineLiveMarkdownPreviews(line.text)) {
      const from = line.from + preview.from
      const to = line.from + preview.to
      if (protectedRanges.some((range) => from >= range.from && to <= range.to)) continue
      const widget = preview.kind === 'math'
        ? new InlineMathWidget(preview.content, from)
        : preview.kind === 'image'
          ? new InlineImageWidget(preview.src, preview.alt, preview.title, from, resolveImageSrc)
          : new AngleAutolinkWidget(preview.content)
      entries.push({ from, to, decoration: Decoration.replace({ widget }) })
    }
  }
  entries.sort((left, right) => left.from - right.from || left.to - right.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const entry of entries) builder.add(entry.from, entry.to, entry.decoration)
  return builder.finish()
}

/** Common live preview for block Markdown that ink-mde does not render itself. */
export function createLiveMarkdownBlockPreview(
  resolveImageSrc?: ResolveLiveMarkdownImageSrc,
  savePastedImage?: SaveLiveMarkdownPastedImage,
  onChangeProperties?: ChangeLiveMarkdownProperties,
  enableProperties = false,
): Extension {
  return [
  liveMarkdownShikiHighlight,
  StateField.define<PreviewState>({
    create: (state) => {
      const lines = activeLines(state)
      const blocks = buildBlocks(state, onChangeProperties, enableProperties)
      return {
        activeLines: lines,
        blocks,
        decorations: buildDecorations(state, blocks, lines, resolveImageSrc),
      }
    },
    update: (value, transaction) => {
      const lines = activeLines(transaction.state)
      const blocks = transaction.docChanged ? buildBlocks(transaction.state, onChangeProperties, enableProperties) : value.blocks
      if (!transaction.docChanged && sameLines(lines, value.activeLines)) return value
      return {
        activeLines: lines,
        blocks,
        decorations: buildDecorations(transaction.state, blocks, lines, resolveImageSrc),
      }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  }),
  EditorView.domEventHandlers({
    paste: (event, view) => {
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => /^image\/(?:png|jpeg|gif|webp)$/i.test(file.type))
      if (!image || !savePastedImage || view.state.readOnly) return false
      event.preventDefault()
      void savePastedImage(image).then((src) => {
        if (!src) return
        const position = view.state.selection.main.from
        const alt = image.name.replace(/[\\[\]]/g, '\\$&') || '粘贴的图片'
        const markdown = `![${alt}](<${src}>)`
        view.dispatch({ changes: { from: position, insert: markdown }, selection: { anchor: position + markdown.length } })
      }).catch(() => {})
      return true
    },
    mousedown: (event, view) => {
      const target = event.target as HTMLElement | null
      const block = target?.closest<HTMLElement>('[data-live-markdown-block-from]')
      const inlineMath = target?.closest<HTMLElement>('[data-live-markdown-inline-from]')
      if (!block && !inlineMath) return false
      if (block?.dataset.liveMarkdownBlockKind === 'table') return true
      // CodeBlock 的复制按钮必须在外层选区切换之前收到完整 click 序列。
      // 否则 mousedown 会把预览切回源码并卸载按钮，导致 click 永远无法触发。
      // `.cm-content` 本身就是 contenteditable；把它纳入排除条件会让所有
      // widget 点击都被提前吞掉。只给真正需要原生 click 序列的交互控件让路。
      if (target?.closest('button, a, input, select, textarea, [role="button"]')) return true
      const from = Number(block?.dataset.liveMarkdownBlockFrom ?? inlineMath?.dataset.liveMarkdownInlineFrom)
      if (!Number.isSafeInteger(from)) return false
      // Replacement widget 没有可供 CodeMirror 命中的文本位置；默认命中会跳到邻行。
      // 直接选中其源码起点，下一次 decorations 更新便会展示该行的公式标记。
      event.preventDefault()
      view.dispatch({
        selection: { anchor: from },
      })
      view.focus()
      return true
    },
  }),
  ]
}

/** Default extension for consumers that do not need local-media resolution. */
export const liveMarkdownBlockPreview = createLiveMarkdownBlockPreview()
