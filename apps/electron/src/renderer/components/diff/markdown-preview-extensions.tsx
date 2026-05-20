import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view'
import TaskListExt from '@tiptap/extension-task-list'
import TaskItemExt from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { highlightCode, highlightToTokens, getDisplayName } from '@proma/core'
import type { HighlightTokensResult } from '@proma/core'
import type { FileAccessOptions } from '@proma/shared'

type FileAccessRef = { current: FileAccessOptions | undefined }
/** 传 null 表示当前编辑器无会话/文件上下文（如 ScratchPad），跳过路径解析。 */
type FileAccessRefOrNull = FileAccessRef | null
type ThemeRef = { current: string }

interface MarkdownSerializerLike {
  write: (value: string) => void
  text: (value: string, escape?: boolean) => void
  ensureNewLine: () => void
  closeBlock: (node: ProseMirrorNode) => void
  esc: (value: string, startOfLine?: boolean) => string
}

interface ShikiDecorationState {
  decorations: DecorationSet
}

const shikiCodeBlockPluginKey = new PluginKey<ShikiDecorationState>('markdownShikiCodeBlock')
const SHIKI_REFRESH_META = 'markdownShikiCodeBlockRefresh'
const SHIKI_TOKEN_CACHE_LIMIT = 160
const shikiTokenCache = new Map<string, HighlightTokensResult>()

function normalizeCodeLanguage(language: unknown): string {
  const value = typeof language === 'string' ? language.trim() : ''
  return value || 'text'
}

function stringAttr(node: ProseMirrorNode, name: string): string {
  const value = node.attrs[name]
  return typeof value === 'string' ? value : ''
}

function escapeMarkdownLinkTarget(value: string): string {
  return `<${value.replace(/[<>\r\n]/g, (char) => encodeURIComponent(char))}>`
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function serializeMarkdownImage(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  const src = escapeMarkdownLinkTarget(stringAttr(node, 'src'))
  const alt = state.esc(stringAttr(node, 'alt'))
  const title = stringAttr(node, 'title').replace(/"/g, '\\"')
  state.write(`![${alt}](${src}${title ? ` "${title}"` : ''})`)
}

function serializeMarkdownVideo(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  const src = escapeHtmlAttr(stringAttr(node, 'src'))
  const poster = escapeHtmlAttr(stringAttr(node, 'poster'))
  const title = escapeHtmlAttr(stringAttr(node, 'title'))
  state.write(`<video controls src="${src}"${poster ? ` poster="${poster}"` : ''}${title ? ` title="${title}"` : ''}></video>`)
  state.closeBlock(node)
}

function serializeRawHtmlBlock(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  const markdown = stringAttr(node, 'markdown') || stringAttr(node, 'html')
  state.write(markdown)
  state.closeBlock(node)
}

function serializeRawHtmlInline(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  state.write(stringAttr(node, 'html'))
}

function serializeMathInline(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  state.write(`$${stringAttr(node, 'latex')}$`)
}

function serializeMathBlock(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  state.write(`$$\n${stringAttr(node, 'latex')}\n$$`)
  state.closeBlock(node)
}

function serializeCodeBlock(state: MarkdownSerializerLike, node: ProseMirrorNode): void {
  const backticks = node.textContent.match(/`{3,}/gm)
  const fence = backticks ? `${backticks.sort().slice(-1)[0]}\`` : '```'
  const language = stringAttr(node, 'language')
  state.write(`${fence}${language === 'text' ? '' : language}\n`)
  state.text(node.textContent, false)
  state.ensureNewLine()
  state.write(fence)
  state.closeBlock(node)
}

function shouldLoadShikiLanguage(requestedLanguage: string, actualLanguage: string): boolean {
  return requestedLanguage !== 'text' && actualLanguage === 'text'
}

function getCachedShikiTokens(code: string, language: string, theme: string): HighlightTokensResult | null {
  const key = `${theme}\u0000${language}\u0000${code}`
  if (shikiTokenCache.has(key)) {
    const cached = shikiTokenCache.get(key) ?? null
    shikiTokenCache.delete(key)
    if (cached) shikiTokenCache.set(key, cached)
    return cached
  }

  const result = highlightToTokens({ code, language, theme })
  if (!result || shouldLoadShikiLanguage(language, result.language)) return result

  shikiTokenCache.set(key, result)
  if (shikiTokenCache.size > SHIKI_TOKEN_CACHE_LIMIT) {
    const oldestKey = shikiTokenCache.keys().next().value
    if (oldestKey) shikiTokenCache.delete(oldestKey)
  }
  return result
}

function buildShikiDecorations(doc: ProseMirrorNode, theme: string): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true

    const code = node.textContent
    if (!code) return false

    const language = normalizeCodeLanguage(node.attrs.language)
    const result = getCachedShikiTokens(code, language, theme)
    if (!result) return false

    let offset = 0
    result.lines.forEach((line, lineIndex) => {
      line.forEach((token) => {
        const from = pos + 1 + offset
        const to = from + token.content.length
        if (token.color && from < to) {
          decorations.push(Decoration.inline(from, to, { style: `color: ${token.color}` }))
        }
        offset += token.content.length
      })

      if (lineIndex < result.lines.length - 1) offset += 1
    })

    return false
  })

  return DecorationSet.create(doc, decorations)
}

