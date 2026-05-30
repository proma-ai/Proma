/**
 * PreviewOpenButton — 在预览面板中打开文件的扩展按钮
 *
 * 显示在工具结果预览区域（Read/Edit/Write）的 chevron 旁边，
 * 使用 span 避免嵌套 button 的 HTML 问题，
 * 点击后将文件内容在当前会话的临时预览标签页中打开。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { previewFileMapAtom, previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeTabIdAtom, getPreviewTabTitle, openTab, tabsAtom } from '@/atoms/tab-atoms'
import { cn } from '@/lib/utils'

interface PreviewOpenButtonProps {
  filePath: string
  className?: string
}

export function PreviewOpenButton({ filePath, className }: PreviewOpenButtonProps): React.ReactElement | null {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const store = useStore()
  const setPreviewFile = useSetAtom(previewFileMapAtom)
  const setPreviewOpen = useSetAtom(previewPanelOpenMapAtom)

  if (!sessionId || !filePath) return null

  const handleOpen = () => {
    setPreviewFile((prev) => {
      const next = new Map(prev)
      next.set(sessionId, { filePath, previewOnly: true, readOnly: true })
      return next
    })
    setPreviewOpen((prev) => {
      const next = new Map(prev)
      next.set(sessionId, false)
      return next
    })
    const result = openTab(store.get(tabsAtom), {
      type: 'preview',
      sessionId,
      title: getPreviewTabTitle(filePath),
    })
    store.set(tabsAtom, result.tabs)
    store.set(activeTabIdAtom, result.activeTabId)
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={cn(
        'inline-flex shrink-0 items-center px-1.5 py-px rounded text-[11px] text-muted-foreground/60',
        'hover:text-foreground/70 hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'transition-colors duration-150 cursor-pointer',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        handleOpen()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          handleOpen()
        }
      }}
      title="在预览标签页中打开"
    >
      预览
    </span>
  )
}
