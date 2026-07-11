/**
 * ScratchPadView — 草稿本编辑器
 *
 * 基于 TipTap 的轻量 Markdown 编辑器，内容持久化到 ~/.proma/scratch-pad.md。
 * 自动保存由 ScratchPadPersistence 组件通过监听 scratchPadContentAtom 统一管理。
 *
 * 支持：Markdown 快捷输入、图片粘贴、Todo 列表（- [ ] 触发）、代码高亮（lowlight）、数学公式（$..$ / $$..$$ 触发）、导出为 Markdown
 */

import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { FileDown, List, ListTodo, PanelRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { scratchPadContentAtom, scratchPadLoadedAtom, tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import {
  agentDiffPanelTabAtom,
  agentSidePanelOpenAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import { agentSideChatMapAtom, conversationsAtom, conversationDraftsAtom, selectedModelAtom } from '@/atoms/chat-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { lowlight } from '@/lib/lowlight'
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown-rich-text'
import {
  MathBlock,
  MathInline,
  RawHtmlBlock,
  RawHtmlInline,
  TaskItem,
  TaskList,
  tableExtensions,
  createMarkdownImage,
  createMarkdownVideo,
} from '@/components/diff/markdown-preview-extensions'
import { SpeechButton } from '@/components/ai-elements/speech-button'
import {
  SCRATCH_PAD_VOICE_INPUT_ID,
  VOICE_DICTATION_INSERT_EVENT,
  getLastFocusedVoiceInputId,
  setLastFocusedVoiceInputId,
} from '@/lib/voice-input-focus'
import { SelectionActionPopover } from '@/components/selection/SelectionActionPopover'
import { SELECTION_ACTION_POPOVER_SELECTOR } from '@/lib/quoted-selection'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openScratchInSplit } from './scratch-pad-opener'

const MAX_SCRATCH_PAD_QUOTED_CHARS = 2000

interface ScratchPadSelection {
  text: string
  x: number
  y: number
}

interface ScratchPadPaneProps {
  onClose: () => void
}

interface ScratchPadEditorProps {
  variant: 'page' | 'pane'
}

function normalizeSelectionText(text: string): string {
  return text.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim()
}

function getElementFromNode(node: Node | null): Element | null {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

export function ScratchPadView(): React.ReactElement {
  return <ScratchPadEditor variant="page" />
}

export function ScratchPadPane({ onClose }: ScratchPadPaneProps): React.ReactElement {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-content-area titlebar-no-drag">
      <div className="flex-shrink-0 border-b border-border/30 titlebar-no-drag">
        <div className="flex h-[34px] items-center px-3">
          <span className="truncate text-xs text-muted-foreground">
            草稿
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  aria-label="关闭草稿分屏"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>关闭草稿分屏</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScratchPadEditor variant="pane" />
      </div>
    </div>
  )
}

function ScratchPadEditor({ variant }: ScratchPadEditorProps): React.ReactElement {
  const [content, setContent] = useAtom(scratchPadContentAtom)
  const loaded = useAtomValue(scratchPadLoadedAtom)
  const store = useStore()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [selection, setSelection] = React.useState<ScratchPadSelection | null>(null)
  const pointerSelectingRef = React.useRef(false)
  const captureTimerRef = React.useRef<number | null>(null)
  const openSideChatPendingRef = React.useRef(false)

  // 用 ref 追踪最新内容，避免在 useEffect deps 里包含 content 导致循环
  const contentRef = React.useRef(content)
  contentRef.current = content

  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const selectedChatModel = useAtomValue(selectedModelAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setConversationDrafts = useSetAtom(conversationDraftsAtom)
  const setAgentSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenAtom)
  const setAgentSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setAppMode = useSetAtom(appModeAtom)

  const extensions = React.useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false, // 用 CodeBlockLowlight 替代：支持 ``` 触发、可编辑、可删除
    }),
    Placeholder.configure({
      placeholder: '在此随意书写… 支持 Markdown 快捷输入',
    }),
    CodeBlockLowlight.configure({ lowlight }),
    // ScratchPad 无会话/文件上下文，传 null 跳过路径解析（仅支持 data-URL / 外链 / file: 协议）
    createMarkdownImage(null),
    createMarkdownVideo(null),
    RawHtmlBlock,
    RawHtmlInline,
    MathBlock,
    MathInline,
    TaskList,
    TaskItem,
    ...tableExtensions,
  ], [])

  const editor = useEditor({
    extensions,
    content: content || '',
    onUpdate: ({ editor }) => {
      setContent(editor.getHTML())
    },
    immediatelyRender: false,
  })

  // ===== 导出 =====

  // 导出目标上下文
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)

  const currentWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId],
  )

  const activeSessionId = React.useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.type === 'agent' || activeTab?.type === 'preview') return activeTab.sessionId
    const agentTab = [...tabs].reverse().find((t) => t.type === 'agent')
    return agentTab?.sessionId ?? null
  }, [tabs, activeTabId])

  const activeSessionTitle = React.useMemo(() => {
    const agentTab = tabs.find((t) => t.sessionId === activeSessionId && t.type === 'agent')
    return agentTab?.title ?? null
  }, [tabs, activeSessionId])

  const handleOpenScratchPanel = React.useCallback((): void => {
    const opened = openScratchInSplit(store)
    if (!opened) {
      toast.info('先打开一个 Agent 会话，再把草稿放到右侧。')
    }
  }, [store])

  const clearSelection = React.useCallback((): void => {
    setSelection(null)
  }, [])

  const captureSelection = React.useCallback((): void => {
    const editorRoot = editor?.view.dom
    if (!editorRoot) return

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      clearSelection()
      return
    }

    const range = sel.getRangeAt(0)
    const startEl = getElementFromNode(range.startContainer)
    const endEl = getElementFromNode(range.endContainer)
    if (!startEl || !endEl || !editorRoot.contains(startEl) || !editorRoot.contains(endEl)) {
      clearSelection()
      return
    }

    const rawText = normalizeSelectionText(sel.toString())
    if (!rawText) {
      clearSelection()
      return
    }

    const truncated = rawText.length > MAX_SCRATCH_PAD_QUOTED_CHARS
    const text = truncated ? rawText.slice(0, MAX_SCRATCH_PAD_QUOTED_CHARS) : rawText
    const rect = range.getBoundingClientRect()
    const firstRect = range.getClientRects()[0]
    const anchorRect = rect.width > 0 || rect.height > 0 ? rect : firstRect
    if (!anchorRect) return

    setSelection({
      text,
      x: anchorRect.left + anchorRect.width / 2,
      y: Math.max(12, anchorRect.top - 12),
    })

    if (truncated) {
      toast.warning(`已选中超过 ${MAX_SCRATCH_PAD_QUOTED_CHARS} 字符，仅引用前 ${MAX_SCRATCH_PAD_QUOTED_CHARS} 字符`, {
        id: 'scratch-pad-selection-cap',
        duration: 3000,
      })
    }
  }, [clearSelection, editor])

  const scheduleCaptureSelection = React.useCallback((): void => {
    if (captureTimerRef.current != null) {
      window.clearTimeout(captureTimerRef.current)
    }
    captureTimerRef.current = window.setTimeout(() => {
      captureTimerRef.current = null
      captureSelection()
    }, 80)
  }, [captureSelection])

  React.useEffect(() => {
    const editorRoot = editor?.view.dom
    if (!editorRoot) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(SELECTION_ACTION_POPOVER_SELECTOR)) return
      if (target instanceof Element && editorRoot.contains(target)) {
        pointerSelectingRef.current = true
        clearSelection()
        return
      }
      clearSelection()
    }
    const onPointerUp = (): void => {
      if (!pointerSelectingRef.current) return
      pointerSelectingRef.current = false
      scheduleCaptureSelection()
    }
    const onPointerCancel = (): void => {
      pointerSelectingRef.current = false
    }
    const onSelectionChange = (): void => {
      if (pointerSelectingRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        clearSelection()
        return
      }
      scheduleCaptureSelection()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (captureTimerRef.current != null) {
        window.clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [clearSelection, editor, scheduleCaptureSelection])

  const getTargetAgentSessionId = React.useCallback((): string | null => {
    if (activeSessionId) return activeSessionId
    toast.warning('请先打开一个 Agent 会话，再引用草稿选区')
    return null
  }, [activeSessionId])

  const handleAddToAgent = React.useCallback((): void => {
    if (!selection) return
    const sessionId = getTargetAgentSessionId()
    if (!sessionId) return

    setQuotedSelectionMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, {
        text: selection.text,
        filePath: '草稿页',
        sourceType: 'scratch-pad',
        sourceLabel: '草稿页',
        capturedAt: Date.now(),
      })
      return next
    })
    window.getSelection()?.removeAllRanges()
    clearSelection()
    toast.success('已添加到 Agent 引用')
  }, [clearSelection, getTargetAgentSessionId, selection, setQuotedSelectionMap])

  const handleOpenSideChat = React.useCallback(async (): Promise<void> => {
    if (!selection) return
    if (openSideChatPendingRef.current) return
    const sessionId = getTargetAgentSessionId()
    if (!sessionId) return

    openSideChatPendingRef.current = true
    try {
      const conversation = await window.electronAPI.createConversation(
        '草稿选区问答',
        selectedChatModel?.modelId,
        selectedChatModel?.channelId,
      )
      setConversations((prev) => {
        if (prev.some((item) => item.id === conversation.id)) return prev
        return [conversation, ...prev]
      })
      setConversationDrafts((prev) => {
        const next = new Map(prev)
        next.set(conversation.id, '我的问题：')
        return next
      })
      setQuotedSelectionMap((prev) => {
        const next = new Map(prev)
        next.set(conversation.id, {
          text: selection.text,
          filePath: '草稿页',
          sourceType: 'scratch-pad',
          sourceLabel: '草稿页',
          capturedAt: Date.now(),
        })
        return next
      })
      setCurrentAgentSessionId(sessionId)
      setAppMode('agent')
      setAgentSideChatMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, conversation.id)
        return next
      })
      setAgentSidePanelOpen(true)
      setAgentSidePanelTabMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, 'chat')
        return next
      })
      window.getSelection()?.removeAllRanges()
      clearSelection()
    } catch (error) {
      console.error('[ScratchPad] 打开草稿选区右侧问答失败:', error)
      toast.error('打开右侧问答失败')
    } finally {
      openSideChatPendingRef.current = false
    }
  }, [
    clearSelection,
    getTargetAgentSessionId,
    selectedChatModel,
    selection,
    setAgentSideChatMap,
    setAgentSidePanelOpen,
    setAgentSidePanelTabMap,
    setAppMode,
    setConversationDrafts,
    setConversations,
    setCurrentAgentSessionId,
    setQuotedSelectionMap,
  ])

  const makeFilename = () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `scratch-pad-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`
  }

  const handleExport = React.useCallback(
    async (target: 'session' | 'workspace') => {
      if (!editor || editor.isEmpty) return
      // htmlToMarkdown 能正确处理本编辑器的所有自定义节点（math/task/markdownImage/table 等），
      // 而通用 turndown 不认识这些 data-type 节点，会丢内容。
      const markdownContent = htmlToMarkdown(editor.getHTML())
      const filename = makeFilename()

      try {
        let dirPath: string | null = null
        if (target === 'session' && activeSessionId && currentWorkspaceId) {
          dirPath = await window.electronAPI.getAgentSessionPath(currentWorkspaceId, activeSessionId)
        } else if (target === 'workspace' && currentWorkspace?.slug) {
          dirPath = await window.electronAPI.getWorkspaceFilesPath(currentWorkspace.slug)
        }
        if (!dirPath) return
        await window.electronAPI.exportScratchPad(markdownContent, dirPath, filename)
      } catch (err) {
        console.error('[ScratchPad] 导出失败:', err)
      }
    },
    [editor, activeSessionId, currentWorkspaceId, currentWorkspace],
  )

  const handleBrowseExport = React.useCallback(async () => {
    if (!editor || editor.isEmpty) return

    const filename = makeFilename()
    const filePath = await window.electronAPI.chooseExportPath(filename)
    if (!filePath) return

    try {
      const markdownContent = htmlToMarkdown(editor.getHTML())
      // 传空 filename 触发 IPC 的完整路径模式，由 Node.js path.dirname 安全处理
      await window.electronAPI.exportScratchPad(markdownContent, filePath, '')
    } catch (err) {
      console.error('[ScratchPad] 导出失败:', err)
    }
  }, [editor])

  // ===== 内容同步 =====

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

  // ===== 语音输入路由 =====

  // 编辑器获得焦点时，把"语音输入目标"标记为 Scratch Pad；点击语音按钮 / 触发快捷键时编辑器会失焦，
  // 但 ID 保持不变，从而确保识别完成回填的文本会路由到这里而不是被 RichTextInput / agent draft 抢走。
  React.useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handleFocus = (): void => {
      setLastFocusedVoiceInputId(SCRATCH_PAD_VOICE_INPUT_ID)
    }
    dom.addEventListener('focus', handleFocus, true)
    return () => dom.removeEventListener('focus', handleFocus, true)
  }, [editor])

  // 监听语音输入回填事件：仅在"上次聚焦目标"是 Scratch Pad 时消费，插入到当前光标位置
  React.useEffect(() => {
    if (!editor) return
    const handler = (event: Event): void => {
      if (getLastFocusedVoiceInputId() !== SCRATCH_PAD_VOICE_INPUT_ID) return
      const customEvent = event as CustomEvent<{ text?: string }>
      const text = customEvent.detail?.text?.trim()
      if (!text) return
      editor.chain().focus().insertContent({ type: 'text', text }).run()
      event.preventDefault()
    }
    window.addEventListener(VOICE_DICTATION_INSERT_EVENT, handler)
    return () => window.removeEventListener(VOICE_DICTATION_INSERT_EVENT, handler)
  }, [editor])

  // ===== 粘贴处理 =====

  // 粘贴时：图片转 data URL 插入；含 markdown 标记的文本走 markdownToHtml 转 HTML 注入
  React.useEffect(() => {
    const el = containerRef.current
    if (!el || !editor) return

    const handlePaste = (e: ClipboardEvent): void => {
      // 检测剪贴板中的图片
      const items = e.clipboardData?.items
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault()
            e.stopPropagation()
            const file = item.getAsFile()
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              editor.chain().focus().insertContent({
                type: 'markdownImage',
                attrs: { src: reader.result as string, alt: '', title: '' },
              }).run()
            }
            reader.readAsDataURL(file)
            return
          }
        }
      }

      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      // markdown 触发字符：#标题 *强调 >引用 -列表 `代码 [链接 ~删除 |表格 $公式
      if (!/[#*>\-`[\]~|$]/.test(text)) return

      e.preventDefault()
      e.stopPropagation()
      try {
        const html = markdownToHtml(text)
        editor.chain().focus().insertContent(html).run()
      } catch {
        // 转换失败，回退到纯文本插入
        editor.chain().focus().insertContent(text).run()
      }
    }

    el.addEventListener('paste', handlePaste, true)
    return () => el.removeEventListener('paste', handlePaste, true)
  }, [editor])

  const isPane = variant === 'pane'
  const scrollClassName = isPane
    ? 'flex-1 overflow-auto scrollbar-thin px-4 pt-4 pb-20'
    : 'flex-1 overflow-auto scrollbar-thin px-8 pt-6 pb-20'
  const contentClassName = isPane ? 'h-full max-w-none' : 'max-w-3xl mx-auto h-full'
  const speechWrapperClassName = isPane
    ? 'absolute left-1/2 -translate-x-1/2 bottom-9 z-20'
    : 'absolute left-1/2 -translate-x-1/2 bottom-10 z-20'
  const speechButtonClassName = isPane
    ? 'size-9 rounded-full bg-background/95 border border-border/60 shadow-md backdrop-blur hover:bg-accent text-foreground/80'
    : 'size-11 rounded-full bg-background/95 border border-border/60 shadow-md backdrop-blur hover:bg-accent text-foreground/80'

  return (
    <div ref={containerRef} className="relative flex flex-col h-full">
      <div className={scrollClassName}>
        <div className={contentClassName}>
          {isPane ? (
            <div className="mb-3 text-[11px] text-muted-foreground">自动保存到本地</div>
          ) : (
            <div className="mb-5 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold tracking-normal text-foreground">草稿页</h1>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    临时记录内容、整理 Todo、暂存剪贴板文本，稍后再导出到会话或工作区。
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleOpenScratchPanel}
                      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      aria-label="在右侧边栏打开草稿"
                    >
                      <PanelRight className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>在右侧边栏打开草稿（也可将草稿 Tab 拖出标签栏）</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground/80">
                <span className="rounded-md bg-muted px-2 py-1">临时笔记</span>
                <span className="rounded-md bg-muted px-2 py-1">Todo 草稿</span>
                <span className="rounded-md bg-muted px-2 py-1">剪贴板暂存</span>
              </div>
            </div>
          )}
          {loaded ? (
            <EditorContent
              editor={editor}
              className="scratch-pad-editor prose prose-sm dark:prose-invert max-w-none h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:text-sm [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
            />
          ) : (
            <div className="min-h-[200px] flex items-center justify-center">
              <span className="text-sm text-muted-foreground/40">加载中…</span>
            </div>
          )}
        </div>
      </div>
      {selection && (
        <SelectionActionPopover
          x={selection.x}
          y={selection.y}
          onAddToAgent={handleAddToAgent}
          onOpenChat={handleOpenSideChat}
        />
      )}
      {/* 底部居中悬浮：圆形语音输入按钮 */}
      <div className={speechWrapperClassName}>
        <SpeechButton className={speechButtonClassName} />
      </div>
      <div className="h-[28px] border-t border-border/40 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
            className="text-[11px] text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
            title="插入 / 切换待办清单（也可在行首输入 [ ] 加空格）"
          >
            <ListTodo className="w-3 h-3" />
            待办清单
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className="text-[11px] text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
            title="插入 / 切换无序列表（也可在行首输入 - 加空格）"
          >
            <List className="w-3 h-3" />
            无序列表
          </button>
          <span className="text-[11px] text-muted-foreground/60">
            {isPane ? '草稿自动保存' : 'Scratch Pad — 内容自动保存到本地'}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-[11px] text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
              title="导出为 Markdown"
            >
              <FileDown className="w-3 h-3" />
              导出
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
          <DropdownMenuContent align="end" side="top" className="min-w-[240px] z-[9999]">
            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
              导出为 Markdown
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => handleExport('session')}
              disabled={!activeSessionId}
              className="flex flex-col items-start"
            >
              <span className="text-xs">保存到会话目录</span>
              <span className="text-[10px] text-muted-foreground">
                {activeSessionTitle ?? '无活跃会话'}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleExport('workspace')}
              disabled={!currentWorkspace}
              className="flex flex-col items-start"
            >
              <span className="text-xs">保存到工作区目录</span>
              <span className="text-[10px] text-muted-foreground">
                {currentWorkspace?.name ?? '无当前工作区'}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleBrowseExport}>
              浏览选择位置...
            </DropdownMenuItem>
          </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </div>
  )
}
