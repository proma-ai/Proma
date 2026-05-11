import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { highlightCode, highlightCodeSync } from '@proma/core'
import type { FileAccessOptions } from '@proma/shared'

type FileAccessRef = { current: FileAccessOptions | undefined }
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

function resolveMediaSrc(src: string, fileAccessRef: FileAccessRef, apply: (src: string) => void): () => void {
  if (!src || isExternalUrl(src)) {
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

function createMarkdownImageView(initialNode: ProseMirrorNode, fileAccessRef: FileAccessRef) {
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

function createMarkdownVideoView(initialNode: ProseMirrorNode, fileAccessRef: FileAccessRef) {
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
  setClass(dom, 'not-prose my-3 overflow-hidden rounded-md border border-border/40 bg-muted/30')

  const header = document.createElement('div')
  setClass(header, 'flex h-8 items-center justify-between border-b border-border/30 px-3 text-xs text-muted-foreground')
  const label = document.createElement('span')
  header.appendChild(label)

  const body = document.createElement('div')
  setClass(body, '[&_.shiki]:!m-0 [&_.shiki]:!rounded-none [&_.shiki]:!bg-transparent [&_.shiki]:overflow-x-auto [&_.shiki]:p-4 [&_.shiki_code]:text-[13px] [&_.shiki_code]:leading-[1.6]')

  dom.appendChild(header)
  dom.appendChild(body)

  let generation = 0

  const renderFallback = (code: string) => {
    const pre = document.createElement('pre')
    pre.className = 'm-0 overflow-x-auto p-4 text-[13px] leading-[1.6]'
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    pre.appendChild(codeEl)
    body.replaceChildren(pre)
  }

  const render = (node: ProseMirrorNode) => {
    const currentGeneration = ++generation
    const code = node.textContent
    const language = String(node.attrs.language ?? 'text') || 'text'
    label.textContent = language === 'text' ? 'Code' : language

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
    },
    ignoreMutation() {
      return true
    },
  }
}

export function createMarkdownImage(fileAccessRef: FileAccessRef): Node {
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

export function createMarkdownVideo(fileAccessRef: FileAccessRef): Node {
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

export const TaskList = Node.create({
  name: 'taskList',
  group: 'block',
  content: 'taskItem+',

  parseHTML() {
    return [{ tag: 'ul[data-type="taskList"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'taskList', class: 'not-prose my-2 space-y-1 pl-0' }), 0]
  },
})

export const TaskItem = Node.create({
  name: 'taskItem',
  content: 'paragraph block*',
  defining: true,

  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-checked') === 'true',
        renderHTML: (attrs) => ({ 'data-checked': attrs.checked ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      mergeAttributes(HTMLAttributes, { 'data-type': 'taskItem', class: 'flex items-start gap-2' }),
      ['label', { contenteditable: 'false', class: 'mt-[0.2em] inline-flex shrink-0 items-center' },
        ['input', { type: 'checkbox', checked: node.attrs.checked ? 'checked' : undefined, disabled: 'disabled' }],
      ],
      ['div', { class: 'min-w-0 flex-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0' }, 0],
    ]
  },
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