function requestMissingShikiLanguages(view: EditorView, theme: string, pending: Set<string>): void {
  // 同一文档可能含多个相同 language 的代码块，先按 language 去重再判定，
  // 避免重复同步调用 highlightToTokens（每个 codeBlock 一次）。
  const languages = new Set<string>()
  view.state.doc.descendants((node) => {
    if (node.type.name !== 'codeBlock') return true
    languages.add(normalizeCodeLanguage(node.attrs.language))
    return false
  })

  const requests: Array<Promise<void>> = []
  for (const language of languages) {
    const syncResult = highlightToTokens({ code: ' ', language, theme })
    if (syncResult && !shouldLoadShikiLanguage(language, syncResult.language)) continue

    const key = `${theme}:${language}`
    if (pending.has(key)) continue

    pending.add(key)
    requests.push(
      highlightCode({ code: ' ', language, theme })
        .then(() => {})
        .catch((error) => console.error('[MarkdownRichEditor] Shiki 高亮失败:', error))
        .finally(() => pending.delete(key)),
    )
  }

  if (requests.length === 0) return

  Promise.all(requests)
    .then(() => {
      if (!view.isDestroyed) {
        view.dispatch(view.state.tr.setMeta(SHIKI_REFRESH_META, true))
      }
    })
    .catch(() => {})
}

function createShikiDecorationsPlugin(themeRef: ThemeRef): Plugin<ShikiDecorationState> {
  return new Plugin<ShikiDecorationState>({
    key: shikiCodeBlockPluginKey,
    state: {
      init: (_, state) => ({
        decorations: buildShikiDecorations(state.doc, themeRef.current),
      }),
      apply: (tr, previous, _oldState, newState) => {
        if (tr.docChanged || tr.getMeta(SHIKI_REFRESH_META)) {
          return { decorations: buildShikiDecorations(newState.doc, themeRef.current) }
        }
        return { decorations: previous.decorations.map(tr.mapping, tr.doc) }
      },
    },
    props: {
      decorations: (state) => shikiCodeBlockPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
    view: (view) => {
      const pending = new Set<string>()
      let lastRequestedTheme = themeRef.current
      requestMissingShikiLanguages(view, themeRef.current, pending)

      return {
        update: (nextView, previousState) => {
          // 主题切换通过 SHIKI_REFRESH_META 触发事务，但既不改 doc 也不改 selection，
          // 仅靠 doc/selection 比较会漏掉「切换主题后某些语言尚未加载」的情况。
          const currentTheme = themeRef.current
          const themeChanged = currentTheme !== lastRequestedTheme
          const docChanged = previousState.doc !== nextView.state.doc
          const selectionChanged = previousState.selection !== nextView.state.selection
          if (!themeChanged && !docChanged && !selectionChanged) return
          lastRequestedTheme = currentTheme
          requestMissingShikiLanguages(nextView, currentTheme, pending)
        },
      }
    },
  })
}

function isExternalUrl(src: string): boolean {
  return /^(?:https?:|data:|blob:|file:|proma-file:)/i.test(src)
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['video', 'source', 'summary', 'details'],
    ADD_ATTR: [
      'align',
      'colspan',
      'controls',
      'loading',
      'open',
      'poster',
      'rowspan',
      'src',
      'target',
    ],
  })
}

