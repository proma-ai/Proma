/**
 * MessageSelectionContext — 行内消息多选状态
 *
 * 供 Chat 和 Agent 模式共享：每条消息操作行有勾选框，
 * 勾选后点击任意消息的截图按钮导出全部选中消息。
 */

import * as React from 'react'

interface MessageSelectionState {
  selectedIds: Set<string>
  toggle: (id: string) => void
  isSelected: (id: string) => boolean
  clearAll: () => void
}

const MessageSelectionContext = React.createContext<MessageSelectionState | null>(null)

export function MessageSelectionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  const toggle = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const isSelected = React.useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  )

  const clearAll = React.useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const value = React.useMemo(
    () => ({ selectedIds, toggle, isSelected, clearAll }),
    [selectedIds, toggle, isSelected, clearAll],
  )

  return React.createElement(MessageSelectionContext.Provider, { value }, children)
}

/** 获取多选上下文；未包裹 Provider 时返回 safe fallback */
export function useMessageSelectionContext(): MessageSelectionState {
  const ctx = React.useContext(MessageSelectionContext)
  if (!ctx) {
    // fallback: 无 Provider 时不报错，勾选和截图均无效果
    return {
      selectedIds: new Set(),
      toggle: () => {},
      isSelected: () => false,
      clearAll: () => {},
    }
  }
  return ctx
}
