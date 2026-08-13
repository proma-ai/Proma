/**
 * AgentHistorySelectionLayer — Agent 历史选区引用入口
 *
 * 在 Agent 历史消息里划选文本后，提供两个轻量动作：
 * 1. 添加到当前 Agent 输入框引用
 * 2. 打开 Agent 右侧问答 Tab，用选区作为上下文提问
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentSideChatMapAtom,
  conversationsAtom,
  conversationDraftsAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import type { QuotedSelection } from '@/atoms/preview-atoms'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtom } from '@/atoms/agent-atoms'
import { SelectionActionPopover } from '@/components/selection/SelectionActionPopover'
import { useFocusAgentSessionInput } from '@/hooks/useFocusAgentSessionInput'
import { SELECTION_ACTION_POPOVER_SELECTOR } from '@/lib/quoted-selection'

const MAX_AGENT_HISTORY_QUOTED_CHARS = 2000
const SELECTION_CAPTURE_DEBOUNCE_MS = 80
const SELECTION_NAVIGATION_KEYS = new Set([
  'Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
])

type AgentHistoryMessageRole = 'user' | 'assistant' | 'system'

interface AgentHistorySelection {
  text: string
  x: number
  y: number
  sourceLabel: string
  messageId?: string
  messageRole?: AgentHistoryMessageRole
  selectionStart?: number
  selectionEnd?: number
  turn?: number
}

interface AgentHistorySelectionLayerProps {
  sessionId: string
  rootRef: React.RefObject<HTMLDivElement>
  /** 同一消息内的历史选区优先插入当前 Agent 富文本输入框。 */
  onAddToAgent?: (quote: QuotedSelection) => boolean
}

function getElementFromNode(node: Node | null): Element | null {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

function normalizeSelectedText(text: string): string {
  return text.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim()
}

function getRoleLabel(role?: string): string {
  if (role === 'user') return 'Agent 历史 · 用户消息'
  if (role === 'assistant') return 'Agent 历史 · Agent 回复'
  if (role === 'system') return 'Agent 历史 · 系统消息'
  return 'Agent 历史'
}

function isAgentHistoryMessageRole(role: string | null): role is AgentHistoryMessageRole {
  return role === 'user' || role === 'assistant' || role === 'system'
}

function isInsideExcludedSubtree(node: Node, root: HTMLElement): boolean {
  let element = getElementFromNode(node)
  while (element) {
    if (
      element.hasAttribute('hidden')
      || element.getAttribute('aria-hidden') === 'true'
      || element.getAttribute('data-agent-history-selection-excluded') === 'true'
    ) {
      return true
    }
    if (element === root) break
    element = element.parentElement
  }
  return false
}

function isVisibleRange(range: Range, root: HTMLElement): DOMRect | null {
  const rect = range.getBoundingClientRect()
  const anchorRect = rect.width > 0 || rect.height > 0 ? rect : range.getClientRects()[0]
  if (!anchorRect) return null

  const rootRect = root.getBoundingClientRect()
  if (
    anchorRect.bottom <= rootRect.top
    || anchorRect.top >= rootRect.bottom
    || anchorRect.right <= rootRect.left
    || anchorRect.left >= rootRect.right
  ) {
    return null
  }
  return anchorRect
}

function getTextOffsetWithin(messageElement: Element, container: Node, offset: number): number | undefined {
  try {
    const boundary = document.createRange()
    boundary.selectNodeContents(messageElement)
    boundary.setEnd(container, offset)

    const walker = document.createTreeWalker(messageElement, NodeFilter.SHOW_TEXT)
    let textOffset = 0
    let node = walker.nextNode()
    while (node) {
      const length = node.textContent?.length ?? 0
      if (node === container) return textOffset + Math.min(offset, length)

      const nodeRange = document.createRange()
      nodeRange.selectNodeContents(node)
      if (nodeRange.compareBoundaryPoints(Range.END_TO_END, boundary) <= 0) {
        textOffset += length
        node = walker.nextNode()
        continue
      }
      return textOffset
    }
    return textOffset
  } catch {
    return undefined
  }
}

function getFirstTextNodeInRange(range: Range, root: HTMLElement): Text | null {
  if (range.startContainer.nodeType === Node.TEXT_NODE) return range.startContainer as Text

  const startElement = getElementFromNode(range.startContainer)
  if (!startElement) return null
  const child = range.startContainer.childNodes[range.startOffset] ?? null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  if (child) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text
    walker.currentNode = child
    const descendant = walker.nextNode()
    if (descendant) return descendant as Text
  }

  walker.currentNode = range.startContainer
  return walker.nextNode() as Text | null
}

/**
 * 只从 Range 起点前进到上限；不创建完整 `Selection.toString()` 字符串，也不扫描历史根。
 */