function setClass(el: HTMLElement, className: string): void {
  el.className = className
}

function decodeLocalMediaPath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function uniqueMediaCandidates(paths: string[]): string[] {
  return paths.filter((path, index) => path && paths.indexOf(path) === index)
}

async function resolveFirstMediaCandidate(paths: string[], fileAccessRef: FileAccessRef): Promise<string> {
  for (const path of paths) {
    const result = await window.electronAPI.resolveFilePath(path, fileAccessRef.current)
    if (result?.url) return result.url
  }
  return ''
}

function resolveMediaSrc(src: string, fileAccessRef: FileAccessRefOrNull, apply: (src: string) => void): () => void {
  // 外链 / data-URL / blob / 已授权 proma-file 协议：直接 apply，不走 IPC
  if (!src || isExternalUrl(src)) {
    apply(src)
    return () => {}
  }
  const isFileUrl = src.toLowerCase().startsWith('file:')
  const localSrc = isFileUrl
    ? (() => {
        try {
          return decodeURIComponent(new URL(src).pathname)
        } catch {
          return ''
        }
      })()
    : src
  const candidatePaths = uniqueMediaCandidates([localSrc, decodeLocalMediaPath(localSrc)])
  // 无会话上下文：直接显示原始 src（ScratchPad 等无文件解析需求的场景）
  if (fileAccessRef === null) {
    apply(isFileUrl ? '' : localSrc)
    return () => {}
  }

  let cancelled = false
  apply(isFileUrl ? '' : localSrc)
  resolveFirstMediaCandidate(candidatePaths, fileAccessRef)
    .then((result) => {
      if (!cancelled) apply(result)
    })
    .catch(() => {
      if (!cancelled) apply('')
    })

  return () => { cancelled = true }
}

function createStaticHtmlView(
  initialNode: ProseMirrorNode,
  options: {
    className: string
    getHtml: (node: ProseMirrorNode) => string
    inline?: boolean
  },
) {
  const dom = document.createElement(options.inline ? 'span' : 'div')
  dom.contentEditable = 'false'
  setClass(dom, options.className)

  const render = (node: ProseMirrorNode) => {
    dom.innerHTML = sanitizeHtml(options.getHtml(node))
  }

  render(initialNode)

  return {
    dom,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== initialNode.type) return false
      render(nextNode)
      return true
    },
    ignoreMutation() {
      return true
    },
  }
}

function createMarkdownImageView(initialNode: ProseMirrorNode, fileAccessRef: FileAccessRefOrNull) {
  const figure = document.createElement('figure')
  figure.contentEditable = 'false'
  setClass(figure, 'not-prose my-3')

  const img = document.createElement('img')
  img.draggable = false
  setClass(img, 'max-w-full rounded-md border border-border/30 bg-muted/20')
  figure.appendChild(img)

  const caption = document.createElement('figcaption')
  setClass(caption, 'mt-1 text-center text-xs text-muted-foreground')

  let cleanup = () => {}

  const render = (node: ProseMirrorNode) => {
    cleanup()
    const src = String(node.attrs.src ?? '')
    const alt = String(node.attrs.alt ?? '')
    const title = String(node.attrs.title ?? '')
    img.alt = alt
    img.title = title
    cleanup = resolveMediaSrc(src, fileAccessRef, (resolvedSrc) => { img.src = resolvedSrc })

    if (title) {
      caption.textContent = title
      if (!caption.parentElement) figure.appendChild(caption)
    } else {
      caption.remove()
    }
  }

  render(initialNode)

  return {
    dom: figure,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== initialNode.type) return false
      render(nextNode)
      return true
    },
    destroy() {
      cleanup()
    },
    ignoreMutation() {
      return true
    },
  }
}

