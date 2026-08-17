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
import { TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { FileDown, List, ListTodo, PanelRight, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  scratchPadContentAtom,
  scratchPadLoadedAtom,
  scratchPadScrollPositionsAtom,
  updateScratchPadScrollPosition,
  tabsAtom,
  activeTabIdAtom,
} from '@/atoms/tab-atoms'
import type { ScratchPadViewVariant } from '@/atoms/tab-atoms'
import {
  agentDiffPanelTabAtom,
  currentSessionSidePanelOpenAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentSessionsAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import { agentSideChatMapAtom, conversationsAtom, conversationDraftsAtom, selectedModelAtom } from '@/atoms/chat-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import { useFocusAgentSessionInput } from '@/hooks/useFocusAgentSessionInput'
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
import { htmlToClipboardText, htmlToMarkdown, markdownToHtml } from '@/lib/markdown-rich-text'
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
  VOICE_DICTATION_CLEAR_PREVIEW_EVENT,
  VOICE_DICTATION_INSERT_EVENT,
  VOICE_DICTATION_PREVIEW_EVENT,
  getLastFocusedVoiceInputId,
  isVoiceDictationTargetInput,
  setLastFocusedVoiceInputId,
} from '@/lib/voice-input-focus'
import {
  isVoiceDictationPreviewRangeCurrent,
  type VoiceDictationPreviewRange,
} from '@/lib/voice-dictation-preview'
import { SelectionActionPopover } from '@/components/selection/SelectionActionPopover'
import { SELECTION_ACTION_POPOVER_SELECTOR } from '@/lib/quoted-selection'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { LocalProjectBadge } from '@/components/agent/LocalProjectBadge'
import { openScratchInSplit } from './scratch-pad-opener'
import { resolveScratchPadExportWorkspaceId } from '@/lib/scratch-pad-export-context'

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
  variant: ScratchPadViewVariant
}

