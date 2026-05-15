/**
 * ScratchPadView — 草稿本编辑器
 *
 * 基于 TipTap 的轻量 Markdown 编辑器，内容持久化到 ~/.proma/scratch-pad.md。
 * 自动保存由 ScratchPadPersistence 组件通过监听 scratchPadContentAtom 统一管理。
 */

import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import MarkdownIt from 'markdown-it'
import { useAtom, useAtomValue } from 'jotai'
import { scratchPadContentAtom, scratchPadLoadedAtom } from '@/atoms/tab-atoms'

const md = new MarkdownIt({ breaks: true, linkify: true })

export function ScratchPadView(): React.ReactElement {
  const [content, setContent] = useAtom(scratchPadContentAtom)
  const loaded = useAtomValue(scratchPadLoadedAtom)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // 用 ref 追踪最新内容，避免在 useEffect deps 里包含 content 导致循环
  const contentRef = React.useRef(content)
  contentRef.current = content

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: '在此随意书写… 支持 Markdown 快捷输入',
      }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML())
    },
    immediatelyRender: false,
  })

  // 仅在初始加载或编辑器重新挂载时同步内容到编辑器。
  // content 不加入 deps：用户每次输入都会更新 atom，若加入 deps 会导致
  // setContent → onUpdate → atom 变化 → setContent 死循环，
  // HTML 规范化解析会吞掉尾部空格和空段落，并重置光标位置。
  React.useEffect(() => {
    if (!loaded || !editor) return
    const latestContent = contentRef.current
    if (latestContent && editor.getHTML() !== latestContent) {
      editor.commands.setContent(latestContent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, editor])

  // 粘贴时自动将 Markdown 转为 HTML 插入
  React.useEffect(() => {
    const el = containerRef.current
    if (!el || !editor) return

    const handlePaste = (e: ClipboardEvent): void => {
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      if (!/[#*>\-`[\]~|]/.test(text)) return

      e.preventDefault()
      e.stopPropagation()
      try {
        const html = md.render(text)
        editor.chain().focus().insertContent(html).run()
      } catch {
        // 转换失败，回退到纯文本插入
        editor.chain().focus().insertContent(text).run()
      }
    }

    el.addEventListener('paste', handlePaste, true)
    return () => el.removeEventListener('paste', handlePaste, true)
  }, [editor])

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex-1 overflow-auto scrollbar-thin px-8 py-6">
        <div className="max-w-3xl mx-auto h-full">
          {loaded ? (
            <EditorContent
              editor={editor}
              className="prose prose-sm dark:prose-invert max-w-none h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:text-sm [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
            />
          ) : (
            <div className="min-h-[200px] flex items-center justify-center">
              <span className="text-sm text-muted-foreground/40">加载中…</span>
            </div>
          )}
        </div>
      </div>
      <div className="h-[28px] border-t border-border/40 px-4 flex items-center">
        <span className="text-[11px] text-muted-foreground/60">
          Scratch Pad — 内容自动保存到本地
        </span>
      </div>
    </div>
  )
}
