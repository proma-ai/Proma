/**
 * PreviewOpenButton — 在预览面板中打开文件的扩展按钮
 *
 * 显示在工具结果预览区域（Read/Edit/Write）的 chevron 旁边，
 * 使用 span 避免嵌套 button 的 HTML 问题，
 * 点击后将文件内容在右侧 PreviewPanel 中以完整视图打开。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { previewFileMapAtom, previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'

interface PreviewOpenButtonProps {
  filePath: string
  /** 是否已在展开状态（展开时始终可见，否则仅 hover 可见） */
  expanded?: boolean
  className?: string
}

export function PreviewOpenButton({ filePath, expanded = false, className }: PreviewOpenButtonProps): React.ReactElement | null {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
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
      next.set(sessionId, true)
      return next
    })
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={cn(
        'shrink-0 px-1.5 py-px rounded text-[11px] text-muted-foreground/50',
        'hover:text-foreground/70 hover:bg-muted/50',
        'transition-all duration-150 cursor-pointer',
        'opacity-0 group-hover:opacity-100',
        expanded && 'opacity-100',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        handleOpen()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpen()
        }
      }}
      title="在预览面板中打开"
    >
      预览
    </span>
  )
}
