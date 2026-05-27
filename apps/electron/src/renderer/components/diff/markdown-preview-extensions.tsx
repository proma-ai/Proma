import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view'
import TaskListExt from '@tiptap/extension-task-list'
import TaskItemExt from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { highlightCode, highlightToTokens, getDisplayName } from '@proma/core'
import { MermaidBlock } from '@proma/ui'
import type { HighlightTokensResult } from '@proma/core'
import type { FileAccessOptions } from '@proma/shared'
import { extractCodeText } from '../../lib/markdown-rich-text'
import { shouldRenderMermaidCodeBlock } from '../../lib/mermaid-detection'

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

interface CodeBlockRenderModeState {
  decorations: DecorationSet
  editable: boolean | null
}

const shikiCodeBlockPluginKey = new PluginKey<ShikiDecorationState>('markdownShikiCodeBlock')
const codeBlockRenderModePluginKey = new PluginKey<CodeBlockRenderModeState>('markdownCodeBlockRenderMode')
const SHIKI_REFRESH_META = 'markdownShikiCodeBlockRefresh'
const CODE_BLOCK_RENDER_MODE_META = 'markdownCodeBlockRenderModeRefresh'
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
      // 首次 mount 不在同步路径跑 Shiki tokenize（含数百次 highlightToTokens 调用），
      // 让出主线程；首帧装饰由 view 启动时通过 SHIKI_REFRESH_META 异步事务触发。
      init: () => ({ decorations: DecorationSet.empty }),
      apply: (tr, previous, _oldState, newState) => {
        // 仅当 view 层调度的 refresh 事务到来时才重算。文档变更不直接重算——
        // 重算是 O(全部 codeBlock × 全部 token) 的同步操作，每次按键都跑会卡住编辑器。
        if (tr.getMeta(SHIKI_REFRESH_META)) {
          return { decorations: buildShikiDecorations(newState.doc, themeRef.current) }
        }
        // 普通事务（按键/光标移动）：让旧装饰跟随位置 mapping，几乎无开销。
        return { decorations: previous.decorations.map(tr.mapping, tr.doc) }
      },
    },
    props: {
      decorations: (state) => shikiCodeBlockPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
    view: (view) => {
      const pending = new Set<string>()
      let lastRequestedTheme = themeRef.current
      let scheduleHandle: ReturnType<typeof setTimeout> | null = null

      const scheduleRefresh = (currentView: EditorView, delayMs: number): void => {
        if (scheduleHandle !== null) clearTimeout(scheduleHandle)
        scheduleHandle = setTimeout(() => {
          scheduleHandle = null
          if (currentView.isDestroyed) return
          requestMissingShikiLanguages(currentView, themeRef.current, pending)
          currentView.dispatch(currentView.state.tr.setMeta(SHIKI_REFRESH_META, true))
        }, delayMs)
      }

      // 首次 mount：异步触发首次装饰构建（不阻塞）。
      scheduleRefresh(view, 0)

      return {
        update: (nextView, previousState) => {
          const currentTheme = themeRef.current
          const themeChanged = currentTheme !== lastRequestedTheme
          const docChanged = previousState.doc !== nextView.state.doc
          // 仅 selection 变化不触发：光标移动既不影响装饰内容，也不会引入新语言。
          if (!themeChanged && !docChanged) return

          lastRequestedTheme = currentTheme
          if (themeChanged) {
            // 主题切换是低频用户操作，走立即路径让视觉变化即时呈现。
            if (scheduleHandle !== null) {
              clearTimeout(scheduleHandle)
              scheduleHandle = null
            }
            requestMissingShikiLanguages(nextView, currentTheme, pending)
            nextView.dispatch(nextView.state.tr.setMeta(SHIKI_REFRESH_META, true))
          } else {
            // 文档变更：120ms 节流，避免连续按键期间反复全量重算。
            scheduleRefresh(nextView, 120)
          }
        },
        destroy: () => {
          if (scheduleHandle !== null) {
            clearTimeout(scheduleHandle)
            scheduleHandle = null
          }
        },
      }
    },
  })
}

