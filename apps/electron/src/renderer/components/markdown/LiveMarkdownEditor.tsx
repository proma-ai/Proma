import * as React from 'react'
import { syntaxTree } from '@codemirror/language'
import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view'
import ink, { type Instance } from 'ink-mde'
import { cn } from '@/lib/utils'
import { createLiveMarkdownBlockPreview, type ResolveLiveMarkdownImageSrc, type SaveLiveMarkdownPastedImage, type ChangeLiveMarkdownProperties } from './LiveMarkdownPreview'
export type { ChangeLiveMarkdownProperties } from './LiveMarkdownPreview'
export type { LiveMarkdownPropertyEntry } from './live-markdown-frontmatter'
import type { LiveMarkdownPropertyEntry } from './live-markdown-frontmatter'

export interface LiveMarkdownEditorHandle {
  focus: () => void
  insert: (text: string) => void
  getHost: () => HTMLDivElement | null
  getView: () => EditorView | null
}

/** CodeMirror 选区的文本与可用于浮层定位的视口坐标。 */
export interface LiveMarkdownTextSelection {
  text: string
  x: number
  y: number
}

interface LiveMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  onCancel?: () => void
  /** 编辑器异步挂载完成后通知外层（用于恢复外层滚动位置）。 */
  onReady?: () => void
  /** CodeMirror 的选区不必经过 DOM Selection，直接向外提供可靠的文本与锚点。 */
  onTextSelectionChange?: (selection: LiveMarkdownTextSelection | null) => void
  /** 只读时沿用同一套 Live Preview 渲染，但不允许修改源文档。 */
  readOnly?: boolean
  /** 将本地 Markdown 图片映射为当前来源授权的安全 URL。 */
  resolveImageSrc?: ResolveLiveMarkdownImageSrc
  /** 保存剪贴板图片并返回其可写入 Markdown 的相对来源。 */
  savePastedImage?: SaveLiveMarkdownPastedImage
  /** Vault adapter callback for editing flat YAML Properties. */
  onChangeProperties?: ChangeLiveMarkdownProperties
  /** Vault-only opt-in for replacing flat YAML frontmatter with editable Properties. */
  enableProperties?: boolean
  extensions?: readonly Extension[]
  className?: string
}

interface MeasureView {
  requestMeasure: () => void
}

const markdownSyntaxFocusEffect = StateEffect.define<boolean>()
const markdownSyntaxMarkerNames = new Set([
  'CodeMark',
  'EmphasisMark',
  'HeaderMark',
  'LinkMark',
  'QuoteMark',
  // ink-mde 使用 GFM parser；隐藏 ~~ 定界符，让删除线呈现与 Obsidian Live Preview 一致。
  'StrikethroughMark',
])
const hiddenMarkdownSyntax = Decoration.replace({ class: 'live-markdown-syntax-hidden' })
const pendingListHeading = Decoration.mark({ class: 'live-markdown-pending-list-heading' })

interface MarkdownHeading {
  from: number
  to: number
  level: number
  text: string
}

/**
 * ink-mde / CodeMirror 以 span 呈现标题，而现有 TOC 通过 DOM 语义节点采集。
 * 为每个 Markdown 标题行加入稳定 data 属性，让同一套 TOC 能继续发现、定位和高亮它们。
 */
function findMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  // 复用 CodeMirror 已维护的 Markdown 语法树：不会把 fenced code 中的 # 当标题，
  // 也避免每次输入手写扫描整份文档和处理 fence 长度规则。
  syntaxTree(state).iterate({
    enter: ({ type, from }) => {
      const match = /^(ATX|Setext)Heading([1-6])$/.exec(type.name)
      if (!match) return
      const line = state.doc.lineAt(from)
      const text = match[1] === 'ATX'
        ? line.text.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '').replace(/[ \t]+#+[ \t]*$/, '').trim()
        : line.text.trim()
      if (!text) return
      headings.push({ from: line.from, to: line.to, level: Number(match[2]), text })
    },
  })
  return headings
}

function markdownHeadingDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const heading of findMarkdownHeadings(state)) {
    builder.add(heading.from, heading.to, Decoration.mark({
      attributes: {
        'data-markdown-heading': 'true',
        'data-toc-level': String(heading.level),
        'data-toc-text': heading.text,
      },
    }))
  }
  return builder.finish()
}

const markdownHeadingMarkers = StateField.define<DecorationSet>({
  create: markdownHeadingDecorations,
  update: (value, transaction) => transaction.docChanged ? markdownHeadingDecorations(transaction.state) : value,
  provide: (field) => EditorView.decorations.from(field),
})

type MarkdownSyntaxVisibility = {
  focused: boolean
  decorations: DecorationSet
}

function activeCursorLines(state: EditorState, focused: boolean): Set<number> {
  if (!focused) return new Set()
  return new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.head).number))
}

