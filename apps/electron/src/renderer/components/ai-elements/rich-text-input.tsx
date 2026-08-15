/**
 * AI Elements - TipTap 富文本输入组件
 *
 * 独立受控组件，不依赖 PromptInput Provider。
 *
 * 功能：
 * - StarterKit + Placeholder + Underline + Link + CodeBlockLowlight
 * - 可选 Mention 扩展（@ 引用文件、/ 触发菜单：Skill、MCP、会话、Todo 和日程）
 * - htmlToMarkdown 转换
 * - IME composition 处理
 * - Enter 提交 / Shift+Enter 换行
 * - 代码块内 Enter 换行例外
 * - 自动扩高
 */

import { useState, useEffect, useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useAtomValue } from 'jotai'
import { useEditor, EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Mention from '@tiptap/extension-mention'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { lowlight } from '@/lib/lowlight'
import { htmlToMarkdown } from '@/lib/markdown-rich-text'
import type { QuotedSelection } from '@/atoms/preview-atoms'
import {
  buildAgentHistoryQuoteLabel,
  parseAgentHistoryQuoteMention,
  serializeAgentHistoryQuoteMention,
} from '@/lib/quoted-selection'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { isImageFilePath } from './file-path-chip'
import { consumeLocalDraftEcho, recordLocalDraftEcho } from '@/lib/input-draft-echo'
import { resolveMentionSuggestionChar } from './mention-utils'
import { richTextRenderingEnabledAtom } from '@/atoms/ui-preferences'
import { createFileMentionSuggestion } from '@/components/file-browser/file-mention-suggestion'
import { getFilePanelDragData, type FilePanelDragItem } from '@/lib/file-panel-drag'
import {
  createMcpMentionSuggestion,
  createPlanningMentionSuggestion,
  createSessionMentionSuggestion,
  createSkillMentionSuggestion,
} from '@/components/agent/mention-suggestions'
import { shouldConvertClipboardTextToAttachment } from '@/lib/clipboard-text-attachment'
import { measurePerformance } from '@/lib/performance-monitor'
import {
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

// ===== 行数计算 =====

const SESSION_QUICK_SWITCH_KEYDOWN_EVENT = 'proma:session-quick-switch-keydown'
const SESSION_QUICK_SWITCH_KEYUP_EVENT = 'proma:session-quick-switch-keyup'

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')
}

function isPrimaryModifierEvent(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return event.key === 'Meta' || event.key === 'OS' || event.code === 'MetaLeft' || event.code === 'MetaRight'
  }
  return event.key === 'Control' || event.code === 'ControlLeft' || event.code === 'ControlRight'
}

function shouldForwardSessionQuickSwitchEvent(event: KeyboardEvent, isMac: boolean): boolean {
  if (isPrimaryModifierEvent(event, isMac)) return true
  if (!/^[1-9]$/.test(event.key)) return false
  if (isMac) {
    return event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  }
  return event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

/** 计算编辑器内容的行数 */
function countEditorLines(editor: ReturnType<typeof useEditor>): number {
  if (!editor) return 0

  const doc = editor.state.doc
  let lineCount = 0

  doc.descendants((node) => {
    if (node.type.name === 'paragraph') {
      const text = node.textContent
      if (!text) {
        lineCount += 1
      } else {
        // 粗略估算：假设每行约50个字符
        lineCount += Math.max(1, Math.ceil(text.length / 50))
      }
    } else if (node.type.name === 'codeBlock') {
      const text = node.textContent
      lineCount += (text.match(/\n/g) || []).length + 1
    } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      node.descendants((child) => {
        if (child.type.name === 'listItem') {
          lineCount += 1
        }
      })
    }
  })

  return lineCount
}

// ===== 组件接口 =====

interface RichTextInputProps {
  /** 当前值（Markdown） */
  value: string
  /** 值变更回调 */
  onChange: (markdown: string) => void
  /** 轻量通知，用于立即更新依赖输入内容的本地控件状态，不序列化整篇文档。 */
  onInputActivity?: (hasContent: boolean) => void
  /** 草稿同步的停顿时间；省略时保留按帧同步的既有交互语义。 */
  draftSyncDelayMs?: number
  /** 提交回调（Enter 键）；传入值可避免草稿同步尚未提交时发送旧内容。 */
  onSubmit: (content?: string, fromEditor?: boolean) => void
  /** 粘贴文件回调（拦截粘贴的文件） */
  onPasteFiles?: (files: File[]) => void
  /** 粘贴超长文本回调（由调用方决定是否转换为附件） */
  onPasteLongText?: (text: string) => void
  /** 触发超长文本粘贴回调的字符数阈值 */
  longTextPasteThreshold?: number
  /** 当前实例的语音输入 ID；同工具栏的 SpeechButton 必须使用相同 ID。 */
  voiceInputId?: string
  /** 占位文字 */
  placeholder?: string
  /** 是否显示建议样式（斜体占位符） */
  suggestionActive?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 自动聚焦触发器（当此值变化时自动聚焦，通常传入对话 ID） */
  autoFocusTrigger?: string | null
  /** 是否支持手动折叠（内容较长时显示折叠按钮） */
  collapsible?: boolean
  /** 是否启用文件、Skill、MCP、会话和规划引用 chip。 */
  enableMentions?: boolean
  /** 工作区根路径（启用 @ 文件引用功能时需要） */
  workspacePath?: string | null
  /** 工作区 slug（启用 / Skill 和 # MCP 功能时需要） */
  workspaceSlug?: string | null
  /** 当前 Agent 会话 ID（用于 & 会话引用中排除自身） */
  sessionId?: string | null
  /** 草稿所属范围；切换范围时强制同步，避免跨会话误认本地回写。 */
  draftScopeKey?: string | null
  /** 调用方明确要求用受控值覆盖编辑器时递增；普通本地 echo 不应递增。 */
  draftSyncVersion?: number
  /** 附加目录路径列表（工作区级，@ 引用时标记为工作区文件） */
  attachedDirs?: string[]
  /** 会话级附加目录路径列表（@ 引用时标记为会话文件） */
  sessionAttachedDirs?: string[]
  /** HTML 草稿值（切换会话恢复时使用，保留 mention 等富文本结构） */
  htmlValue?: string
  /** HTML 值变更回调（用于保存富文本草稿） */
  onHtmlChange?: (html: string) => void
  /** 是否使用 Cmd/Ctrl+Enter 发送（而非 Enter） */
  sendWithCmdEnter?: boolean
  /** 点击 Agent 历史引用 chip 时，用其消息范围触发定位与高亮。 */
  onAgentHistoryQuoteClick?: (quote: QuotedSelection) => void
  className?: string
}

