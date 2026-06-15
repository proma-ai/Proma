/**
 * PreviewOpenButton — 在预览面板中打开文件的扩展按钮
 *
 * 显示在工具结果预览区域（Read/Edit/Write）的 chevron 旁边，
 * 使用 span 避免嵌套 button 的 HTML 问题，
 * 点击后按用户偏好（标签页 / 右侧分屏）打开文件预览。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { cn } from '@/lib/utils'

interface PreviewOpenButtonProps {
  filePath: string
  className?: string
}

export function PreviewOpenButton({ filePath, className }: PreviewOpenButtonProps): React.ReactElement | null {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const openPreview = useOpenPreview()

  if (!sessionId || !filePath) return null

  const handleOpen = () => {
    openPreview(sessionId, { filePath, previewOnly: true, readOnly: true })
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
      title="预览文件"
    >
      预览
    </span>
  )
}