function createMarkdownVideoView(initialNode: ProseMirrorNode, fileAccessRef: FileAccessRefOrNull) {
  const figure = document.createElement('figure')
  figure.contentEditable = 'false'
  setClass(figure, 'not-prose my-3')

  const video = document.createElement('video')
  video.controls = true
  setClass(video, 'max-h-[520px] max-w-full rounded-md border border-border/30 bg-black')
  figure.appendChild(video)

  const caption = document.createElement('figcaption')
  setClass(caption, 'mt-1 text-center text-xs text-muted-foreground')

  let cleanupSrc = () => {}
  let cleanupPoster = () => {}

  const render = (node: ProseMirrorNode) => {
    cleanupSrc()
    cleanupPoster()
    const src = String(node.attrs.src ?? '')
    const poster = String(node.attrs.poster ?? '')
    const title = String(node.attrs.title ?? '')
    video.title = title
    cleanupSrc = resolveMediaSrc(src, fileAccessRef, (resolvedSrc) => { video.src = resolvedSrc })
    cleanupPoster = resolveMediaSrc(poster, fileAccessRef, (resolvedPoster) => {
      if (resolvedPoster) video.poster = resolvedPoster
      else video.removeAttribute('poster')
    })

    if (title) {
      caption.textContent = title
      if (!caption.parentElement) figure.appendChild(caption)
    } else {
      caption.remove()
    }
  }

  render(initialNode)

  return {
    dom: figure,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== initialNode.type) return false
      render(nextNode)
      return true
    },
    destroy() {
      cleanupSrc()
      cleanupPoster()
    },
    ignoreMutation() {
      return true
    },
  }
}

function createMathView(initialNode: ProseMirrorNode, displayMode: boolean) {
  return createStaticHtmlView(initialNode, {
    inline: !displayMode,
    className: displayMode
      ? 'not-prose my-4 overflow-x-auto text-center'
      : 'not-prose inline-block align-baseline',
    getHtml: (node) => {
      const latex = String(node.attrs.latex ?? '')
      try {
        return katex.renderToString(latex, { displayMode, throwOnError: false })
      } catch {
        return latex
      }
    },
  })
}

function createShikiCodeBlockView(initialNode: ProseMirrorNode, _themeRef: ThemeRef) {
  const dom = document.createElement('div')
  setClass(dom, 'not-prose my-3 overflow-hidden rounded-md border border-border/40 bg-muted/30')

  // 头部栏：语言标签 + 复制按钮
  const header = document.createElement('div')
  header.contentEditable = 'false'
  setClass(header, 'flex h-8 items-center justify-between border-b border-border/30 px-3 text-xs text-muted-foreground')
  const label = document.createElement('span')
  label.className = 'font-medium select-none'
  header.appendChild(label)

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground'
  copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span>'
  let copyTimeout: ReturnType<typeof setTimeout> | null = null
  let currentCode = initialNode.textContent
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentCode).then(() => {
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>已复制</span>'
      if (copyTimeout) clearTimeout(copyTimeout)
      copyTimeout = setTimeout(() => {
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span>'
      }, 2000)
    }).catch(() => {})
  })
  header.appendChild(copyBtn)

  const body = document.createElement('div')
  setClass(body, 'markdown-code-block-body overflow-x-auto')

  const editPre = document.createElement('pre')
  setClass(editPre, 'markdown-code-edit-layer m-0 min-h-[3.2em] overflow-x-auto bg-transparent p-4 font-mono text-[13px] leading-[1.6]')

  const contentDOM = document.createElement('code')
  setClass(contentDOM, 'block min-h-[1.6em] whitespace-pre bg-transparent p-0 font-mono text-[13px] leading-[1.6]')
  editPre.appendChild(contentDOM)
  body.appendChild(editPre)

  dom.appendChild(header)
  dom.appendChild(body)

  const render = (node: ProseMirrorNode) => {
    const language = String(node.attrs.language ?? 'text') || 'text'
    currentCode = node.textContent
    label.textContent = language === 'text' ? 'Code' : getDisplayName(language)
  }

  render(initialNode)

  return {
    dom,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== initialNode.type) return false
      render(nextNode)
      return true
    },
    destroy() {
      if (copyTimeout) clearTimeout(copyTimeout)
    },
    contentDOM,
    ignoreMutation(mutation: ViewMutationRecord) {
      return !contentDOM.contains(mutation.target)
    },
  }
}

