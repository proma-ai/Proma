import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import TaskListExt from '@tiptap/extension-task-list'
import TaskItemExt from '@tiptap/extension-task-item'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { getDisplayName, highlightCode, highlightCodeSync } from '@proma/core'
import type { FileAccessOptions } from '@proma/shared'

type FileAccessRef = { current: FileAccessOptions | undefined }
/** 传 null 表示当前编辑器无会话/文件上下文（如 ScratchPad），跳过路径解析。 */
type FileAccessRefOrNull = FileAccessRef | null
type ThemeRef = { current: string }

function isExternalUrl(src: string): boolean {
  return /^(?:https?:|data:|blob:|file:|proma-file:)/i.test(src)
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe', 'video', 'source', 'summary', 'details'],
    ADD_ATTR: [
      'align',
      'allow',
      'allowfullscreen',
      'colspan',
      'controls',
      'frameborder',
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

function resolveMediaSrc(src: string, fileAccessRef: FileAccessRefOrNull, apply: (src: string) => void): () => void {
  // 外链 / data-URL / blob / file 协议：直接 apply，不走 IPC
  if (!src || isExternalUrl(src)) {
    apply(src)
    return () => {}
  }
  // 无会话上下文：直接显示原始 src（ScratchPad 等无文件解析需求的场景）
  if (fileAccessRef === null) {
    apply(src)
    return () => {}
  }

  let cancelled = false
  apply(src)
  window.electronAPI
    .resolveFilePath(src, fileAccessRef.current)
    .then((result) => {
      if (!cancelled) apply(result?.url ?? src)
    })
    .catch(() => {
      if (!cancelled) apply(src)
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

function createShikiCodeBlockView(initialNode: ProseMirrorNode, themeRef: ThemeRef) {
  const dom = document.createElement('div')
  dom.contentEditable = 'false'
  setClass(dom, 'not-prose my-3 overflow-hidden rounded-md border border-border/40')

  // 头部栏：语言标签 + 复制按钮
  const header = document.createElement('div')
  setClass(header, 'flex h-8 items-center justify-between border-b border-border/30 px-3 text-xs text-muted-foreground bg-muted/30')
  const label = document.createElement('span')
  label.className = 'font-medium select-none'
  header.appendChild(label)

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-foreground/10 transition-colors text-muted-foreground hover:text-foreground'
  copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span>'
  let copyTimeout: ReturnType<typeof setTimeout> | null = null
  copyBtn.addEventListener('click', () => {
    const code = (dom as any).__currentCode ?? ''
    navigator.clipboard.writeText(code).then(() => {
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>已复制</span>'
      if (copyTimeout) clearTimeout(copyTimeout)
      copyTimeout = setTimeout(() => {
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span>'
      }, 2000)
    }).catch(() => {})
  })
  header.appendChild(copyBtn)

  const body = document.createElement('div')
  setClass(body, '[&_.shiki]:!m-0 [&_.shiki]:!rounded-none [&_.shiki]:!bg-transparent [&_.shiki]:overflow-x-auto [&_.shiki]:p-4 [&_.shiki_code]:text-[13px] [&_.shiki_code]:leading-[1.6] [&_.shiki_code]:font-mono')
  body.style.backgroundColor = 'hsl(var(--code-bg))'

  dom.appendChild(header)
  dom.appendChild(body)

  let generation = 0

  const renderFallback = (code: string) => {
    const pre = document.createElement('pre')
    pre.className = 'm-0 overflow-x-auto p-4 text-[13px] leading-[1.6] font-mono'
    pre.style.backgroundColor = 'hsl(var(--code-bg))'
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    pre.appendChild(codeEl)
    body.replaceChildren(pre)
  }

  const render = (node: ProseMirrorNode) => {
    const currentGeneration = ++generation
    const code = node.textContent
    const language = String(node.attrs.language ?? 'text') || 'text'
    label.textContent = getDisplayName(language)
    ;(dom as any).__currentCode = code

    const sync = highlightCodeSync({ code, language, theme: themeRef.current })
    if (sync) {
      body.innerHTML = sanitizeHtml(sync.html)
      return
    }

    renderFallback(code)
    highlightCode({ code, language, theme: themeRef.current })
      .then((result) => {
        if (currentGeneration === generation) body.innerHTML = sanitizeHtml(result.html)
      })
      .catch(() => {
        if (currentGeneration === generation) renderFallback(code)
      })
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
      generation += 1
      if (copyTimeout) clearTimeout(copyTimeout)
    },
    ignoreMutation() {
      return true
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

    renderHTML({ node, HTMLAttributes }) {
      const language = node.attrs.language ? `language-${node.attrs.language}` : undefined
      return ['pre', mergeAttributes(HTMLAttributes), ['code', { class: language }, 0]]
    },

    addNodeView() {
      return ({ node }) => createShikiCodeBlockView(node, themeRef)
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

export const MarkdownTableBlock = Node.create({
  name: 'markdownTableBlock',
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
      tag: 'div[data-type="markdown-table"]',
      getAttrs: (node) => node instanceof HTMLElement
        ? { html: node.dataset.html || '', markdown: node.dataset.markdown || '' }
        : false,
    }]
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'markdown-table',
        'data-html': node.attrs.html,
        'data-markdown': node.attrs.markdown || undefined,
      },
    ]
  },

  addNodeView() {
    return ({ node }) => createStaticHtmlView(node, {
      className: [
        'not-prose my-3 overflow-x-auto',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
        '[&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:align-top',
        '[&_td]:border [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top',
        '[&_tr:nth-child(even)_td]:bg-muted/20',
      ].join(' '),
      getHtml: (nextNode) => String(nextNode.attrs.html ?? ''),
    })
  },
})
