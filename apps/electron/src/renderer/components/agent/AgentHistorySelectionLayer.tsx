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
import { agentDiffPanelTabAtom, agentSidePanelOpenAtom } from '@/atoms/agent-atoms'
import { SelectionActionPopover } from '@/components/selection/SelectionActionPopover'
import { SELECTION_ACTION_POPOVER_SELECTOR } from '@/lib/quoted-selection'

const MAX_AGENT_HISTORY_QUOTED_CHARS = 2000

interface AgentHistorySelection {
  text: string
  x: number
  y: number
  sourceLabel: string
  messageId?: string
  messageRole?: 'user' | 'assistant' | 'system'
}

interface AgentHistorySelectionLayerProps {
  sessionId: string
  rootRef: React.RefObject<HTMLDivElement>
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

export function AgentHistorySelectionLayer({
  sessionId,
  rootRef,
}: AgentHistorySelectionLayerProps): React.ReactElement {
  const setQuotedSelectionMap = useSetAtom(quotedSelectionMapAtom)
  const selectedChatModel = useAtomValue(selectedModelAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const setConversationDrafts = useSetAtom(conversationDraftsAtom)
  const setSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setSidePanelOpen = useSetAtom(agentSidePanelOpenAtom)
  const setSidePanelTabMap = useSetAtom(agentDiffPanelTabAtom)
  const [selection, setSelection] = React.useState<AgentHistorySelection | null>(null)
  const pointerSelectingRef = React.useRef(false)
  const captureTimerRef = React.useRef<number | null>(null)
  const openChatPendingRef = React.useRef(false)

  const clearSelection = React.useCallback((): void => {
    setSelection(null)
  }, [])

  const captureSelection = React.useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const activeEl = document.activeElement
    if (activeEl?.closest?.(`.ProseMirror, [data-input-mode], ${SELECTION_ACTION_POPOVER_SELECTOR}`)) return

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      clearSelection()
      return
    }

    const range = sel.getRangeAt(0)
    const startEl = getElementFromNode(range.startContainer)
    const endEl = getElementFromNode(range.endContainer)
    if (!startEl || !endEl || !root.contains(startEl) || !root.contains(endEl)) {
      clearSelection()
      return
    }

    const startMessageEl = startEl.closest('[data-message-id]')
    const endMessageEl = endEl.closest('[data-message-id]')
    if (!startMessageEl || !endMessageEl) {
      clearSelection()
      return
    }

    const rawText = normalizeSelectedText(sel.toString())
    if (!rawText) {
      clearSelection()
      return
    }

    const truncated = rawText.length > MAX_AGENT_HISTORY_QUOTED_CHARS
    const text = truncated ? rawText.slice(0, MAX_AGENT_HISTORY_QUOTED_CHARS) : rawText
    const rect = range.getBoundingClientRect()
    const firstRect = range.getClientRects()[0]
    const anchorRect = rect.width > 0 || rect.height > 0 ? rect : firstRect
    if (!anchorRect) return

    const sameMessage = startMessageEl === endMessageEl
    const role = sameMessage
      ? (startMessageEl.getAttribute('data-message-role') as AgentHistorySelection['messageRole'] | null)
      : null
    const messageId = sameMessage ? startMessageEl.getAttribute('data-message-id') ?? undefined : undefined

    setSelection({
      text,
      x: anchorRect.left + anchorRect.width / 2,
      y: Math.max(12, anchorRect.top - 12),
      sourceLabel: sameMessage ? getRoleLabel(role ?? undefined) : 'Agent 历史 · 多条消息',
      messageId,
      messageRole: role ?? undefined,
    })

    if (truncated) {
      toast.warning(`已选中超过 ${MAX_AGENT_HISTORY_QUOTED_CHARS} 字符，仅引用前 ${MAX_AGENT_HISTORY_QUOTED_CHARS} 字符`, {
        id: `agent-history-selection-cap:${sessionId}`,
        duration: 3000,
      })
    }
  }, [clearSelection, rootRef, sessionId])

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
    const onSelectionChange = (): void => {
      if (pointerSelectingRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) clearSelection()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest(SELECTION_ACTION_POPOVER_SELECTOR)) return
      if (target instanceof Element && rootRef.current?.contains(target)) {
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
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!event.shiftKey && !['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
      scheduleCaptureSelection()
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      if (captureTimerRef.current != null) {
        window.clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [clearSelection, rootRef, scheduleCaptureSelection])

  const handleAddToAgent = React.useCallback((): void => {
    if (!selection) return
    setQuotedSelectionMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, {
        text: selection.text,
        filePath: selection.sourceLabel,
        sourceType: 'agent-history',
        sourceLabel: selection.sourceLabel,
        messageId: selection.messageId,
        messageRole: selection.messageRole,
        capturedAt: Date.now(),
      })
      return next
    })
    window.getSelection()?.removeAllRanges()
    clearSelection()
    toast.success('已添加到 Agent 引用')
  }, [clearSelection, selection, sessionId, setQuotedSelectionMap])

  const handleOpenChatTab = React.useCallback(async (): Promise<void> => {
    if (!selection) return
    if (openChatPendingRef.current) return
    openChatPendingRef.current = true
    try {
      const conversation = await window.electronAPI.createConversation(
        '历史选区问答',
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
          filePath: selection.sourceLabel,
          sourceType: 'agent-history',
          sourceLabel: selection.sourceLabel,
          messageId: selection.messageId,
          messageRole: selection.messageRole,
          capturedAt: Date.now(),
        })
        return next
      })
      setSideChatMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, conversation.id)
        return next
      })
      setSidePanelOpen(true)
      setSidePanelTabMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, 'chat')
        return next
      })
      window.getSelection()?.removeAllRanges()
      clearSelection()
    } catch (error) {
      console.error('[AgentMessages] 打开历史选区聊天标签失败:', error)
      toast.error('打开聊天标签失败')
    } finally {
      openChatPendingRef.current = false
    }
  }, [
    clearSelection,
    selectedChatModel,
    selection,
    sessionId,
    setConversationDrafts,
    setConversations,
    setQuotedSelectionMap,
    setSideChatMap,
    setSidePanelOpen,
    setSidePanelTabMap,
  ])

  return (
    <>
      {selection && (
        <SelectionActionPopover
          x={selection.x}
          y={selection.y}
          onAddToAgent={handleAddToAgent}
          onOpenChat={handleOpenChatTab}
        />
      )}
    </>
  )
}