export function createMarkdownImage(fileAccessRef: FileAccessRefOrNull): Node {
  return Node.create({
    name: 'markdownImage',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        src: { default: '' },
        alt: { default: '' },
        title: { default: '' },
      }
    },

    parseHTML() {
      return [{
        tag: 'img[src]',
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false
          return {
            src: node.getAttribute('src') || '',
            alt: node.getAttribute('alt') || '',
            title: node.getAttribute('title') || '',
          }
        },
      }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['img', mergeAttributes(HTMLAttributes)]
    },

    addStorage() {
      return {
        markdown: {
          serialize: serializeMarkdownImage,
        },
      }
    },

    addNodeView() {
      return ({ node }) => createMarkdownImageView(node, fileAccessRef)
    },
  })
}

export function createMarkdownVideo(fileAccessRef: FileAccessRefOrNull): Node {
  return Node.create({
    name: 'markdownVideo',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        src: { default: '' },
        poster: { default: '' },
        title: { default: '' },
      }
    },

    parseHTML() {
      return [{
        tag: 'video[src], video[data-type="markdown-video"]',
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false
          const source = node.querySelector('source')
          return {
            src: node.getAttribute('src') || source?.getAttribute('src') || '',
            poster: node.getAttribute('poster') || '',
            title: node.getAttribute('title') || node.getAttribute('alt') || '',
          }
        },
      }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['video', mergeAttributes({ controls: 'true' }, HTMLAttributes)]
    },

    addStorage() {
      return {
        markdown: {
          serialize: serializeMarkdownVideo,
        },
      }
    },

    addNodeView() {
      return ({ node }) => createMarkdownVideoView(node, fileAccessRef)
    },
  })
}

export const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      html: { default: '' },
      markdown: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="raw-html-block"]',
      getAttrs: (node) => node instanceof HTMLElement
        ? { html: node.dataset.html || '', markdown: node.dataset.markdown || '' }
        : false,
    }]
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'raw-html-block',
        'data-html': node.attrs.html,
        'data-markdown': node.attrs.markdown || undefined,
      },
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeRawHtmlBlock,
      },
    }
  },

  addNodeView() {
    return ({ node }) => createStaticHtmlView(node, {
      className: 'not-prose my-3 overflow-auto',
      getHtml: (nextNode) => String(nextNode.attrs.html ?? ''),
    })
  },
})