function getBoundedRangeText(
  range: Range,
  root: HTMLElement,
  maxChars: number,
): { rawText: string; truncated: boolean; containsExcludedContent: boolean } {
  const first = getFirstTextNodeInRange(range, root)
  if (!first) return { rawText: '', truncated: false, containsExcludedContent: false }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  walker.currentNode = first
  const chunks: string[] = []
  let consumed = 0
  let node: Node | null = first

  while (node) {
    if (!range.intersectsNode(node)) {
      if (consumed > 0) break
      node = walker.nextNode()
      continue
    }

    if (isInsideExcludedSubtree(node, root)) {
      // 即使 Range 两端可见，也不能跨过中间折叠/隐藏内容并把它带进引用。
      return { rawText: '', truncated: false, containsExcludedContent: true }
    }

    const textNode = node as Text
    const value = textNode.data
    const start = textNode === range.startContainer ? range.startOffset : 0
    const end = textNode === range.endContainer ? range.endOffset : value.length
    if (end > start) {
      const remaining = maxChars + 1 - consumed
      if (remaining <= 0) return { rawText: chunks.join(''), truncated: true, containsExcludedContent: false }
      const part = value.slice(start, Math.min(end, start + remaining))
      chunks.push(part)
      consumed += part.length
      if (consumed > maxChars) {
        return { rawText: chunks.join('').slice(0, maxChars), truncated: true, containsExcludedContent: false }
      }
    }

    if (textNode === range.endContainer) break
    node = walker.nextNode()
  }

  return { rawText: chunks.join(''), truncated: false, containsExcludedContent: false }
}