function buildCodeBlockRenderModeDecorations(doc: ProseMirrorNode, editable: boolean): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      'data-proma-render-mode': editable ? 'editing' : 'preview',
    }))
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function createCodeBlockRenderModePlugin(): Plugin<CodeBlockRenderModeState> {
  return new Plugin<CodeBlockRenderModeState>({
    key: codeBlockRenderModePluginKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, editable: null }),
      apply: (tr, previous) => {
        const nextEditable = tr.getMeta(CODE_BLOCK_RENDER_MODE_META)
        if (typeof nextEditable === 'boolean') {
          return {
            decorations: buildCodeBlockRenderModeDecorations(tr.doc, nextEditable),
            editable: nextEditable,
          }
        }

        return {
          decorations: previous.decorations.map(tr.mapping, tr.doc),
          editable: previous.editable,
        }
      },
    },
    props: {
      decorations: (state) => codeBlockRenderModePluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
    view: (view) => {
      let lastEditable = view.editable
      let refreshHandle: ReturnType<typeof setTimeout> | null = null

      const scheduleRefresh = (currentView: EditorView): void => {
        if (refreshHandle !== null) clearTimeout(refreshHandle)
        refreshHandle = setTimeout(() => {
          refreshHandle = null
          if (currentView.isDestroyed) return
          currentView.dispatch(currentView.state.tr.setMeta(CODE_BLOCK_RENDER_MODE_META, currentView.editable))
        }, 0)
      }

      // 初始化一组节点装饰；之后 editable 切换时装饰变化会促使 NodeView 重新 update。
      scheduleRefresh(view)

      return {
        update: (nextView) => {
          if (nextView.editable === lastEditable) return
          lastEditable = nextView.editable
          scheduleRefresh(nextView)
        },
        destroy: () => {
          if (refreshHandle !== null) clearTimeout(refreshHandle)
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

function createShikiCodeBlockView(initialNode: ProseMirrorNode, view: EditorView) {
  const dom = document.createElement('div')
  setClass(dom, 'not-prose my-3 overflow-hidden rounded-md border border-border/40 bg-muted/30')
  dom.dataset.promaCodeBlock = 'true'

  // 头部栏：语言标签 + 复制按钮
  const header = document.createElement('div')
  header.contentEditable = 'false'
  setClass(header, 'proma-code-header flex h-8 items-center justify-between border-b border-border/30 px-3 text-xs text-muted-foreground')
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
  setClass(body, 'proma-code-source-body markdown-code-block-body overflow-x-auto')

  const editPre = document.createElement('pre')
  setClass(editPre, 'markdown-code-edit-layer m-0 min-h-[3.2em] overflow-x-auto bg-transparent p-4 font-mono text-[13px] leading-[1.6]')
  editPre.style.whiteSpace = 'pre'

  const contentDOM = document.createElement('code')
  setClass(contentDOM, 'block min-h-[1.6em] whitespace-pre bg-transparent p-0 font-mono text-[13px] leading-[1.6]')
  contentDOM.style.whiteSpace = 'pre'
  editPre.appendChild(contentDOM)
  body.appendChild(editPre)

  const mermaidHost = document.createElement('div')
  mermaidHost.contentEditable = 'false'
  setClass(mermaidHost, 'proma-mermaid-preview hidden')
  const mermaidRoot: Root = createRoot(mermaidHost)
  let mermaidRenderTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  dom.appendChild(header)
  dom.appendChild(mermaidHost)
  dom.appendChild(body)

  const scheduleMermaidRender = (nextCode: string | null): void => {
    if (mermaidRenderTimer) clearTimeout(mermaidRenderTimer)
    mermaidRenderTimer = setTimeout(() => {
      mermaidRenderTimer = null
      if (destroyed) return
      mermaidRoot.render(nextCode === null ? null : <MermaidBlock code={nextCode} />)
    }, 0)
  }

  const render = (node: ProseMirrorNode) => {
    const language = String(node.attrs.language ?? 'text') || 'text'
    currentCode = node.textContent
    label.textContent = language === 'text' ? 'Code' : getDisplayName(language)
    const className = language === 'text' ? undefined : `language-${language}`
    const shouldRenderMermaid = !view.editable && shouldRenderMermaidCodeBlock(className, currentCode)
    dom.classList.toggle('proma-code-block--mermaid', shouldRenderMermaid)
    scheduleMermaidRender(shouldRenderMermaid ? currentCode : null)
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
      destroyed = true
      if (mermaidRenderTimer) clearTimeout(mermaidRenderTimer)
      if (copyTimeout) clearTimeout(copyTimeout)
      setTimeout(() => mermaidRoot.unmount(), 0)
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
      return [{
        tag: 'pre',
        preserveWhitespace: 'full',
        getContent: (element, schema) => {
          const code = (element as Element).querySelector('code')
          const text = code ? extractCodeText(code) : (element.textContent || '')
          return text ? Fragment.from(schema.text(text)) : Fragment.empty
        },
      }]
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
      return ({ node, view }) => createShikiCodeBlockView(node, view)
    },

    addProseMirrorPlugins() {
      return [createShikiDecorationsPlugin(themeRef), createCodeBlockRenderModePlugin()]
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
