/**
 * QuotedSelectionChip — 引用选中文本的 Chip 标签
 *
 * 显示在 Agent 输入框上方，展示预览面板中选中的文本片段及来源文件。
 * 点击 X 按钮可移除引用。
 */

import * as React from 'react'
import { X, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuotedSelectionChipProps {
  /** 选中的文本（截断显示） */
  text: string
  /** 来源文件路径（截断显示） */
  filePath: string
  /** 来源展示名称 */
  sourceLabel?: string
  /** 移除回调 */
  onRemove: () => void
  className?: string
}

function truncateText(text: string, maxLen: number = 80): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxLen
    ? singleLine.slice(0, maxLen - 3) + '...'
    : singleLine
}

function truncatePath(filePath: string, maxLen: number = 40): string {
  if (filePath.length <= maxLen) return filePath
  const name = filePath.split('/').pop() ?? filePath
  return '.../' + name
}

export function QuotedSelectionChip({
  text,
  filePath,
  sourceLabel,
  onRemove,
  className,
}: QuotedSelectionChipProps): React.ReactElement {
  const handleRemoveClick = React.useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    onRemove()
  }, [onRemove])

  return (
    <div
      className={cn(
        'group/chip relative flex min-w-0 max-w-full items-start gap-2',
        'rounded-lg bg-primary/8 border border-primary/20',
        'pl-2.5 pr-7 py-1.5 text-[13px]',
        'transition-colors hover:bg-primary/12',
        className,
      )}
    >
      <Quote className="size-4 shrink-0 mt-0.5 text-primary/60" />
      <div className="flex flex-col min-w-0">
        <span className="text-foreground/80 line-clamp-2 leading-snug break-words [overflow-wrap:anywhere]">
          {truncateText(text)}
        </span>
        <span className="text-[11px] text-muted-foreground/60 mt-0.5 break-words [overflow-wrap:anywhere]">
          {sourceLabel ?? truncatePath(filePath)}
        </span>
      </div>
      <button
        type="button"
        onClick={handleRemoveClick}
        className={cn(
          'absolute top-1 right-1 size-[18px] rounded-full',
          'bg-foreground/10 text-foreground/50',
          'flex items-center justify-center',
          'opacity-0 group-hover/chip:opacity-100 transition-opacity duration-200',
          'hover:bg-foreground/20 hover:text-foreground',
        )}
        aria-label="移除引用"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