export function AgentHistorySelectionLayer({
  sessionId,
  rootRef,
  onAddToAgent,
}: AgentHistorySelectionLayerProps): React.ReactElement | null {
  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const selectedChatModel = useAtomValue(selectedModelAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setConversationDrafts = useSetAtom(conversationDraftsAtom)
  const setSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setSidePanelOpen = useSetAtom(agentSidePanelOpenAtom)
  const setSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const focusAgentSessionInput = useFocusAgentSessionInput()
  const [selection, setSelection] = React.useState<AgentHistorySelection | null>(null)
  const selectionRef = React.useRef<AgentHistorySelection | null>(null)
  const pointerSelectingRef = React.useRef(false)
  const captureTimerRef = React.useRef<number | null>(null)
  const openChatPendingRef = React.useRef(false)

  const clearSelection = React.useCallback((): void => {
    selectionRef.current = null
    setSelection((current) => current === null ? current : null)
  }, [])

  const captureSelection = React.useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const activeEl = document.activeElement
    if (activeEl?.closest?.(`.ProseMirror, [data-input-mode], ${SELECTION_ACTION_POPOVER_SELECTOR}`)) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      clearSelection()
      return
    }

    const range = selection.getRangeAt(0)
    const startEl = getElementFromNode(range.startContainer)
    const endEl = getElementFromNode(range.endContainer)
    if (
      !startEl
      || !endEl
      || !root.contains(startEl)
      || !root.contains(endEl)
      || isInsideExcludedSubtree(range.startContainer, root)
      || isInsideExcludedSubtree(range.endContainer, root)
    ) {
      clearSelection()
      return
    }

    const startMessageEl = startEl.closest<HTMLElement>('[data-message-id][data-message-role]')
    const endMessageEl = endEl.closest<HTMLElement>('[data-message-id][data-message-role]')
    const role = startMessageEl?.dataset.messageRole ?? null
    if (
      !startMessageEl
      || !endMessageEl
      || !isAgentHistoryMessageRole(role)
      || startMessageEl.dataset.agentLive === 'true'
      || endMessageEl.dataset.agentLive === 'true'
    ) {
      // 流式尾部只渲染有界预览，文本偏移与完成后的完整消息不同，不能生成不可恢复引用。
      clearSelection()
      return
    }

    const anchorRect = isVisibleRange(range, root)
    if (!anchorRect) {
      clearSelection()
      return
    }

    const { rawText, truncated, containsExcludedContent } = getBoundedRangeText(range, root, MAX_AGENT_HISTORY_QUOTED_CHARS)
    if (containsExcludedContent) {
      clearSelection()
      return
    }
    const text = normalizeSelectedText(rawText)
    if (!text) {
      clearSelection()
      return
    }

    const sameMessage = startMessageEl === endMessageEl
    const selectionStart = sameMessage
      ? getTextOffsetWithin(startMessageEl, range.startContainer, range.startOffset)
      : undefined
    const unboundedSelectionEnd = sameMessage
      ? getTextOffsetWithin(endMessageEl, range.endContainer, range.endOffset)
      : undefined
    const selectionEnd = truncated && selectionStart !== undefined
      ? selectionStart + rawText.length
      : unboundedSelectionEnd
    const turn = sameMessage ? Number(startMessageEl.dataset.messageTurn) || undefined : undefined
    const nextSelection: AgentHistorySelection = {
      text,
      x: anchorRect.left + anchorRect.width / 2,
      y: Math.max(12, anchorRect.top - 12),
      sourceLabel: sameMessage ? getRoleLabel(role) : 'Agent 历史 · 多条消息',
      messageId: sameMessage ? startMessageEl.dataset.messageId : undefined,
      messageRole: sameMessage ? role : undefined,
      selectionStart,
      selectionEnd,
      turn,
    }
    selectionRef.current = nextSelection
    setSelection(nextSelection)

    if (truncated) {
      toast.warning(`已选中超过 ${MAX_AGENT_HISTORY_QUOTED_CHARS} 字符，仅引用前 ${MAX_AGENT_HISTORY_QUOTED_CHARS} 字符`, {
        id: `agent-history-selection-cap:${sessionId}`,
        duration: 3000,
      })
    }
  }, [clearSelection, rootRef, sessionId])

  const scheduleCaptureSelection = React.useCallback((): void => {
    if (captureTimerRef.current != null) window.clearTimeout(captureTimerRef.current)
    captureTimerRef.current = window.setTimeout(() => {
      captureTimerRef.current = null
      captureSelection()
    }, SELECTION_CAPTURE_DEBOUNCE_MS)
  }, [captureSelection])

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(SELECTION_ACTION_POPOVER_SELECTOR)) return
      pointerSelectingRef.current = true
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
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!event.shiftKey && !SELECTION_NAVIGATION_KEYS.has(event.key)) return
      scheduleCaptureSelection()
    }

    const onDocumentPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(SELECTION_ACTION_POPOVER_SELECTOR)) return
      if (target instanceof Node && root.contains(target)) return
      // 根外点击只清理陈旧候选，不读取 Selection、不计算 Range，也不触发 atom 写入。
      clearSelection()
    }

    // 选区计算监听只绑定到历史根：composer 连续输入和页面其余交互不会进入捕获热路径。
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointerup', onPointerUp)
    root.addEventListener('pointercancel', onPointerCancel)
    root.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    return () => {
      if (captureTimerRef.current != null) {
        window.clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerCancel)
      root.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    }
  }, [clearSelection, rootRef, scheduleCaptureSelection])

  const createQuotedSelection = React.useCallback((candidate: AgentHistorySelection): QuotedSelection => ({
    text: candidate.text,
    filePath: candidate.sourceLabel,
    sourceType: 'agent-history',
    sourceLabel: candidate.sourceLabel,
    messageId: candidate.messageId,
    messageRole: candidate.messageRole,
    selectionStart: candidate.selectionStart,
    selectionEnd: candidate.selectionEnd,
    turn: candidate.turn,
    capturedAt: Date.now(),
  }), [])

  const handleAddToAgent = React.useCallback((): void => {
    const candidate = selectionRef.current
    if (!candidate) return
    const quotedSelection = createQuotedSelection(candidate)
    const insertedInline = onAddToAgent?.(quotedSelection) ?? false
    if (!insertedInline) {
      // 只有用户明确点击“添加到 Agent”后，才允许 fallback 写入全局 atom。
      setQuotedSelectionMap((prev) => new Map(prev).set(sessionId, quotedSelection))
    }
    window.getSelection()?.removeAllRanges()
    clearSelection()
    focusAgentSessionInput(sessionId)
    toast.success('已添加到 Agent 引用')
  }, [clearSelection, createQuotedSelection, focusAgentSessionInput, onAddToAgent, sessionId, setQuotedSelectionMap])

  const handleOpenChatTab = React.useCallback(async (): Promise<void> => {
    const candidate = selectionRef.current
    if (!candidate || openChatPendingRef.current) return
    openChatPendingRef.current = true
    try {
      const conversation = await window.electronAPI.createConversation(
        '历史选区问答',
        selectedChatModel?.modelId,
        selectedChatModel?.channelId,
      )
      const quotedSelection = createQuotedSelection(candidate)
      setConversations((prev) => prev.some((item) => item.id === conversation.id) ? prev : [conversation, ...prev])
      setConversationDrafts((prev) => new Map(prev).set(conversation.id, '我的问题：'))
      // 打开问答 Tab 同样是用户确认动作，允许写入目标会话的待引用 atom。
      setQuotedSelectionMap((prev) => new Map(prev).set(conversation.id, quotedSelection))
      setSideChatMap((prev) => new Map(prev).set(sessionId, conversation.id))
      setSidePanelOpen(true)
      setSidePanelTabMap((prev) => new Map(prev).set(sessionId, 'chat'))
      window.getSelection()?.removeAllRanges()
      clearSelection()
    } catch (error) {
      console.error('[AgentMessages] 打开历史选区聊天标签失败:', error)
      toast.error('打开聊天标签失败')
    } finally {
      openChatPendingRef.current = false
    }
  }, [clearSelection, createQuotedSelection, selectedChatModel, sessionId, setConversationDrafts, setConversations, setQuotedSelectionMap, setSideChatMap, setSidePanelOpen, setSidePanelTabMap])

  return selection && (
    <SelectionActionPopover
      x={selection.x}
      y={selection.y}
      onAddToAgent={handleAddToAgent}
      onOpenChat={handleOpenChatTab}
    />
  )
}