/** RichTextInput 对外暴露的命令接口 */
export interface RichTextInputHandle {
  /** 返回最新 Markdown 草稿，并同步尚未提交的编辑。 */
  getMarkdown: () => string
  /** 在光标处插入文件引用（右侧文件面板拖入时调用） */
  insertFileMentions: (items: FilePanelDragItem[]) => void
  /** 在光标处插入可定位的 Agent 历史引用 chip。 */
  insertAgentHistoryQuoteMention: (quote: QuotedSelection) => boolean
}

/**
 * 富文本输入组件
 * - 基于 TipTap 的 WYSIWYG 编辑器
 * - 支持 Markdown 快捷输入
 * - 无工具栏，纯净输入体验
 */
export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(function RichTextInput({
  value,
  onChange,
  onInputActivity,
  draftSyncDelayMs = 0,
  onSubmit,
  onPasteFiles,
  onPasteLongText,
  longTextPasteThreshold,
  voiceInputId,
  placeholder = '有什么可以帮助到你的呢？',
  suggestionActive = false,
  className,
  disabled = false,
  autoFocusTrigger,
  collapsible = false,
  enableMentions,
  workspacePath,
  workspaceSlug,
  sessionId,
  draftScopeKey,
  draftSyncVersion = 0,
  attachedDirs = [],
  sessionAttachedDirs = [],
  htmlValue,
  onHtmlChange,
  sendWithCmdEnter = false,
  onAgentHistoryQuoteClick,
}: RichTextInputProps, ref: React.Ref<RichTextInputHandle>): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false)
  const inputIdRef = useRef(voiceInputId ?? `rich-text-input-${Math.random().toString(36).slice(2)}`)
  const voicePreviewRef = useRef<VoiceDictationPreviewRange | null>(null)
  // 手动折叠状态：用户主动折叠输入框
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(false)
  // 跟踪 isExpanded 最新值（对比后再 setState，避免每键无谓 setState 触发重渲染）
  const isExpandedRef = useRef(false)
  // 行数检查会遍历整篇 ProseMirror 文档；在输入停顿后再计算，避免长草稿重复扫描。
  const lineCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Agent 输入可以在停顿后同步草稿；其他调用方保持既有的按帧同步。
  const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftSyncFrameRef = useRef<number | null>(null)
  const pendingDraftEditorRef = useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null)
  const pendingDraftScopeKeyRef = useRef<string | null | undefined>(undefined)
  const draftScopeKeyRef = useRef(draftScopeKey)
  draftScopeKeyRef.current = draftScopeKey
  // 跟踪编辑器自己设置的值，用于区分外部设置和内部更新
  const lastEditorValueRef = useRef<string>('')
  // 记录尚未由 props 确认的本地草稿。长文本连续编辑时，React 可能先提交较旧的
  // value；不能把它当作外部更新而整篇 setContent，否则 selection 会被重映射。
  const pendingLocalDraftEchoesRef = useRef<string[]>([])
  // 跟踪 IME 输入状态（中文输入法等）
  const isComposingRef = useRef(false)
  // 保持轻量输入状态回调引用最新，避免每次按键重建 TipTap 编辑器。
  const onInputActivityRef = useRef(onInputActivity)
  onInputActivityRef.current = onInputActivity
  // 保持 onSubmit 引用最新
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  // 保持 onPasteFiles 引用最新
  const onPasteFilesRef = useRef(onPasteFiles)
  onPasteFilesRef.current = onPasteFiles
  // 保持超长文本粘贴配置最新
  const onPasteLongTextRef = useRef(onPasteLongText)
  onPasteLongTextRef.current = onPasteLongText
  const longTextPasteThresholdRef = useRef(longTextPasteThreshold)
  longTextPasteThresholdRef.current = longTextPasteThreshold
  // 保持 onHtmlChange 引用最新
  const onHtmlChangeRef = useRef(onHtmlChange)
  onHtmlChangeRef.current = onHtmlChange
  // 历史引用 chip 的点击需要跨过 TipTap DOM 回调到 AgentView。
  const onAgentHistoryQuoteClickRef = useRef(onAgentHistoryQuoteClick)
  onAgentHistoryQuoteClickRef.current = onAgentHistoryQuoteClick
  // 发送模式引用
  const sendWithCmdEnterRef = useRef(sendWithCmdEnter)
  sendWithCmdEnterRef.current = sendWithCmdEnter
  // 工作区路径引用（给 @ 文件引用使用）
  const workspacePathRef = useRef<string | null>(workspacePath ?? null)
  workspacePathRef.current = workspacePath ?? null
  // 当前会话 ID 引用（给 & 会话和 ~ 规划引用使用）
  const currentSessionIdRef = useRef<string | null>(sessionId ?? null)
  currentSessionIdRef.current = sessionId ?? null
  // 工作区级附加目录路径引用（给 @ 文件引用使用，标记为 workspace）
  const attachedDirsRef = useRef<string[]>(attachedDirs)
  attachedDirsRef.current = attachedDirs
  // 会话级附加目录路径引用（给 @ 文件引用使用，标记为 session）
  const sessionAttachedDirsRef = useRef<string[]>(sessionAttachedDirs)
  sessionAttachedDirsRef.current = sessionAttachedDirs
  // 工作区 slug 引用（给 / Skill 和 # MCP suggestion 使用）
  const workspaceSlugRef = useRef<string | null>(workspaceSlug ?? null)
  workspaceSlugRef.current = workspaceSlug ?? null
  // Mention 活跃状态供各 suggestion 的异步生命周期共享。
  const mentionActiveRef = useRef(false)
  const mentionItemCountRef = useRef(0)

  // 是否启用 Mention 功能：Agent 首帧可能尚未拿到路径/slug/id，但扩展必须先注册。
  const hasMentionSupport = enableMentions ?? (workspacePath !== undefined || workspaceSlug !== undefined)

  // 输入框 Markdown 渲染开关：关闭后为纯文本模式（禁用格式化扩展 + 粘贴跳过 HTML 解析），Mention 仍保留
  const richTextEnabled = useAtomValue(richTextRenderingEnabledAtom)
  const richTextEnabledRef = useRef(richTextEnabled)
  richTextEnabledRef.current = richTextEnabled
  const isMac = useMemo(() => isMacPlatform(), [])
  const openPreview = useOpenPreview()
  const mentionPreviewBasePaths = useMemo(
    () => Array.from(new Set([workspacePath, ...attachedDirs, ...sessionAttachedDirs].filter(Boolean))) as string[],
    [workspacePath, attachedDirs, sessionAttachedDirs],
  )
  // useEditor 只会在 richTextEnabled 变化时重建，事件处理器必须经 ref 读取异步加载的最新路径。
  const mentionPreviewBasePathsRef = useRef<string[]>(mentionPreviewBasePaths)
  mentionPreviewBasePathsRef.current = mentionPreviewBasePaths

  const handleImageMentionClick = useCallback((event: MouseEvent): boolean => {
    const target = event.target
    const activeSessionId = currentSessionIdRef.current
    if (!(target instanceof Element) || !activeSessionId) return false

    const mention = target.closest<HTMLElement>('[data-type="mention"][data-mention-previewable="true"]')
    const filePath = mention?.dataset.id
    if (!filePath) return false

    event.preventDefault()
    const basePaths = mentionPreviewBasePathsRef.current
    openPreview(activeSessionId, {
      filePath,
      previewOnly: true,
      readOnly: true,
      basePaths: basePaths.length > 0 ? basePaths : undefined,
    })
    return true
  }, [openPreview])

  const handleAgentHistoryQuoteClick = useCallback((event: MouseEvent): boolean => {
    const target = event.target
    if (!(target instanceof Element)) return false

    const mention = target.closest<HTMLElement>('[data-type="mention"][data-mention-quote]')
    const payload = mention?.getAttribute('data-mention-quote')
    const quote = payload ? parseAgentHistoryQuoteMention(`&quote:${payload}`) : null
    if (!quote || !onAgentHistoryQuoteClickRef.current) return false

    event.preventDefault()
    event.stopPropagation()
    onAgentHistoryQuoteClickRef.current(quote)
    return true
  }, [])

  const handleAgentHistoryQuoteKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Enter' && event.key !== ' ') return false
    return handleAgentHistoryQuoteClick(event as unknown as MouseEvent)
  }, [handleAgentHistoryQuoteClick])

  const forwardSessionQuickSwitchKeyEvent = useCallback((event: React.KeyboardEvent<HTMLDivElement>, type: 'keydown' | 'keyup'): void => {
    const nativeEvent = event.nativeEvent
    if (!shouldForwardSessionQuickSwitchEvent(nativeEvent, isMac)) return
    window.dispatchEvent(new CustomEvent(
      type === 'keydown' ? SESSION_QUICK_SWITCH_KEYDOWN_EVENT : SESSION_QUICK_SWITCH_KEYUP_EVENT,
      { detail: { event: nativeEvent } },
    ))
  }, [isMac])

  const fileMentionSuggestion = useMemo(
    () => createFileMentionSuggestion(
      workspacePathRef,
      mentionActiveRef,
      attachedDirsRef,
      mentionItemCountRef,
      sessionAttachedDirsRef,
    ),
    [],
  )
  const skillMentionSuggestion = useMemo(
    () => createSkillMentionSuggestion(workspaceSlugRef, mentionActiveRef, mentionItemCountRef),
    [],
  )
  const mcpMentionSuggestion = useMemo(
    () => createMcpMentionSuggestion(workspaceSlugRef, mentionActiveRef, mentionItemCountRef),
    [],
  )
  const sessionMentionSuggestion = useMemo(
    () => createSessionMentionSuggestion(currentSessionIdRef, mentionActiveRef, mentionItemCountRef),
    [],
  )
  const syncEditorDraft = useCallback((ed: NonNullable<ReturnType<typeof useEditor>>): string => {
    const html = ed.getHTML()
    if (html === '<p></p>') {
      lastEditorValueRef.current = ''
      pendingLocalDraftEchoesRef.current = recordLocalDraftEcho(pendingLocalDraftEchoesRef.current, '')
      onChange('')
      onHtmlChangeRef.current?.('')
      if (isExpandedRef.current) {
        isExpandedRef.current = false
        setIsExpanded(false)
      }
      setIsManuallyCollapsed(false)
      return ''
    }

    // DOM → Markdown 遍历对长草稿较重；在连续输入停顿后再同步。
    const markdown = measurePerformance('input.html-to-markdown', () => (
      htmlToMarkdown(html, { skipMarkdownEscape: !richTextEnabled })
    ))
    lastEditorValueRef.current = markdown
    pendingLocalDraftEchoesRef.current = recordLocalDraftEcho(pendingLocalDraftEchoesRef.current, markdown)
    onChange(markdown)
    onHtmlChangeRef.current?.(html)

    if (lineCheckTimerRef.current !== null) {
      clearTimeout(lineCheckTimerRef.current)
    }
    lineCheckTimerRef.current = setTimeout(() => {
      lineCheckTimerRef.current = null
      const nextExpanded = countEditorLines(ed) > 5
      if (nextExpanded !== isExpandedRef.current) {
        isExpandedRef.current = nextExpanded
        setIsExpanded(nextExpanded)
      }
    }, 150)
    return markdown
  }, [onChange, richTextEnabled])

  const syncEditorDraftRef = useRef(syncEditorDraft)
  syncEditorDraftRef.current = syncEditorDraft

  const flushPendingDraftSync = useCallback((ed?: NonNullable<ReturnType<typeof useEditor>>): string => {
    if (draftSyncTimerRef.current !== null) {
      clearTimeout(draftSyncTimerRef.current)
      draftSyncTimerRef.current = null
    }
    if (draftSyncFrameRef.current !== null) {
      cancelAnimationFrame(draftSyncFrameRef.current)
      draftSyncFrameRef.current = null
    }
    const pendingEditor = ed ?? pendingDraftEditorRef.current
    const pendingScopeKey = ed ? draftScopeKeyRef.current : pendingDraftScopeKeyRef.current
    pendingDraftEditorRef.current = null
    pendingDraftScopeKeyRef.current = undefined
    if (!pendingEditor || pendingScopeKey !== draftScopeKeyRef.current) return lastEditorValueRef.current
    return syncEditorDraftRef.current(pendingEditor)
  }, [])

  const scheduleDraftSync = useCallback((ed: NonNullable<ReturnType<typeof useEditor>>): void => {
    const scopeKey = draftScopeKeyRef.current
    pendingDraftEditorRef.current = ed
    pendingDraftScopeKeyRef.current = scopeKey
    const flushScheduledDraft = (): void => {
      const pendingEditor = pendingDraftEditorRef.current
      const pendingScopeKey = pendingDraftScopeKeyRef.current
      pendingDraftEditorRef.current = null
      pendingDraftScopeKeyRef.current = undefined
      // 同一编辑器在切换会话时可能还没卸载；旧 scope 的延迟同步绝不能写进新会话草稿。
      if (pendingScopeKey !== draftScopeKeyRef.current || !pendingEditor) return
      syncEditorDraftRef.current(pendingEditor)
    }

    if (draftSyncDelayMs > 0) {
      if (draftSyncTimerRef.current !== null) clearTimeout(draftSyncTimerRef.current)
      draftSyncTimerRef.current = setTimeout(() => {
        draftSyncTimerRef.current = null
        flushScheduledDraft()
      }, draftSyncDelayMs)
      return
    }

    if (draftSyncFrameRef.current !== null) return
    draftSyncFrameRef.current = requestAnimationFrame(() => {
      draftSyncFrameRef.current = null
      flushScheduledDraft()
    })
  }, [draftSyncDelayMs])

  const planningMentionSuggestions = useMemo(
    () => [
      createPlanningMentionSuggestion('~', currentSessionIdRef, mentionActiveRef, mentionItemCountRef),
      createPlanningMentionSuggestion('～', currentSessionIdRef, mentionActiveRef, mentionItemCountRef),
    ],
    [],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 使用 CodeBlockLowlight 替代
        // TipTap v3 StarterKit 默认包含 Link 和 Underline
        // 禁用内置版本，使用下面单独配置的版本
        link: false,
        underline: false,
        // 禁用拖拽插入位置指示器（拖入文件/文件夹时出现的横线）
        dropcursor: false,
        // 纯文本模式：禁用所有格式化扩展，仅保留 Document/Paragraph/Text/HardBreak/History
        ...(richTextEnabled ? {} : {
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          orderedList: false,
          strike: false,
        }),
      }),
      // 富文本模式下注册格式化扩展；纯文本模式下跳过
      ...(richTextEnabled ? [
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          HTMLAttributes: {
            class: 'text-primary underline',
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          HTMLAttributes: {
            class: 'rounded-md p-3 font-mono text-sm',
          },
        }),
      ] : []),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      // Mention 扩展：启用时注册，路径/slug 后续通过 ref 异步更新。
      // 旧统一命令菜单生成的节点仍按自身属性渲染，确保历史草稿兼容。
      // 纯文本模式下仍然保留，确保引用功能可用
      ...(hasMentionSupport ? [
        Mention.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              mentionSuggestionChar: {
                default: '@',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-suggestion-char') || '@',
                renderHTML: (attrs: Record<string, string>) => ({
                  'data-mention-suggestion-char': attrs.mentionSuggestionChar,
                }),
              },
              referenceType: {
                default: null,
                parseHTML: (el: HTMLElement) => {
                  const value = el.getAttribute('data-mention-reference-type')
                  return value === 'todo' || value === 'calendar_event' ? value : null
                },
                renderHTML: (attrs: Record<string, unknown>) => (
                  attrs.referenceType === 'todo' || attrs.referenceType === 'calendar_event'
                    ? { 'data-mention-reference-type': attrs.referenceType }
                    : {}
                ),
              },
              // 单条 Agent 历史选区会保存为可恢复的 URL 编码 payload，而不是外置附件状态。
              agentHistoryQuote: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-quote'),
                renderHTML: (attrs: Record<string, unknown>) => (
                  typeof attrs.agentHistoryQuote === 'string' && attrs.agentHistoryQuote.length > 0
                    ? { 'data-mention-quote': attrs.agentHistoryQuote }
                    : {}
                ),
              },
              // 文件夹引用（右侧文件面板拖入的目录）：渲染为文件夹样式 chip
              isDirectory: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-is-directory') === 'true',
                renderHTML: (attrs: Record<string, unknown>) => attrs.isDirectory
                  ? { 'data-mention-is-directory': 'true' }
                  : {},
              },
              // 兼容此前统一命令菜单生成的历史 draft；新节点不再写入此属性。
              commandMenuMention: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-command-menu-mention') === 'true',
                renderHTML: (attrs: Record<string, unknown>) => attrs.commandMenuMention
                  ? { 'data-command-menu-mention': 'true' }
                  : {},
              },
            }
          },
        }).configure({
          HTMLAttributes: {},
          renderText({ node, suggestion }) {
            const char = resolveMentionSuggestionChar(node.attrs.mentionSuggestionChar, suggestion?.char)
            const label = node.attrs.label ?? node.attrs.id
            const quotePayload = node.attrs.agentHistoryQuote
            return typeof quotePayload === 'string' && quotePayload.length > 0
              ? label
              : `${char}${label}`
          },
          renderHTML({ node, suggestion }) {
            // 旧草稿中的节点也会带有原始字符。不能在未匹配到旧 suggestion 时
            // 回退到唯一注册的 `/` suggestion，否则 @/#/& 会被重写为 /skill。
            const char = resolveMentionSuggestionChar(node.attrs.mentionSuggestionChar, suggestion?.char)
            const label = node.attrs.label ?? node.attrs.id
            const referenceType = node.attrs.referenceType
            const isDirectory = node.attrs.isDirectory === true
            const quotePayload = typeof node.attrs.agentHistoryQuote === 'string' && node.attrs.agentHistoryQuote.length > 0
              ? node.attrs.agentHistoryQuote
              : null
            let chipClass = isDirectory ? 'directory-mention-chip' : 'mention-chip'
            if (quotePayload) chipClass = 'agent-history-quote-chip'
            else if (referenceType === 'todo') chipClass = 'todo-mention-chip'
            else if (referenceType === 'calendar_event') chipClass = 'calendar-event-mention-chip'
            else if (char === '/') chipClass = 'skill-mention-chip'
            else if (char === '#') chipClass = 'mcp-mention-chip'
            else if (char === '&') chipClass = 'session-mention-chip'
            return [
              'span',
              {
                'data-type': 'mention',
                'data-id': node.attrs.id,
                'data-label': node.attrs.label,
                'data-mention-suggestion-char': char,
                ...(referenceType === 'todo' || referenceType === 'calendar_event'
                  ? { 'data-mention-reference-type': referenceType }
                  : {}),
                ...(quotePayload
                  ? {
                      'data-mention-quote': quotePayload,
                      title: '跳转到引用位置并高亮',
                      role: 'button',
                      tabindex: '0',
                      'aria-label': `跳转到${label}的引用位置并高亮`,
                    }
                  : {}),
                ...(node.attrs.commandMenuMention ? { 'data-command-menu-mention': 'true' } : {}),
                ...(isDirectory ? { 'data-mention-is-directory': 'true' } : {}),
                ...(char === '@' && !isDirectory && isImageFilePath(String(node.attrs.id))
                  ? { 'data-mention-previewable': 'true' }
                  : {}),
                class: chipClass,
              },
              `${quotePayload ? '' : char === '@' ? '@' : ''}${label}`,
            ]
          },
          suggestions: [
            fileMentionSuggestion,
            skillMentionSuggestion,
            mcpMentionSuggestion,
            sessionMentionSuggestion,
            ...planningMentionSuggestions,
          ],
        }),
      ] : []),
    ],
    content: value || '',
    editable: !disabled,
    editorProps: {
      // 右侧文件面板拖拽载荷（自定义 MIME）交给外层容器 onDrop 处理，
      // 阻止 ProseMirror 把 text/plain 路径文本当作普通文本插入。
      handleDrop: (_view, event) => {
        if (event.dataTransfer && getFilePanelDragData(event.dataTransfer)) {
          event.preventDefault()
          return true
        }
        return false
      },
      // TipTap mention 节点由 ProseMirror 直接输出 DOM，不能在这里挂 React onClick。
      // 历史引用 chip 需要回流定位；图片 @ 引用则继续打开文件预览。
      handleClick: (_view, _pos, event) => {
        if (handleAgentHistoryQuoteClick(event)) return true
        return handleImageMentionClick(event)
      },
      attributes: {
        class: cn(
          'prose dark:prose-invert max-w-none focus:outline-none',
          'min-h-[101px] w-full text-[15px] leading-[1.6]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_pre]:rounded-md [&_pre]:p-3',
          '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-foreground',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0'
        ),
      },
      // 监听 IME 输入状态
      handleDOMEvents: {
        keydown: (_view, event) => handleAgentHistoryQuoteKeyDown(event),
        focus: () => {
          setLastFocusedVoiceInputId(inputIdRef.current)
          return false
        },
        compositionstart: () => {
          isComposingRef.current = true
          return false
        },
        compositionend: () => {
          isComposingRef.current = false
          return false
        },
        copy: (_view, event) => {
          // 复制时只写纯文本，避免粘贴到外部应用时出现多余空行
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed || !event.clipboardData) return false
          const range = selection.getRangeAt(0)
          const fragment = range.cloneContents()
          const tempDiv = document.createElement('div')
          tempDiv.appendChild(fragment)
          const text = htmlToMarkdown(tempDiv.innerHTML, { skipMarkdownEscape: !richTextEnabledRef.current }) || selection.toString()
          event.preventDefault()
          event.clipboardData.setData('text/plain', text)
          event.clipboardData.setData('text/html', '')
          return true
        },
        blur: () => {
          // 点击发送、切换会话或打开工具栏前会失焦；不要捕获初始化时的 editor，
          // 直接从待同步引用取得当前实例，保证最后一笔编辑会立即提交。
          flushPendingDraftSync()
          return false
        },
      },
      handlePaste: (view, event) => {
        // 拦截粘贴的文件（图片等）
        const clipboardItems = event.clipboardData?.files
        if (clipboardItems && clipboardItems.length > 0 && onPasteFilesRef.current) {
          event.preventDefault()
          onPasteFilesRef.current(Array.from(clipboardItems))
          return true
        }

        const threshold = longTextPasteThresholdRef.current
        const plainText = event.clipboardData?.getData('text/plain') ?? ''

        // 纯文本模式：直接插入原始文本，不经过 HTML 解析
        if (!richTextEnabledRef.current) {
          // 超长文本转附件逻辑仍然生效（按纯文本长度判断）
          if (
            threshold &&
            threshold > 0 &&
            plainText.length >= threshold &&
            onPasteLongTextRef.current
          ) {
            event.preventDefault()
            onPasteLongTextRef.current(plainText)
            return true
          }
          event.preventDefault()
          view.dispatch(view.state.tr.insertText(plainText).setMeta('uiEvent', 'paste'))
          return true
        }

        const html = event.clipboardData?.getData('text/html') ?? ''
        // 预处理 HTML：将 <div> 替换为 <p>，避免 htmlToMarkdown 对 <div> 不分段导致换行丢失
        const text = html
          ? (htmlToMarkdown(
              html
                .replace(/<div\b[^>]*>/gi, '<p>')
                .replace(/<\/div>/gi, '</p>')
            ).trim() || plainText)
          : plainText
        if (
          shouldConvertClipboardTextToAttachment({
            enabled: Boolean(threshold && onPasteLongTextRef.current),
            plainText,
            normalizedText: text,
            threshold: threshold ?? 0,
          }) &&
          onPasteLongTextRef.current
        ) {
          event.preventDefault()
          onPasteLongTextRef.current(text)
          return true
        }
        return false
      },
      handleKeyDown: (view, event) => {
        // macOS 上 Cmd+B/S 被全局快捷键占用，用 Ctrl+B/S 作为格式化替代键
        // 纯文本模式下跳过，避免无效操作且不吃事件
        if (richTextEnabledRef.current) {
          const isMacOS = navigator.platform.startsWith('Mac')
          if (isMacOS && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            const key = event.key.toLowerCase()
            if (key === 'b') {
              event.preventDefault()
              editor?.chain().focus().toggleBold().run()
              return true
            }
            if (key === 's') {
              event.preventDefault()
              editor?.chain().focus().toggleStrike().run()
              return true
            }
          }
        }

        // 发送/换行逻辑：根据 sendWithCmdEnter 模式决定行为
        if (event.key === 'Enter') {
          const cmdEnterMode = sendWithCmdEnterRef.current
          const hasCmd = event.metaKey || event.ctrlKey
          const hasShift = event.shiftKey

          // 如果在代码块中，允许正常换行
          const { state } = view
          const { $from } = state.selection
          const parent = $from.parent
          if (parent.type.name === 'codeBlock') {
            return false // 让 TipTap 处理
          }

          // 检查是否正在输入中文（IME 组合输入）
          if (isComposingRef.current || event.isComposing) {
            return false
          }

          // Suggestion（@ 文件 / / Skill / # MCP / & 会话）弹窗激活时，让 TipTap Suggestion
          // 插件处理 Enter（选中高亮项 / 关闭）。这里用实时 decoration 判定，而非 onStart 里
          // 异步设置的 mentionActiveRef/mentionItemCountRef——后者要等 items() 异步加载
          // （IPC 拉取工作区能力）resolve 后才置位，存在竞态窗口：插件已 active、补全列表
          // 正在加载时按 Enter，旧逻辑会误判为无 mention 激活而把消息直接发送出去。
          // data-decoration-id 由 @tiptap/suggestion 在 active 时同步渲染，与插件状态严格一致。
          if (view.dom.querySelector('[data-decoration-id]')) {
            return false
          }

          // 判断是发送还是换行
          const isSend = cmdEnterMode ? hasCmd : (!hasShift && !hasCmd)

          if (isSend) {
            event.preventDefault()
            // Enter 可能紧跟最后一次输入；先同步当前编辑器，再把最新 Markdown
            // 直接交给发送方，避免 rAF 批处理导致发送旧草稿。
            onSubmitRef.current(editor ? flushPendingDraftSync(editor) : undefined, true)
            return true
          }

          // 换行：普通段落中 Shift+Enter 插入硬换行；列表项内使用拆分列表项生成下一条。
          event.preventDefault()
          // 检查是否在列表项内（遍历祖先节点）
          let isInList = false
          let listItemNode = null
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              isInList = true
              listItemNode = $from.node(d)
              break
            }
          }
          if (isInList && editor) {
            // 空列表项再次按 Enter：退出列表，回到普通输入
            if (listItemNode && listItemNode.textContent === '') {
              editor.chain().focus().liftListItem('listItem').run()
            } else {
              // 发送模式下 Enter 会提交消息，因此 Shift+Enter 也应作为列表续项键。
              editor.chain().focus().splitListItem('listItem').run()
            }
          } else if (editor) {
            if (hasShift) {
              // Shift+Enter：同段落内硬换行
              editor.chain().focus().setHardBreak().run()
            } else {
              // 普通 Enter：拆分为新段落
              editor.chain().focus().splitBlock().run()
            }
          }
          return true
        }

        // Backspace：空列表项时退出列表
        if (event.key === 'Backspace') {
          const { state } = view
          const { $from } = state.selection
          let isInList = false
          let listItemNode = null
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              isInList = true
              listItemNode = $from.node(d)
              break
            }
          }
          if (isInList && listItemNode && listItemNode.textContent === '' && editor) {
            event.preventDefault()
            editor.chain().focus().liftListItem('listItem').run()
            return true
          }
        }

        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      onInputActivityRef.current?.(!ed.isEmpty)
      scheduleDraftSync(ed)
    },
  }, [richTextEnabled])

  // 外部同步或可编辑状态切换偶尔会让 ProseMirror 原生节点失焦。只在变更前编辑器
  // 确实拥有焦点时恢复，避免用户主动点击工具栏/其他输入框后被抢回焦点。
  const runEditorMutationPreservingFocus = useCallback((mutation: () => void): void => {
    if (!editor) return
    const shouldRestoreFocus = editor.isFocused || editor.view.dom.contains(document.activeElement)
    mutation()
    if (shouldRestoreFocus && editor.isEditable && editor.view.dom.isConnected && !editor.isFocused) {
      editor.commands.focus()
    }
  }, [editor])

  // 卸载时取消未触发的行数检查和草稿同步；同步最后一笔输入，避免快速切换会话丢草稿。
  useEffect(() => {
    return () => {
      if (lineCheckTimerRef.current !== null) {
        clearTimeout(lineCheckTimerRef.current)
        lineCheckTimerRef.current = null
      }
      if (draftSyncTimerRef.current !== null) {
        clearTimeout(draftSyncTimerRef.current)
        draftSyncTimerRef.current = null
      }
      if (draftSyncFrameRef.current !== null) {
        cancelAnimationFrame(draftSyncFrameRef.current)
        draftSyncFrameRef.current = null
      }
      const pendingEditor = pendingDraftEditorRef.current
      const pendingScopeKey = pendingDraftScopeKeyRef.current
      pendingDraftEditorRef.current = null
      pendingDraftScopeKeyRef.current = undefined
      if (pendingEditor && pendingScopeKey === draftScopeKeyRef.current) {
        syncEditorDraftRef.current(pendingEditor)
      }
    }
  }, [])

  // 追踪编辑器实例、草稿范围和显式外部同步版本，重建/切换时强制同步。
  const editorInstanceRef = useRef(editor)
  const editorDraftScopeKeyRef = useRef(draftScopeKey)
  const editorDraftSyncVersionRef = useRef(draftSyncVersion)
  // 同步真正的外部 value 变化。用户编辑生成的受控 value 回写可能延迟且乱序到达；
  // 这些本地 echo 必须直接忽略，不能整篇 setContent 后让 ProseMirror 重映射光标。
  useEffect(() => {
    if (!editor) return

    const controllerValue = value
    const isEditorRecreated = editor !== editorInstanceRef.current
    const isDraftScopeChanged = draftScopeKey !== editorDraftScopeKeyRef.current
    const isExplicitExternalSync = draftSyncVersion !== editorDraftSyncVersionRef.current
    editorInstanceRef.current = editor
    editorDraftScopeKeyRef.current = draftScopeKey
    editorDraftSyncVersionRef.current = draftSyncVersion

    if (isDraftScopeChanged || isExplicitExternalSync) {
      pendingLocalDraftEchoesRef.current = []
    } else if (!isEditorRecreated) {
      const remainingEchoes = consumeLocalDraftEcho(pendingLocalDraftEchoesRef.current, controllerValue)
      if (remainingEchoes) {
        // 仅消费一个确定是本地的 echo。即使其文本恰好等于最新草稿，也不能清空队列：
        // a → ab → a 这样的重复值序列仍可能有旧 ab 在路上。
        pendingLocalDraftEchoesRef.current = remainingEchoes
        return
      }

      if (pendingLocalDraftEchoesRef.current.length > 0) {
        // 有本地更新尚未回写时，受控层不带版本的陌生值无法区分来源；调用方必须通过
        // draftSyncVersion 标记真实外部更新，避免旧值覆盖正在编辑的文档。
        return
      }

      if (controllerValue === lastEditorValueRef.current) return
    }

    // 草稿范围切换、发送清空、队列回填等真正外部更新取代了当前本地编辑，
    // 旧 echo 已不再有意义，避免日后误匹配。
    pendingLocalDraftEchoesRef.current = []
    onInputActivityRef.current?.(controllerValue.trim().length > 0)

    if (controllerValue === '') {
      runEditorMutationPreservingFocus(() => {
        editor.commands.clearContent(false)
      })
      lastEditorValueRef.current = ''
      isExpandedRef.current = false
      setIsExpanded(false)
      setIsManuallyCollapsed(false)
    } else if (htmlValue) {
      // 优先使用 HTML 草稿恢复（保留 mention 等富文本节点）。外部同步不应再次触发草稿写回。
      runEditorMutationPreservingFocus(() => {
        editor.commands.setContent(htmlValue, { emitUpdate: false })
      })
      lastEditorValueRef.current = controllerValue
    } else {
      const html = controllerValue
        .split(/\n\n+/)
        .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('')
      runEditorMutationPreservingFocus(() => {
        editor.commands.setContent(html, { emitUpdate: false })
      })
      lastEditorValueRef.current = controllerValue
    }
  }, [draftScopeKey, draftSyncVersion, editor, runEditorMutationPreservingFocus, value])

  // 同步 disabled 状态
  useEffect(() => {
    if (editor) {
      runEditorMutationPreservingFocus(() => {
        editor.setEditable(!disabled)
      })
    }
  }, [editor, disabled, runEditorMutationPreservingFocus])

  // 动态更新 placeholder 文本
  useEffect(() => {
    if (!editor) return
    const placeholderExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === 'placeholder'
    )
    if (placeholderExt) {
      placeholderExt.options.placeholder = placeholder
      // 触发 TipTap 重新渲染 placeholder
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, placeholder])

  // 自动聚焦仅属于「切换到另一会话」：同一输入框因 loading/streaming 等状态重建 editor
  // 时，不应在 100ms 后把用户刚移走的焦点抢回来。
  const lastAutoFocusTriggerRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!editor || disabled) return

    const triggerChanged = lastAutoFocusTriggerRef.current !== autoFocusTrigger
    lastAutoFocusTriggerRef.current = autoFocusTrigger
    if (!triggerChanged) return

    const timer = setTimeout(() => {
      // 延迟期间用户可能已点击另一个控件；只在页面尚未有可编辑目标时自动聚焦。
      const activeElement = document.activeElement as HTMLElement | null
      const activeEditable = activeElement?.matches('input, textarea, [contenteditable="true"]')
      if (!activeEditable) editor.commands.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [editor, disabled, autoFocusTrigger])

  // 对外暴露命令接口：右侧文件面板拖入时，在光标处插入 @file 引用 mention。
  // mention 节点沿用 TipTap Mention 扩展的 attrs（id=路径，label=文件名），
  // 发送时由 htmlToMarkdown 序列化为 @file:{path}，与键盘 @ 引用行为完全一致。
  useImperativeHandle(ref, () => ({
    getMarkdown(): string {
      return flushPendingDraftSync(editor ?? undefined)
    },
    insertFileMentions(items: FilePanelDragItem[]): void {
      if (!editor || items.length === 0) return
      let chain = editor.chain().focus()
      for (const item of items) {
        chain = chain
          .insertContent({
            type: 'mention',
            attrs: {
              id: item.path,
              label: item.name,
              mentionSuggestionChar: '@',
              isDirectory: item.isDirectory ?? false,
            },
          })
          .insertContent(' ')
      }
      chain.run()
    },
    insertAgentHistoryQuoteMention(quote: QuotedSelection): boolean {
      if (!editor) return false
      const marker = serializeAgentHistoryQuoteMention(quote)
      if (!marker) return false

      const payload = marker.slice('&quote:'.length)
      const label = buildAgentHistoryQuoteLabel(quote)
      const id = `${quote.messageId ?? ''}:${quote.selectionStart ?? ''}:${quote.selectionEnd ?? ''}`
      editor.chain().focus()
        .insertContent({
          type: 'mention',
          attrs: {
            id,
            label,
            mentionSuggestionChar: '&',
            agentHistoryQuote: payload,
          },
        })
        .insertContent(' ')
        .run()
      return true
    },
  }), [editor, flushPendingDraftSync])

  // 将预览范围映射到每次用户编辑后的文档位置，避免流式更新覆盖邻近输入。
  useEffect(() => {
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

  // 语音输入在录音期间同步 ASR 的完整结果，停止时再以最终文本替换这段组合文本。
  useEffect(() => {
    if (!editor || disabled) return

    const updatePreview = (event: Event): void => {
      const { sessionId, text, targetInputId } = (event as CustomEvent<{ sessionId?: string; text?: string; targetInputId?: string | null }>).detail ?? {}
      const previewText = text?.trim()
      if (!sessionId || !previewText) return

      const current = voicePreviewRef.current
      if (current && current.sessionId !== sessionId) return
      if (!current && !isVoiceDictationTargetInput(inputIdRef.current, targetInputId)) return
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
  }, [editor, disabled])

  // 语音输入回填：优先插入到当前编辑器的光标位置。
  useEffect(() => {
    if (!editor || disabled) return

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
        if (!isVoiceDictationTargetInput(inputIdRef.current, customEvent.detail?.targetInputId)) return
        editor.chain().focus().insertContent(text).run()
      }
      event.preventDefault()
    }

    window.addEventListener(VOICE_DICTATION_INSERT_EVENT, handler)
    return () => window.removeEventListener(VOICE_DICTATION_INSERT_EVENT, handler)
  }, [editor, disabled])

  // 是否显示折叠按钮：启用 collapsible 且内容已自动扩展
  const showCollapseToggle = collapsible && isExpanded

  return (
    <div
      onKeyDownCapture={(event) => forwardSessionQuickSwitchKeyEvent(event, 'keydown')}
      onKeyUpCapture={(event) => forwardSessionQuickSwitchKeyEvent(event, 'keyup')}
      className={cn(
        'rich-text-input relative w-full overflow-y-auto overscroll-contain scrollbar-thin transition-[max-height] duration-200 ease-in-out',
        isManuallyCollapsed
          ? 'max-h-[101px]'
          : isExpanded ? 'max-h-[500px]' : 'max-h-[200px]',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <EditorContent editor={editor} className="w-full" />
      {/* 折叠/展开切换按钮 — sticky 悬浮在滚动区域内 */}
      {showCollapseToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="sticky bottom-1 float-right mr-2 z-10 p-0.5 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => setIsManuallyCollapsed((prev) => !prev)}
            >
              {isManuallyCollapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isManuallyCollapsed ? '展开输入框' : '折叠输入框'}
          </TooltipContent>
        </Tooltip>
      )}
      <style>{`
        .ProseMirror {
          outline: none;
          padding: 9px 15px 0px;
          font-style: normal;
        }
        .ProseMirror p {
          font-style: normal;
          margin: 0;
        }
        .ProseMirror ul,
        .ProseMirror ol {
          margin: 0;
          padding-left: 1.5em;
        }
        .ProseMirror li {
          margin: 0;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
          max-width: 100%;
          white-space: normal;
          overflow-wrap: anywhere;
          opacity: 0.5;
          font-style: ${suggestionActive ? 'italic' : 'normal'};
        }
        .ProseMirror::-webkit-scrollbar {
          width: 3px;
        }
        .mention-chip {
          background-color: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .mention-chip[data-mention-previewable="true"] {
          cursor: pointer;
        }
        .mention-chip[data-mention-previewable="true"]:hover {
          background-color: hsl(var(--primary) / 0.16);
        }
        .directory-mention-chip {
          background-color: hsl(var(--primary) / 0.14);
          color: hsl(var(--primary));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .directory-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .skill-mention-chip {
          background-color: hsl(270 60% 60% / 0.15);
          color: hsl(270 60% 50%);
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .skill-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .mcp-mention-chip {
          background-color: hsl(160 60% 45% / 0.15);
          color: hsl(160 60% 35%);
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mcp-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='8' x='2' y='2' rx='2' ry='2'/%3E%3Crect width='20' height='8' x='2' y='14' rx='2' ry='2'/%3E%3Cline x1='6' x2='6.01' y1='6' y2='6'/%3E%3Cline x1='6' x2='6.01' y1='18' y2='18'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .todo-mention-chip,
        .calendar-event-mention-chip {
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .todo-mention-chip {
          background-color: hsl(38 90% 50% / 0.16);
          color: hsl(32 80% 38%);
        }
        .calendar-event-mention-chip {
          background-color: hsl(190 75% 45% / 0.14);
          color: hsl(190 72% 34%);
        }
        .todo-mention-chip::before,
        .calendar-event-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .todo-mention-chip::before {
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='6' height='6' x='3' y='5' rx='1'/%3E%3Cpath d='m3 17 2 2 4-4'/%3E%3Cpath d='M13 6h8'/%3E%3Cpath d='M13 12h8'/%3E%3Cpath d='M13 18h8'/%3E%3C/svg%3E");
        }
        .calendar-event-mention-chip::before {
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2v4'/%3E%3Cpath d='M16 2v4'/%3E%3Crect width='18' height='18' x='3' y='4' rx='2'/%3E%3Cpath d='M3 10h18'/%3E%3C/svg%3E");
        }
        .session-mention-chip {
          background-color: hsl(200 80% 50% / 0.14);
          color: hsl(200 80% 40%);
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .session-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3Cpath d='M8 9h8'/%3E%3Cpath d='M8 13h6'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .agent-history-quote-chip {
          background-color: hsl(var(--primary) / 0.12);
          color: hsl(var(--primary));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
          cursor: pointer;
        }
        .agent-history-quote-chip:hover {
          background-color: hsl(var(--primary) / 0.2);
        }
        .agent-history-quote-chip:focus-visible {
          outline: 2px solid hsl(var(--ring));
          outline-offset: 2px;
        }
        .agent-history-quote-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 21c3 0 7-1 7-8V5H3v8h4c0 1.1-.9 2-2 2H3z'/%3E%3Cpath d='M14 21c3 0 7-1 7-8V5h-7v8h4c0 1.1-.9 2-2 2h-2z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
})
