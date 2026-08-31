import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  messageSearchNavigationStateAtom,
  updateMessageSearchNavigationAtom,
} from '@/atoms/search-atoms'
import {
  clearMessageSearchHighlight,
  shouldClearMessageSearchHighlightOnSessionLeave,
  type MessageSearchNavigationAttempt,
  type MessageSearchNavigationRequest,
} from '@/lib/message-search-navigation'

interface UseMessageSearchNavigationInput {
  sessionType: 'chat' | 'agent'
  sessionId: string
  ready: boolean
  retryKey: unknown
  locate: (navigation: MessageSearchNavigationRequest) => MessageSearchNavigationAttempt
}

/** 统一管理 Chat/Agent 跨会话搜索定位的请求消费、高亮清理和卸载归属。 */
export function useMessageSearchNavigation(input: UseMessageSearchNavigationInput): void {
  const state = useAtomValue(messageSearchNavigationStateAtom)
  const updateNavigation = useSetAtom(updateMessageSearchNavigationAtom)
  const stateRef = React.useRef(state)
  stateRef.current = state

  React.useEffect(() => {
    const clearOnPointerDown = (): void => {
      if (!stateRef.current.pendingNavigation && !stateRef.current.activeHighlight) return
      clearMessageSearchHighlight()
      updateNavigation({ type: 'clear' })
    }
    document.addEventListener('pointerdown', clearOnPointerDown, true)
    return () => document.removeEventListener('pointerdown', clearOnPointerDown, true)
  }, [updateNavigation])

  React.useEffect(() => () => {
    if (shouldClearMessageSearchHighlightOnSessionLeave(
      stateRef.current,
      input.sessionType,
      input.sessionId,
    )) {
      clearMessageSearchHighlight()
    }
    updateNavigation({
      type: 'leave-session',
      sessionType: input.sessionType,
      sessionId: input.sessionId,
    })
  }, [input.sessionId, input.sessionType, updateNavigation])

  React.useEffect(() => {
    if (state.pendingNavigation || state.activeHighlight) return
    clearMessageSearchHighlight()
  }, [state])

  React.useEffect(() => {
    const navigation = state.pendingNavigation
    if (
      !input.ready
      || !navigation
      || navigation.sessionType !== input.sessionType
      || navigation.sessionId !== input.sessionId
    ) return

    const frame = window.requestAnimationFrame(() => {
      clearMessageSearchHighlight()
      const result = input.locate(navigation)
      if (result === 'applied') updateNavigation({ type: 'activate', navigation })
      if (result === 'failed') updateNavigation({ type: 'clear' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [input.locate, input.ready, input.retryKey, input.sessionId, input.sessionType, state.pendingNavigation, updateNavigation])
}
