import * as React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import type { FileAccessOptions } from '@proma/shared'
import type { MarkdownEditorSelection, MarkdownScrollPosition } from '@/lib/markdown-editor-state'
import { cn } from '@/lib/utils'
import { MARKDOWN_RENDERER_VERSION, markdownToHtml } from '@/lib/markdown-rich-text'
import {
  MathBlock,
  MathInline,
  RawHtmlBlock,
  RawHtmlInline,
  TaskItem,
  TaskList,
  tableExtensions,
  createMarkdownImage,
  createShikiCodeBlock,
  createMarkdownVideo,
} from './markdown-preview-extensions'
import { MarkdownEditorToolbar } from './MarkdownEditorToolbar'
import { TableBubbleMenu } from './TableBubbleMenu'

interface MarkdownRichEditorProps {
  value: string
  editing: boolean
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  onRequestEdit?: () => void
  disabled?: boolean
  fileAccess?: FileAccessOptions
  shikiTheme?: string
  initialScrollPosition?: MarkdownScrollPosition
  onScrollPositionChange?: (position: MarkdownScrollPosition) => void
  initialSelection?: MarkdownEditorSelection | null
  onSelectionChange?: (selection: MarkdownEditorSelection) => void
}

export function MarkdownRichEditor({
  value,
  editing,
  onChange,
  onSave,
  onCancel,
  onRequestEdit,
  disabled,
  fileAccess,
  shikiTheme = 'github-dark',
  initialScrollPosition,
  onScrollPositionChange,
  initialSelection,
  onSelectionChange,
}: MarkdownRichEditorProps): React.ReactElement {
  const isEditable = editing && !disabled
  const markdownRendererVersion = MARKDOWN_RENDERER_VERSION
  const onChangeRef = React.useRef(onChange)
  const onSaveRef = React.useRef(onSave)
  const onCancelRef = React.useRef(onCancel)
  const onRequestEditRef = React.useRef(onRequestEdit)
  const fileAccessRef = React.useRef(fileAccess)
  const isEditableRef = React.useRef(isEditable)
  const disabledRef = React.useRef(disabled)
  const shikiThemeRef = React.useRef(shikiTheme)
  const localMarkdownRef = React.useRef(value)
  const rendererVersionRef = React.useRef(markdownRendererVersion)
  const pendingFocusPosRef = React.useRef<number | null>(null)
  const editorContentRef = React.useRef<HTMLDivElement>(null)
  const restoredScrollKeyRef = React.useRef<string | null>(null)
  const initialScrollPositionRef = React.useRef(initialScrollPosition)
  const initialSelectionRef = React.useRef(initialSelection)
  const onScrollPositionChangeRef = React.useRef(onScrollPositionChange)
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  initialScrollPositionRef.current = initialScrollPosition
  initialSelectionRef.current = initialSelection
  onScrollPositionChangeRef.current = onScrollPositionChange
  onSelectionChangeRef.current = onSelectionChange
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onCancelRef.current = onCancel
  onRequestEditRef.current = onRequestEdit
  fileAccessRef.current = fileAccess
  isEditableRef.current = isEditable
  disabledRef.current = disabled
  shikiThemeRef.current = shikiTheme

  const extensions = React.useMemo(() => [
    createMarkdownImage(fileAccessRef),
    createMarkdownVideo(fileAccessRef),
    RawHtmlBlock,
    RawHtmlInline,
    MathBlock,
    MathInline,
    TaskList,
    TaskItem,
    ...tableExtensions,
    createShikiCodeBlock(shikiThemeRef),
    StarterKit.configure({
      codeBlock: false,
      link: false,
      underline: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        class: 'text-primary underline',
      },
    }),
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: '-',
    }),
  ], [])

  const initialHtml = React.useMemo(() => markdownToHtml(value), [value])
  const editor = useEditor({
    extensions,
    content: initialHtml,
    editable: isEditable,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none min-h-full cursor-text focus:outline-none',
          'px-4 py-3 text-[length:var(--md-preview-font-size,15px)] leading-relaxed',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_pre]:rounded-md [&_pre]:p-3',
          '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.875em]',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
          '[&_table_p]:my-0',
          '[&_input[type=checkbox]]:accent-primary',
        ),
      },
      handleKeyDown: (_view, event) => {
        if (!isEditableRef.current) return false
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancelRef.current()
          return true
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSaveRef.current()
          return true
        }
        return false
      },
      handleDoubleClick: (_view, pos) => {
        if (isEditableRef.current || disabledRef.current || !onRequestEditRef.current) return false
        pendingFocusPosRef.current = pos
        onRequestEditRef.current()
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (!isEditableRef.current) return
      const mdStorage = ed.storage as unknown as Record<string, MarkdownStorage>
      const markdown = mdStorage.markdown?.getMarkdown() ?? ''
      localMarkdownRef.current = markdown
      onChangeRef.current(markdown)
    },
  })

  React.useEffect(() => {
    editor?.setEditable(isEditable)
  }, [editor, isEditable])

  React.useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta('markdownShikiCodeBlockRefresh', true))
  }, [editor, shikiTheme])

  React.useEffect(() => {
    if (!editor) return
    const handleSelectionUpdate = (): void => {
      if (!isEditableRef.current) return
      onSelectionChangeRef.current?.({
        from: editor.state.selection.from,
        to: editor.state.selection.to,
      })
    }
    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  React.useLayoutEffect(() => {
    const selection = initialSelectionRef.current
    if (!editor || !isEditable || !selection) return
    const timer = window.setTimeout(() => {
      const maxPosition = editor.state.doc.content.size
      const from = Math.max(0, Math.min(selection.from, maxPosition))
      const to = Math.max(from, Math.min(selection.to, maxPosition))
      editor.commands.setTextSelection({ from, to })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editor, isEditable])

  React.useLayoutEffect(() => {
    const scrollPosition = initialScrollPositionRef.current
    if (!editor || !isEditable || !scrollPosition) return
    const container = editorContentRef.current
    if (!container) return

    const restoreKey = `${scrollPosition.top}:${scrollPosition.left}`
    if (restoredScrollKeyRef.current === restoreKey) return

    let frameId = 0
    let previousHeight = container.scrollHeight
    let stableFrames = 0
    const restore = (): void => {
      const currentHeight = container.scrollHeight
      if (currentHeight === previousHeight) {
        stableFrames++
      } else {
        stableFrames = 0
        previousHeight = currentHeight
      }
      if (stableFrames >= 3) {
        container.scrollTop = Math.max(0, Math.min(scrollPosition.top, container.scrollHeight - container.clientHeight))
        container.scrollLeft = Math.max(0, Math.min(scrollPosition.left, container.scrollWidth - container.clientWidth))
        restoredScrollKeyRef.current = restoreKey
        frameId = 0
        return
      }
      frameId = requestAnimationFrame(restore)
    }
    frameId = requestAnimationFrame(restore)

    return () => {
      if (frameId) cancelAnimationFrame(frameId)
    }
  }, [editor, isEditable])

  React.useEffect(() => {
    return () => {
      const container = editorContentRef.current
      if (container) {
        onScrollPositionChangeRef.current?.({
          top: container.scrollTop,
          left: container.scrollLeft,
        })
      }
      if (editor && isEditableRef.current) {
        onSelectionChangeRef.current?.({
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        })
      }
    }
  }, [editor])

  React.useEffect(() => {
    if (!editor) return
    const rendererChanged = rendererVersionRef.current !== markdownRendererVersion
    if (!rendererChanged && value === localMarkdownRef.current) return
    const html = markdownToHtml(value)
    localMarkdownRef.current = value
    rendererVersionRef.current = markdownRendererVersion
    const container = editorContentRef.current
    const previousScroll = container
      ? { top: container.scrollTop, left: container.scrollLeft }
      : null
    const previousSelection = editor.state.selection
    editor.commands.setContent(html, { emitUpdate: false })
    const restoreSelection = (): void => {
      const maxPosition = editor.state.doc.content.size
      const from = Math.max(0, Math.min(previousSelection.from, maxPosition))
      const to = Math.max(from, Math.min(previousSelection.to, maxPosition))
      try {
        editor.commands.setTextSelection({ from, to })
      } catch {
        // 外部内容变短时，无法恢复的选区交给 ProseMirror 当前默认选区。
      }
    }
    restoreSelection()
    if (!container || !previousScroll) return
    const restoreView = (): void => {
      restoreSelection()
      container.scrollTop = previousScroll.top
      container.scrollLeft = previousScroll.left
    }
    restoreView()
    const frameId = requestAnimationFrame(restoreView)
    return () => cancelAnimationFrame(frameId)
  }, [editor, value, markdownRendererVersion])

  React.useEffect(() => {
    if (!editor || !isEditable || pendingFocusPosRef.current === null) return
    const pos = pendingFocusPosRef.current
    pendingFocusPosRef.current = null
    const timer = setTimeout(() => {
      const safePos = Math.max(0, Math.min(pos, editor.state.doc.content.size))
      const selection = TextSelection.near(editor.state.doc.resolve(safePos))
      editor.view.dispatch(editor.state.tr.setSelection(selection))
      editor.view.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [editor, isEditable])

  const focusEditorFromBlankArea = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || !isEditable || event.button !== 0) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('.ProseMirror')) return

    event.preventDefault()
    editor.chain().focus('end').run()
  }, [editor, isEditable])

  return (
    // 编辑态：固定高度容器，工具条为固定行、编辑区独立滚动（toolbar 物理上在滚动区之外，
    // 不依赖 position:sticky，彻底避免被内容滚走）。
    // 预览态：内容驱动高度，由外层容器滚动（保持 TOC / 查找栏对外层滚动容器的依赖）。
    <div className={cn('flex flex-col', editing ? 'h-full' : 'min-h-full')}>
      {editing && editor && <MarkdownEditorToolbar editor={editor} />}
      <EditorContent
        ref={editorContentRef}
        editor={editor}
        onMouseDown={focusEditorFromBlankArea}
        onScroll={(event) => {
          onScrollPositionChangeRef.current?.({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
          })
        }}
        className={cn(
          editing ? 'min-h-0 flex-1 overflow-auto scrollbar-thin' : 'h-full min-h-full flex-1',
          isEditable
            ? '[&_.proma-mermaid-preview]:hidden [&_.proma-code-source-body]:block'
            : [
                '[&_.proma-code-block--mermaid]:overflow-visible',
                '[&_.proma-code-block--mermaid]:rounded-none',
                '[&_.proma-code-block--mermaid]:border-0',
                '[&_.proma-code-block--mermaid]:bg-transparent',
                '[&_.proma-code-block--mermaid_.proma-code-header]:hidden',
                '[&_.proma-code-block--mermaid_.proma-mermaid-preview]:block',
                '[&_.proma-code-block--mermaid_.proma-code-source-body]:hidden',
              ],
        )}
      />
      {editing && editor && <TableBubbleMenu editor={editor} />}
    </div>
  )
}
