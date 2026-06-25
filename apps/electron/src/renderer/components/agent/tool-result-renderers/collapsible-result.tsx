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
  const safeContent = content ?? ''
  const [expanded, setExpanded] = React.useState(false)
  const needsCollapse = safeContent.length > threshold

  const displayContent = React.useMemo(() => {
    if (!needsCollapse || expanded) return safeContent
    const lines = safeContent.split('\n')
    if (lines.length <= previewLines) return safeContent
    return lines.slice(0, previewLines).join('\n')
  }, [safeContent, needsCollapse, expanded, previewLines])

  return (
    <div className={cn('relative', className)}>
      {renderContent(displayContent)}

      {needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-[11px] text-foreground/35 transition-colors hover:text-foreground/55"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              展开全部
            </>
          )}
        </button>
      )}
    </div>
  )
}
