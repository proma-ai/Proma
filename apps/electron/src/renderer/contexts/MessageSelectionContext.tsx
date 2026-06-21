/**
 * MessageSelectionContext — 消息多选状态共享 Context
 *
 * 极简实现：只有选中状态,没有 DOM ref 注册。
 * 截图中使用 data-message-id 属性 + querySelector 定位 DOM 元素。
 */

import * as React from 'react'

interface MessageSelectionContextValue {
  /** 当前选中的消息/Group ID 集合 */
  selectedIds: Set<string>
  /** 是否处于多选模式 */
  isSelectMode: boolean
  /** 切换选中状态 */
  toggleSelect: (id: string) => void
  /** 清除所有选中 */
  clearSelection: () => void
  /** 检查是否已选中 */
  isSelected: (id: string) => boolean
  /** 选中数量 */
  selectedCount: number
}

const MessageSelectionContext = React.createContext<MessageSelectionContextValue | null>(null)

export function useMessageSelection(): MessageSelectionContextValue {
  const ctx = React.useContext(MessageSelectionContext)
  if (!ctx) {
    throw new Error('useMessageSelection must be used within MessageSelectionProvider')
  }
  return ctx
}

interface MessageSelectionProviderProps {
  children: React.ReactNode
}

export function MessageSelectionProvider({ children }: MessageSelectionProviderProps): React.ReactElement {
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  const isSelectMode = selectedIds.size > 0

  const toggleSelect = React.useCallback((id: string) => {
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

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const isSelected = React.useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const value = React.useMemo<MessageSelectionContextValue>(
    () => ({
      selectedIds,
      isSelectMode,
      toggleSelect,
      clearSelection,
      isSelected,
      selectedCount: selectedIds.size,
    }),
    [selectedIds, isSelectMode, toggleSelect, clearSelection, isSelected],
  )

  return (
    <MessageSelectionContext.Provider value={value}>
      {children}
    </MessageSelectionContext.Provider>
  )
}
