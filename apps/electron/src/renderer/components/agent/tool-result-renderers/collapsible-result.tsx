/**
 * 可折叠长内容包装器
 *
 * 替代硬截断 2000 字符的方案：
 * - 短内容直接展示
 * - 长内容默认折叠，显示前 N 行 + 长度指示器
 * - 点击展开/收起全部内容
 */

import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapsibleResultProps {
  /** 内容文本 */
  content: string
  /** 折叠阈值（字符数），超过此值时启用折叠，默认 3000 */
  threshold?: number
  /** 折叠时显示的行数，默认 15 */
  previewLines?: number
  /** 自定义渲染函数，接收内容文本返回 JSX */
  renderContent: (text: string) => React.ReactNode
  /** 外层 className */
  className?: string
}

export function CollapsibleResult({
  content,
  threshold = 3000,
  previewLines = 15,
  renderContent,
  className,
}: CollapsibleResultProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const needsCollapse = content.length > threshold

  const displayContent = React.useMemo(() => {
    if (!needsCollapse || expanded) return content
    const lines = content.split('\n')
    if (lines.length <= previewLines) return content
    return lines.slice(0, previewLines).join('\n')
  }, [content, needsCollapse, expanded, previewLines])

  return (
    <div className={cn('relative', className)}>
      {renderContent(displayContent)}

      {needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              显示全部 ({content.length.toLocaleString()} 字符, {content.split('\n').length} 行)
            </>
          )}
        </button>
      )}
    </div>
  )
}
