import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Text } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType } from '@codemirror/view'
import { getLeadingFrontmatterRange } from '../markdown/live-markdown-frontmatter'

// Text 不可变；选区/焦点事务复用文档，弱引用不会保留历史正文。
const frontmatterEnds = new WeakMap<Text, number>()
function frontmatterEnd(doc: Text): number {
  const cached = frontmatterEnds.get(doc)
  if (cached !== undefined) return cached
  const range = doc.line(1).text.replace(/^\uFEFF/, '') === '---'
    ? getLeadingFrontmatterRange(doc.toJSON()) : null
  const end = range ? doc.line(range.endLine).to : 0
  frontmatterEnds.set(doc, end)
  return end
}

/** 根路径精确命中优先，其次当前目录，最后唯一后缀；仅解析 Vault 内部笔记。 */
export function resolveVaultWikiLink(target: string, source: string, files: readonly string[]): string | null {
  const note = target.trim().replace(/\.md$/i, '')
  if (!note || /[#^:]/.test(note)) return null
  const normalize = (path: string): string | null => {
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (part === '..') {
        if (!parts.length) return null
        parts.pop()
      } else if (part && part !== '.') parts.push(part)
    }
    return parts.join('/')
  }
  const stem = (file: string): string => file.replace(/\.md$/i, '')
  const folder = source.slice(0, source.lastIndexOf('/') + 1)
  const relative = normalize(folder + note)
  const root = normalize(note)
  if (note.startsWith('./') || note.startsWith('../')) {
    return relative === null ? null : files.find((file) => stem(file) === relative) ?? null
  }
  const exact = files.find((file) => stem(file) === root)
  if (exact) return exact
  const local = files.find((file) => stem(file) === relative)
  if (local) return local
  const matches = files.filter((file) => stem(file).endsWith('/' + note))
  return matches.length === 1 ? matches[0]! : null
}

/** 使用 Markdown 语法树排除代码、HTML 和已有链接；转义与嵌入保持原样。 */
export function canRenderVaultWikiLink(state: EditorState, from: number): boolean {
  const preceding = state.sliceDoc(state.doc.lineAt(from).from, from)
  if (preceding.endsWith('!') || (preceding.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) return false
  for (let node = syntaxTree(state).resolveInner(from, 1); node; node = node.parent!) {
    if (/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Link|Image)$/.test(node.name)) return false
  }
  // 与 Properties 复用封闭区间规则；未闭合的首行分隔线仍是普通 Markdown。
  return from >= frontmatterEnd(state.doc)
}

class VaultWikiLinkWidget extends WidgetType {
  constructor(readonly target: string, readonly label: string, readonly onOpen: (target: string) => void) { super() }
  override eq(other: VaultWikiLinkWidget): boolean {
    return this.target === other.target && this.label === other.label && this.onOpen === other.onOpen
  }
  override toDOM(view: EditorView): HTMLElement {
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'vault-wikilink'
    link.textContent = `[${this.label}]`
    link.title = `${this.target}（Alt/Option 点击编辑链接）`
    link.setAttribute('aria-label', `打开笔记：${this.label}`)
    // 在 CodeMirror 把指针位置变成源码选区前保留链接，普通单击即可打开。
    link.onmousedown = (event) => event.preventDefault()
    link.onclick = (event) => {
      event.preventDefault()
      if (event.altKey) {
        const from = view.posAtDOM(link)
        view.dispatch({ selection: { anchor: from + 2 } })
        view.focus()
      } else this.onOpen(this.target)
    }
    return link
  }
  override ignoreEvent(): boolean { return true }
}

export function createVaultWikiLinks(onOpen: (target: string) => void): Extension {
  const matcher = new MatchDecorator({
    regexp: /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g,
    decorate: (add, from, to, match, view) => {
      if (!canRenderVaultWikiLink(view.state, from)) return
      if (view.hasFocus && view.state.selection.ranges.some((range) => range.from <= to && range.to >= from)) return
      const target = match[1]!.trim()
      if (!target) return
      add(from, to, Decoration.replace({ widget: new VaultWikiLinkWidget(target, match[2]?.trim() || target, onOpen) }))
    },
  })
  return [
    ViewPlugin.fromClass(class {
      decorations
      constructor(view: EditorView) { this.decorations = matcher.createDeco(view) }
      update(update: import('@codemirror/view').ViewUpdate): void {
        this.decorations = update.docChanged || update.selectionSet || update.focusChanged
          || syntaxTree(update.startState) !== syntaxTree(update.state)
          ? matcher.createDeco(update.view)
          : matcher.updateDeco(update, this.decorations)
      }
    }, { decorations: (plugin) => plugin.decorations }),
    EditorView.baseTheme({
      '.vault-wikilink': {
        color: 'hsl(262 83% 58%)',
        cursor: 'pointer',
        font: 'inherit',
        padding: '0',
        border: '0',
        background: 'none',
        textDecoration: 'underline',
        textDecorationThickness: '1px',
        textUnderlineOffset: '2px',
      },
      '.vault-wikilink:hover': { color: 'hsl(262 83% 50%)' },
      '.vault-wikilink:focus-visible': { outline: '2px solid hsl(var(--ring))', outlineOffset: '2px' },
    }),
  ]
}