export const RawHtmlInline = Node.create({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { html: { default: '' } }
  },

  parseHTML() {
    return [{
      tag: 'span[data-type="raw-html-inline"]',
      getAttrs: (node) => node instanceof HTMLElement ? { html: node.dataset.html || '' } : false,
    }]
  },

  renderHTML({ node }) {
    return ['span', { 'data-type': 'raw-html-inline', 'data-html': node.attrs.html }]
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeRawHtmlInline,
      },
    }
  },

  addNodeView() {
    return ({ node }) => createStaticHtmlView(node, {
      inline: true,
      className: 'not-prose inline-block align-baseline',
      getHtml: (nextNode) => String(nextNode.attrs.html ?? ''),
    })
  },
})

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { latex: { default: '' } }
  },

  parseHTML() {
    return [{
      tag: 'span[data-type="math-inline"]',
      getAttrs: (node) => node instanceof HTMLElement ? { latex: node.dataset.latex || '' } : false,
    }]
  },

  renderHTML({ node }) {
    return ['span', { 'data-type': 'math-inline', 'data-latex': node.attrs.latex }]
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeMathInline,
      },
    }
  },

  addNodeView() {
    return ({ node }) => createMathView(node, false)
  },

  /**
   * 输入触发：`$x^2$ ` 末尾空格触发；内层不能含 `$` 或换行。
   * 匹配到的整段（含 `$..$`）会被替换为节点，尾随空格保留在节点之后。
   */
  addInputRules() {
    return [
      nodeInputRule({
        find: /(?:^|[\s(])\$([^$\n]{1,200})\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] ?? '' }),
      }),
    ]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return { latex: { default: '' } }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="math-block"]',
      getAttrs: (node) => node instanceof HTMLElement ? { latex: node.dataset.latex || '' } : false,
    }]
  },

  renderHTML({ node }) {
    return ['div', { 'data-type': 'math-block', 'data-latex': node.attrs.latex }]
  },

  addStorage() {
    return {
      markdown: {
        serialize: serializeMathBlock,
      },
    }
  },

  addNodeView() {
    return ({ node }) => createMathView(node, true)
  },

  /**
   * 输入触发：在段落首输入 `$$<latex>$$` 后按下一个非 `$` 字符（通常是空格或回车前）触发。
   * 使用基于行首锚定的规则：`^\$\$([\s\S]+?)\$\$$`。
   */
  addInputRules() {
    return [
      nodeInputRule({
        find: /^\$\$([\s\S]+?)\$\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: (match[1] ?? '').trim() }),
      }),
    ]
  },
})

export function createShikiCodeBlock(themeRef: ThemeRef): Node {
  return Node.create({
    name: 'codeBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,

    addAttributes() {
      return {
        language: {
          default: 'text',
          parseHTML: (element) => {
            const className = element.querySelector('code')?.className || element.className || ''
            return className.match(/language-(\S+)/)?.[1] || 'text'
          },
          renderHTML: (attrs) => ({
            class: attrs.language ? `language-${attrs.language}` : undefined,
          }),
        },
      }
    },

    parseHTML() {
      return [{ tag: 'pre', preserveWhitespace: 'full' }]
    },

    addCommands() {
      return {
        setCodeBlock:
          (attributes) =>
          ({ commands }) =>
            commands.setNode(this.name, attributes),
        toggleCodeBlock:
          (attributes) =>
          ({ commands }) =>
            commands.toggleNode(this.name, 'paragraph', attributes),
      }
    },

    addStorage() {
      return {
        markdown: {
          serialize: serializeCodeBlock,
        },
      }
    },

    renderHTML({ node, HTMLAttributes }) {
      const language = node.attrs.language ? `language-${node.attrs.language}` : undefined
      return ['pre', mergeAttributes(HTMLAttributes), ['code', { class: language }, 0]]
    },

    addNodeView() {
      return ({ node }) => createShikiCodeBlockView(node, themeRef)
    },

    addProseMirrorPlugins() {
      return [createShikiDecorationsPlugin(themeRef)]
    },
  })
}

/**
 * 任务列表 — 使用 @tiptap/extension-task-list / task-item 官方扩展。
 * 默认 parseHTML 即 `ul[data-type="taskList"]` / `li[data-type="taskItem"]`，
 * 与 markdown-rich-text.ts 的 enhanceMarkdownHtml 输出一致。
 *
 * 官方扩展自带：
 *  - inputRule `^\s*\[([\sxX])\]\s$`（在 listItem 中输入 `[ ]` 或 `[x]` + 空格 → 转为 taskItem）
 *  - Enter 拆分 / Tab 缩进 / Shift+Tab 升级
 *  - checkbox 双向勾选
 */
export const TaskList = TaskListExt.configure({
  HTMLAttributes: { class: 'not-prose my-2 space-y-1 pl-0' },
})

export const TaskItem = TaskItemExt.configure({
  nested: true,
  HTMLAttributes: { class: 'flex items-start gap-2' },
})

export const tableExtensions = [
  Table.configure({
    resizable: false,
    HTMLAttributes: { class: 'markdown-table' },
  }),
  TableRow,
  TableCell.configure({
    HTMLAttributes: { class: 'md-td' },
  }),
  TableHeader.configure({
    HTMLAttributes: { class: 'md-th' },
  }),
]