/**
 * Obsidian-style live preview: Markdown markers disappear on inactive lines,
 * but reappear as soon as the cursor enters that line. The formatted content
 * remains visible in both states, so users can edit syntax without a mode flip.
 */
function markdownSyntaxDecorations(state: EditorState, focused: boolean): DecorationSet {
  const activeLines = activeCursorLines(state, focused)
  const builder = new RangeSetBuilder<Decoration>()
  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (type.name === 'SetextHeading2') {
        const underline = state.doc.lineAt(to)
        if (underline.to === state.doc.length && /^-\s*$/.test(underline.text)) {
          const headingLine = state.doc.lineAt(from)
          builder.add(headingLine.from, headingLine.to, pendingListHeading)
        }
      }
      if (!markdownSyntaxMarkerNames.has(type.name)) return
      if (activeLines.has(state.doc.lineAt(from).number)) return
      const markerEnd = type.name === 'HeaderMark' && state.doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
      builder.add(from, markerEnd, hiddenMarkdownSyntax)
    },
  })
  return builder.finish()
}

const markdownSyntaxVisibilityField = StateField.define<MarkdownSyntaxVisibility>({
  create: (state) => ({ focused: false, decorations: markdownSyntaxDecorations(state, false) }),
  update: (value, transaction) => {
    let focused = value.focused
    for (const effect of transaction.effects) {
      if (effect.is(markdownSyntaxFocusEffect)) focused = effect.value
    }
    if (!transaction.docChanged && transaction.selection === undefined && focused === value.focused) return value
    return { focused, decorations: markdownSyntaxDecorations(transaction.state, focused) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

const markdownSyntaxVisibility: Extension[] = [
  markdownSyntaxVisibilityField,
  EditorView.domEventHandlers({
    focus: (_event, view) => {
      view.dispatch({ effects: markdownSyntaxFocusEffect.of(true) })
      return false
    },
    blur: (_event, view) => {
      view.dispatch({ effects: markdownSyntaxFocusEffect.of(false) })
      return false
    },
  }),
]

function createMeasureScheduler(
  getView: () => MeasureView | null,
  scheduleFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): { request: () => void; dispose: () => void } {
  let frame: number | null = null
  return {
    request: () => {
      if (frame !== null) return
      frame = scheduleFrame(() => {
        frame = null
        getView()?.requestMeasure()
      })
    },
    dispose: () => {
      if (frame === null) return
      cancelFrame(frame)
      frame = null
    },
  }
}

/**
 * Reusable ink-mde host. It owns only the editor lifecycle, controlled value,
 * save shortcut, sizing and cleanup; domain-specific Markdown behavior belongs
 * in the extensions supplied by each feature.
 */
export const LiveMarkdownEditor = React.forwardRef<LiveMarkdownEditorHandle, LiveMarkdownEditorProps>(function LiveMarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  onReady,
  onTextSelectionChange,
  readOnly = false,
  resolveImageSrc,
  savePastedImage,
  onChangeProperties,
  enableProperties = false,
  extensions = [],
  className,
}, ref): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const instanceRef = React.useRef<Instance | null>(null)
  const valueRef = React.useRef(value)
  const onChangeRef = React.useRef(onChange)
  const onSaveRef = React.useRef(onSave)
  const onCancelRef = React.useRef(onCancel)
  const onReadyRef = React.useRef(onReady)
  const onTextSelectionChangeRef = React.useRef(onTextSelectionChange)
  const onChangePropertiesRef = React.useRef(onChangeProperties)
  valueRef.current = value
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCancelRef.current = onCancel
  onReadyRef.current = onReady
  onTextSelectionChangeRef.current = onTextSelectionChange
  onChangePropertiesRef.current = onChangeProperties

  const onChangePropertiesProxy = React.useCallback((entries: LiveMarkdownPropertyEntry[], documentValue?: string): void => {
    // The extension is retained for the editor lifetime. Forward its live
    // CodeMirror snapshot so the Vault adapter never falls back to a stale
    // controlled prop after a body edit.
    onChangePropertiesRef.current?.(entries, documentValue)
  }, [])

  React.useImperativeHandle(ref, () => ({
    focus: () => instanceRef.current?.focus(),
    insert: (text) => instanceRef.current?.insert(text),
    getHost: () => hostRef.current,
    getView: () => viewRef.current,
  }), [])

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const mount = document.createElement('div')
    mount.className = 'h-full min-h-0'
    host.appendChild(mount)

    let ready = false
    let disposed = false
    let localInstance: Instance | null = null
    const instancePromise = Promise.resolve(ink(mount, {
      doc: valueRef.current,
      files: { clipboard: false, dragAndDrop: false, injectMarkup: true },
      hooks: { afterUpdate: (nextValue) => { if (ready) onChangeRef.current(nextValue) } },
      interface: {
        appearance: 'auto', attribution: false, autocomplete: false, images: false,
        lists: true, readonly: readOnly, spellcheck: false, toolbar: false,
      },
      plugins: [
        Prec.highest(keymap.of([{
          key: 'Mod-s',
          run: () => {
            onSaveRef.current?.()
            return true
          },
        }, {
          key: 'Escape',
          run: () => {
            onCancelRef.current?.()
            return Boolean(onCancelRef.current)
          },
        }])),
        markdownHeadingMarkers,
        ViewPlugin.define((view) => {
          viewRef.current = view
          let selectionFrame = 0
          const reportSelection = (): void => {
            selectionFrame = 0
            const range = view.state.selection.main
            if (range.empty) {
              onTextSelectionChangeRef.current?.(null)
              return
            }
            const text = view.state.sliceDoc(range.from, range.to).trim()
            // Mouse drag 结束后 CodeMirror 才会同步 selection；延迟到下一帧读取，
            // 覆盖只读/Live Preview 中浏览器 DOM selection 与 editor state 的时序差异。
            const coords = view.coordsAtPos(range.head) ?? view.coordsAtPos(range.from)
            if (!text || !coords) {
              onTextSelectionChangeRef.current?.(null)
              return
            }
            onTextSelectionChangeRef.current?.({
              text,
              x: (coords.left + coords.right) / 2,
              y: coords.top - 12,
            })
          }
          const scheduleSelectionReport = (): void => {
            if (selectionFrame) cancelAnimationFrame(selectionFrame)
            selectionFrame = requestAnimationFrame(reportSelection)
          }
          // 只在鼠标松开后展示动作，不要在拖选过程中不断弹出、跟随选区移动。
          // rAF 仍可覆盖 ink-mde 只读预览的 selection transaction 时序。
          view.dom.addEventListener('mouseup', scheduleSelectionReport)
          return {
            update: (update) => {
              // Pointer selections are reported on mouseup to avoid a moving popover;
              // keyboard selection has no mouseup, so report it after CodeMirror commits.
              const isPointerSelection = update.transactions.some((transaction) => transaction.isUserEvent('select.pointer'))
              if (update.selectionSet && update.view.hasFocus && !isPointerSelection) {
                scheduleSelectionReport()
              }
            },
            destroy: () => {
              view.dom.removeEventListener('mouseup', scheduleSelectionReport)
              if (selectionFrame) cancelAnimationFrame(selectionFrame)
              if (viewRef.current === view) viewRef.current = null
            },
          }
        }),
        ...markdownSyntaxVisibility,
        createLiveMarkdownBlockPreview(resolveImageSrc, savePastedImage, onChangePropertiesProxy, enableProperties),
        ...extensions,
      ].map((extension) => ({ type: 'default' as const, value: extension })),
      search: false,
      toolbar: { bold: false, code: false, codeBlock: false, heading: false, image: false, italic: false, link: false, list: false, orderedList: false, quote: false, taskList: false, upload: false },
    }))
    void instancePromise.then((instance) => {
      localInstance = instance
      if (disposed) {
        instance.destroy()
        return
      }
      instanceRef.current = instance
      if (instance.getDoc() !== valueRef.current) instance.update(valueRef.current)
      ready = true
      onReadyRef.current?.()
    })

    const scheduler = createMeasureScheduler(() => viewRef.current)
    const resizeObserver = new ResizeObserver(scheduler.request)
    resizeObserver.observe(host)
    const onTransitionEnd = (event: TransitionEvent): void => {
      const target = event.target
      if ((event.propertyName === 'width' || event.propertyName === 'height') && target instanceof Element && target.contains(host)) scheduler.request()
    }
    window.addEventListener('transitionend', onTransitionEnd)
    scheduler.request()

    return () => {
      disposed = true
      ready = false
      resizeObserver.disconnect()
      scheduler.dispose()
      window.removeEventListener('transitionend', onTransitionEnd)
      if (localInstance) localInstance.destroy()
      if (instanceRef.current === localInstance) instanceRef.current = null
      mount.remove()
    }
  // The editor owns its document state after initialization; external reloads use the effect below.
  // `readOnly` is an ink-mde construction option, so changing it must recreate the instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  React.useEffect(() => {
    const instance = instanceRef.current
    if (!instance || instance.getDoc() === value) return
    // External document refreshes (for example an Agent writing the opened Vault
    // note) must not eject a reader back to the top of a long CodeMirror document.
    const scroller = hostRef.current?.querySelector<HTMLElement>('.cm-scroller')
    const scrollTop = scroller?.scrollTop
    const scrollLeft = scroller?.scrollLeft
    instance.update(value)
    if (scroller && scrollTop !== undefined && scrollLeft !== undefined) {
      requestAnimationFrame(() => {
        scroller.scrollTop = scrollTop
        scroller.scrollLeft = scrollLeft
      })
    }
  }, [value])

  return <div ref={hostRef} className={cn('live-markdown-editor vault-ink-mde h-full min-h-0', className)} />
})