function hasSameScrollPosition(
  left: { top: number; left: number },
  right: { top: number; left: number },
): boolean {
  return Math.abs(left.top - right.top) < 0.5 && Math.abs(left.left - right.left) < 0.5
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
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const pendingScrollRestoreRef = React.useRef<{ top: number; left: number } | null>(null)
  const hasUserScrolledRef = React.useRef(false)
  const hasUserScrollIntentRef = React.useRef(false)
  const isRestoringScrollRef = React.useRef(true)
  const [selection, setSelection] = React.useState<ScratchPadSelection | null>(null)
  const pointerSelectingRef = React.useRef(false)
  const captureTimerRef = React.useRef<number | null>(null)
  const openSideChatPendingRef = React.useRef(false)
  const voicePreviewRef = React.useRef<VoiceDictationPreviewRange | null>(null)

  // Image lightbox state for edit functionality
  const [lightboxSrc, setLightboxSrc] = React.useState<string | null>(null)
  const [lightboxMode, setLightboxMode] = React.useState<'preview' | 'editing'>('preview')
  const lightboxGetPosRef = React.useRef<(() => number) | null>(null)

  // 用 ref 追踪最新内容，避免在 useEffect deps 里包含 content 导致循环
  const contentRef = React.useRef(content)
  contentRef.current = content
  // TipTap 的 transaction 可以比屏幕刷新更密集；只在下一帧向全局 atom 发布一次
  // 完整 HTML，避免每键驱动整个 Scratch Pad 容器及持久化监听器更新。
  const pendingContentRef = React.useRef(content)
  const pendingContentEditorRef = React.useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null)
  const contentSyncFrameRef = React.useRef<number | null>(null)

  const flushContentSync = React.useCallback((): void => {
    if (contentSyncFrameRef.current !== null) {
      cancelAnimationFrame(contentSyncFrameRef.current)
      contentSyncFrameRef.current = null
    }
    // 连续输入期间不在每个 transaction 中序列化完整文档；离开页面时再强制拿最新值。
    if (pendingContentEditorRef.current) {
      pendingContentRef.current = pendingContentEditorRef.current.getHTML()
    }
    const nextContent = pendingContentRef.current
    if (contentRef.current !== nextContent) {
      // beforeunload 的同步落盘紧接着读取 atom；直接写入 Jotai store，避免等待 React state flush。
      contentRef.current = nextContent
      store.set(scratchPadContentAtom, nextContent)
    }
  }, [store])

  const scheduleContentSync = React.useCallback((editor: NonNullable<ReturnType<typeof useEditor>>): void => {
    pendingContentEditorRef.current = editor
    if (contentSyncFrameRef.current !== null) return
    contentSyncFrameRef.current = requestAnimationFrame(() => {
      contentSyncFrameRef.current = null
      const pendingEditor = pendingContentEditorRef.current
      if (pendingEditor) pendingContentRef.current = pendingEditor.getHTML()
      const nextContent = pendingContentRef.current
      if (contentRef.current !== nextContent) setContent(nextContent)
    })
  }, [setContent])

  React.useEffect(() => {
    // Electron 的 beforeunload 会先由全局持久化器同步读取 atom；用 capture 阶段先 flush
    // 当前 TipTap 文档，避免 rAF 尚未执行就退出时丢最后一笔输入。
    window.addEventListener('beforeunload', flushContentSync, { capture: true })
    return () => {
      window.removeEventListener('beforeunload', flushContentSync, { capture: true })
      // 卸载时不能丢弃最后一笔输入（例如快速切出 Scratch Pad）。
      flushContentSync()
    }
  }, [flushContentSync])

  const persistScrollPosition = React.useCallback((element?: HTMLElement | null): void => {
    const scrollContainer = element ?? scrollContainerRef.current
    if (!scrollContainer) return

    const nextPosition = {
      top: scrollContainer.scrollTop,
      left: scrollContainer.scrollLeft,
    }
    store.set(scratchPadScrollPositionsAtom, (previous) =>
      updateScratchPadScrollPosition(previous, variant, nextPosition),
    )
  }, [store, variant])

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    const scrollContainer = event.currentTarget
    const pendingPosition = pendingScrollRestoreRef.current
    const currentPosition = {
      top: scrollContainer.scrollTop,
      left: scrollContainer.scrollLeft,
    }

    // 富媒体加载和浏览器 scroll anchoring 也会派发 scroll。恢复期间只接受
    // 明确的用户输入，避免布局变化被误写为新的滚动位置并提前结束恢复。
    if (isRestoringScrollRef.current && hasUserScrollIntentRef.current) {
      pendingScrollRestoreRef.current = null
      hasUserScrolledRef.current = true
      isRestoringScrollRef.current = false
      persistScrollPosition(scrollContainer)
      return
    }

    const isPendingRestore = pendingPosition && hasSameScrollPosition(pendingPosition, currentPosition)

    if (isPendingRestore) {
      pendingScrollRestoreRef.current = null
      return
    }

    // 初始内容同步或异步布局触发的 scroll 没有用户输入意图时，继续等待后续恢复。
    if (isRestoringScrollRef.current) return

    // 无用户输入意图的 scroll 来自异步布局时不写回状态；相应的 observer 或
    // 媒体事件会重新应用保存位置。真实用户滚动会先通过输入事件标记接管。
    if (!hasUserScrollIntentRef.current) return

    pendingScrollRestoreRef.current = null
    hasUserScrolledRef.current = true
    isRestoringScrollRef.current = false
    persistScrollPosition(scrollContainer)
  }, [persistScrollPosition])

  const markUserScrollIntent = React.useCallback((): void => {
    hasUserScrollIntentRef.current = true
  }, [])

  const handleScrollKeyDown = React.useCallback((): void => {
    // 编辑文本也意味着用户已开始主动操控此视图，不能再因迟到的媒体布局移动视口。
    markUserScrollIntent()
  }, [markUserScrollIntent])

  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const selectedChatModel = useAtomValue(selectedModelAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setConversationDrafts = useSetAtom(conversationDraftsAtom)
  const setAgentSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setAgentSidePanelOpen = useSetAtom(currentSessionSidePanelOpenAtom)
  const setAgentSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const focusAgentSessionInput = useFocusAgentSessionInput()

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
    editorProps: {
      handleDOMEvents: {
        // 草稿保存为 Markdown 时段落必须以空行分隔；复制到系统剪贴板时只保留普通文本换行，
        // 避免 Windows/外部编辑器再次将 Markdown 段落间隔渲染为额外空白。
        copy: (_view, event) => {
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed || !event.clipboardData) return false
          const range = selection.getRangeAt(0)
          const fragment = range.cloneContents()
          const tempDiv = document.createElement('div')
          tempDiv.appendChild(fragment)
          const text = htmlToClipboardText(tempDiv.innerHTML) || selection.toString().replace(/\r\n?/g, '\n')
          event.preventDefault()
          event.clipboardData.setData('text/plain', text)
          event.clipboardData.setData('text/html', '')
          return true
        },
      },
    },
    onUpdate: ({ editor }) => {
      scheduleContentSync(editor)
    },
    immediatelyRender: false,
  })

  // ===== 图片编辑 =====

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: Event) => {
      const { src, getPos, mode } = (e as CustomEvent).detail
      setLightboxSrc(src)
      setLightboxMode(mode || 'preview')
      lightboxGetPosRef.current = typeof getPos === 'function' ? getPos : null
    }
    container.addEventListener('scratch-pad-edit-image', handler)
    return () => container.removeEventListener('scratch-pad-edit-image', handler)
  }, [])

  const handleImageEditComplete = React.useCallback((editedDataUrl: string) => {
    const getPos = lightboxGetPosRef.current
    if (editor && getPos) {
      const pos = getPos()
      editor.chain().focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos)
          if (node) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: editedDataUrl, width: null })
          }
          return true
        })
        .run()
    }
    setLightboxSrc(null)
    lightboxGetPosRef.current = null
  }, [editor])

  // ===== 导出 =====

  // 导出目标上下文
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)

  const activeSessionId = React.useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.type === 'agent' || activeTab?.type === 'preview') return activeTab.sessionId
    const agentTab = [...tabs].reverse().find((t) => t.type === 'agent')
    return agentTab?.sessionId ?? null
  }, [tabs, activeTabId])

  const exportWorkspaceId = React.useMemo(
    () => resolveScratchPadExportWorkspaceId(activeSessionId, agentSessions, currentWorkspaceId),
    [activeSessionId, agentSessions, currentWorkspaceId],
  )

  const currentWorkspace = React.useMemo(
    () => workspaces.find((w) => w.id === exportWorkspaceId) ?? null,
    [workspaces, exportWorkspaceId],
  )

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
    focusAgentSessionInput(sessionId)
  }, [clearSelection, focusAgentSessionInput, getTargetAgentSessionId, selection, setQuotedSelectionMap])

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
        if (target === 'session' && activeSessionId && exportWorkspaceId) {
          dirPath = await window.electronAPI.getAgentSessionPath(exportWorkspaceId, activeSessionId)
        } else if (target === 'workspace' && currentWorkspace?.slug) {
          dirPath = await window.electronAPI.getWorkspaceFilesPath(currentWorkspace.slug)
        }
        if (!dirPath) return
        await window.electronAPI.exportScratchPad(markdownContent, dirPath, filename)
      } catch (err) {
        console.error('[ScratchPad] 导出失败:', err)
      }
    },
    [editor, activeSessionId, exportWorkspaceId, currentWorkspace],
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
  React.useLayoutEffect(() => {
    if (!loaded || !editor) return
    const latestContent = contentRef.current
    if (latestContent && editor.getHTML() !== latestContent) {
      editor.commands.setContent(latestContent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, editor])

  // Tab 切换会卸载草稿编辑器。恢复期间保留原目标位置，待内容/媒体尺寸变化后重试；
  // 用户手动滚动后立即停止自动恢复，避免异步布局反过来抢走用户的位置。
  React.useLayoutEffect(() => {
    if (!loaded || !editor) return
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const savedPosition = { ...store.get(scratchPadScrollPositionsAtom)[variant] }
    hasUserScrolledRef.current = false
    hasUserScrollIntentRef.current = false
    pendingScrollRestoreRef.current = null
    isRestoringScrollRef.current = true
    let disposed = false
    let restoreComplete = false
    let restoreSettleTimer: number | null = null

    const scheduleRestoreSettlement = (): void => {
      if (restoreSettleTimer !== null) {
        window.clearTimeout(restoreSettleTimer)
      }
      restoreSettleTimer = window.setTimeout(() => {
        restoreSettleTimer = null
        if (disposed || hasUserScrolledRef.current || hasUserScrollIntentRef.current || restoreComplete) return

        const currentPosition = {
          top: scrollContainer.scrollTop,
          left: scrollContainer.scrollLeft,
        }
        if (!hasSameScrollPosition(currentPosition, savedPosition)) {
          applySavedPosition()
          return
        }

        restoreComplete = true
        isRestoringScrollRef.current = false
        pendingScrollRestoreRef.current = null
      }, 250)
    }

    const applySavedPosition = (): void => {
      if (disposed || hasUserScrolledRef.current || restoreComplete) return
      const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
      const maxLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth)
      const nextPosition = {
        top: Math.max(0, Math.min(savedPosition.top, maxTop)),
        left: Math.max(0, Math.min(savedPosition.left, maxLeft)),
      }

      pendingScrollRestoreRef.current = nextPosition
      scrollContainer.scrollTop = nextPosition.top
      scrollContainer.scrollLeft = nextPosition.left
      const targetReached = hasSameScrollPosition(nextPosition, savedPosition)
        && hasSameScrollPosition(
          { top: scrollContainer.scrollTop, left: scrollContainer.scrollLeft },
          savedPosition,
        )
      isRestoringScrollRef.current = true
      if (targetReached) {
        // 内容节点、图片或浏览器 scroll anchoring 仍可能在本次赋值后改变位置；
        // 只有在最后一次布局信号后的稳定窗口结束，才视为真正恢复完成。
        scheduleRestoreSettlement()
      }
    }

    const scheduleRestore = (): void => {
      if (disposed || hasUserScrolledRef.current || hasUserScrollIntentRef.current) return
      if (restoreComplete) {
        const currentPosition = {
          top: scrollContainer.scrollTop,
          left: scrollContainer.scrollLeft,
        }
        if (hasSameScrollPosition(currentPosition, savedPosition)) return
        restoreComplete = false
        isRestoringScrollRef.current = true
      }
      applySavedPosition()
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleRestore)
    resizeObserver?.observe(scrollContainer)
    resizeObserver?.observe(editor.view.dom)

    // ProseMirror 正文常有固定容器高度，纯文本/节点插入只会增加 scrollHeight，
    // 未必触发 ResizeObserver；直接观察正文变化以便布局稳定后重新恢复目标位置。
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleRestore)
    mutationObserver?.observe(editor.view.dom, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    const handleMediaLoad = (): void => {
      scheduleRestore()
    }
    scrollContainer.addEventListener('load', handleMediaLoad, true)
    scrollContainer.addEventListener('loadeddata', handleMediaLoad, true)
    scheduleRestore()
    // EditorContent 会在挂载后的数帧内完成 ProseMirror 正文插入；此时它的外层高度
    // 可能不变而 scrollHeight 才变大。有限重试避免首次 clamp 把有效位置固定为顶部。
    const restoreRetryTimers = [50, 150, 400].map((delay) => window.setTimeout(scheduleRestore, delay))

    return () => {
      disposed = true
      restoreRetryTimers.forEach((timer) => window.clearTimeout(timer))
      if (restoreSettleTimer !== null) {
        window.clearTimeout(restoreSettleTimer)
      }
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      scrollContainer.removeEventListener('load', handleMediaLoad, true)
      scrollContainer.removeEventListener('loadeddata', handleMediaLoad, true)
      isRestoringScrollRef.current = false
      pendingScrollRestoreRef.current = null
      hasUserScrollIntentRef.current = false
      if (hasUserScrolledRef.current) {
        persistScrollPosition(scrollContainer)
      }
    }
  }, [editor, loaded, persistScrollPosition, store, variant])

  // ===== 语音输入路由 =====

  // 将预览范围映射到每次用户编辑后的文档位置，避免流式更新覆盖邻近输入。
  React.useEffect(() => {
    if (!editor) return

    const mapPreviewRange = ({ transaction }: { transaction: Transaction }): void => {
      const current = voicePreviewRef.current
      if (!current || !transaction.docChanged) return
      const from = transaction.mapping.mapResult(current.from, 1)
      const to = transaction.mapping.mapResult(current.to, -1)
      if (from.deleted && to.deleted) {
        voicePreviewRef.current = null
        return
      }
      voicePreviewRef.current = {
        sessionId: current.sessionId,
        from: from.pos,
        to: Math.max(from.pos, to.pos),
        text: current.text,
      }
    }

    editor.on('transaction', mapPreviewRange)
    return () => {
      editor.off('transaction', mapPreviewRange)
    }
  }, [editor])

  React.useEffect(() => {
    if (!editor) return

    const updatePreview = (event: Event): void => {
      const { sessionId, text, targetInputId } = (event as CustomEvent<{ sessionId?: string; text?: string; targetInputId?: string | null }>).detail ?? {}
      const previewText = text?.trim()
      if (!sessionId || !previewText) return

      const current = voicePreviewRef.current
      if (current && current.sessionId !== sessionId) return
      if (!current && !isVoiceDictationTargetInput(SCRATCH_PAD_VOICE_INPUT_ID, targetInputId)) return
      const from = current?.from ?? editor.state.selection.from
      const to = current?.to ?? editor.state.selection.to
      editor.view.dispatch(editor.state.tr.insertText(previewText, from, to))
      voicePreviewRef.current = { sessionId, from, to: from + previewText.length, text: previewText }
      event.preventDefault()
    }

    const clearPreviewRange = (): void => {
      const current = voicePreviewRef.current
      if (!current) return
      if (!editor.view.isDestroyed && isVoiceDictationPreviewRangeCurrent(
        current,
        (from, to) => editor.state.doc.textBetween(from, to, '\n', '\n'),
      )) {
        editor.view.dispatch(editor.state.tr.delete(current.from, current.to))
      }
      voicePreviewRef.current = null
    }

    const clearPreview = (event: Event): void => {
      const { sessionId } = (event as CustomEvent<{ sessionId?: string }>).detail ?? {}
      const current = voicePreviewRef.current
      if (!current || current.sessionId !== sessionId) return
      clearPreviewRange()
      event.preventDefault()
    }

    window.addEventListener(VOICE_DICTATION_PREVIEW_EVENT, updatePreview)
    window.addEventListener(VOICE_DICTATION_CLEAR_PREVIEW_EVENT, clearPreview)
    return () => {
      clearPreviewRange()
      window.removeEventListener(VOICE_DICTATION_PREVIEW_EVENT, updatePreview)
      window.removeEventListener(VOICE_DICTATION_CLEAR_PREVIEW_EVENT, clearPreview)
    }
  }, [editor])

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
      const customEvent = event as CustomEvent<{ sessionId?: string; text?: string; targetInputId?: string | null }>
      const text = customEvent.detail?.text?.trim()
      if (!text) return

      const preview = voicePreviewRef.current
      if (preview && preview.sessionId === customEvent.detail?.sessionId) {
        const end = preview.from + text.length
        const transaction = editor.state.tr.insertText(text, preview.from, preview.to)
        transaction.setSelection(TextSelection.create(transaction.doc, end))
        editor.view.dispatch(transaction)
        voicePreviewRef.current = null
      } else {
        if (!isVoiceDictationTargetInput(SCRATCH_PAD_VOICE_INPUT_ID, customEvent.detail?.targetInputId)) return
        editor.chain().focus().insertContent({ type: 'text', text }).run()
      }
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
    ? 'flex-1 overflow-auto scrollbar-thin px-4 pt-4'
    : 'flex-1 overflow-auto scrollbar-thin px-8 pt-6'
  const contentClassName = isPane ? 'h-full max-w-none' : 'max-w-3xl mx-auto h-full'
  const speechWrapperClassName = isPane
    ? 'absolute left-1/2 -translate-x-1/2 bottom-9 z-20'
    : 'absolute left-1/2 -translate-x-1/2 bottom-10 z-20'
  const speechButtonClassName = isPane
    ? 'size-9 rounded-full bg-background/95 border border-border/60 shadow-md backdrop-blur hover:bg-accent text-foreground/80'
    : 'size-11 rounded-full bg-background/95 border border-border/60 shadow-md backdrop-blur hover:bg-accent text-foreground/80'

  return (
    <div ref={containerRef} className="relative flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        className={scrollClassName}
        onScroll={handleScroll}
        onWheelCapture={markUserScrollIntent}
        onPointerDownCapture={markUserScrollIntent}
        onTouchStartCapture={markUserScrollIntent}
        onKeyDownCapture={handleScrollKeyDown}
      >
        <div className={contentClassName}>
          {isPane ? (
            <div className="mb-3 text-[11px] text-muted-foreground">自动保存到本地</div>
          ) : (
            <div className="mb-5 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-semibold tracking-normal text-foreground">草稿页</h1>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    临时记录内容、整理 Todo、暂存剪贴板文本，稍后再导出到会话或项目。
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
              className="scratch-pad-editor prose prose-sm dark:prose-invert max-w-none h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:pb-[33vh] [&_.ProseMirror]:outline-none [&_.ProseMirror]:text-sm [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground/50 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
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
        <SpeechButton className={speechButtonClassName} voiceInputId={SCRATCH_PAD_VOICE_INPUT_ID} />
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
              <span className="text-xs">保存到项目根目录</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>{currentWorkspace?.name ?? '无当前项目'}</span>
                <LocalProjectBadge
                  projectRootPath={currentWorkspace?.projectRootPath}
                  projectRootStatus={currentWorkspace?.projectRootStatus}
                />
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
      <ImageLightbox
        src={lightboxSrc}
        open={!!lightboxSrc}
        onOpenChange={(open) => { if (!open) setLightboxSrc(null) }}
        onEditComplete={handleImageEditComplete}
        initialMode={lightboxMode}
      />
    </div>
  )
}
