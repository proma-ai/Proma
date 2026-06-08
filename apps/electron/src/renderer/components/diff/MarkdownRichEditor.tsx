import * as React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import type { FileAccessOptions } from '@proma/shared'
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
    const rendererChanged = rendererVersionRef.current !== markdownRendererVersion
    if (!rendererChanged && value === localMarkdownRef.current) return
    const html = markdownToHtml(value)
    localMarkdownRef.current = value
    rendererVersionRef.current = markdownRendererVersion
    editor.commands.setContent(html, { emitUpdate: false })
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
    <div className="flex h-full min-h-full flex-col">
      {editing && editor && <MarkdownEditorToolbar editor={editor} />}
      <EditorContent
        editor={editor}
        onMouseDown={focusEditorFromBlankArea}
        className={cn(
          'h-full min-h-full flex-1',
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
