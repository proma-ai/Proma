/**
 * MessageSelectionBar — 底部浮动多选操作栏
 *
 * 显示"已选 N 条" + 截图按钮 + 清除按钮。
 * Chat 和 Agent 模式共用。通过 data-message-id 属性定位 DOM。
 */

import { Camera, X } from 'lucide-react'
import { useMessageSelection } from '@/contexts/MessageSelectionContext'
import { captureMultiMessageScreenshot } from '@/lib/message-screenshot'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function MessageSelectionBar(): React.ReactElement | null {
  const { selectedIds, clearSelection, selectedCount } = useMessageSelection()

  if (selectedCount === 0) return null

  const handleScreenshot = () => {
    // 按文档顺序收集（而非点击顺序）：遍历 DOM 中所有带 data-message-id 的元素，
    // 过滤出已选中的，保证拼接截图自上而下与界面一致。
    const els = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).filter((el) => {
      const id = el.dataset.messageId
      return id != null && selectedIds.has(id)
    })
    if (els.length === 0) return
    void captureMultiMessageScreenshot(els)
  }

  return (
    <div className="absolute left-0 right-0 bottom-0 flex items-center justify-center pb-3 z-10 pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-2',
          'bg-white/80 dark:bg-zinc-800/80 backdrop-blur-md shadow-lg border-border/60',
        )}
      >
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          已选 {selectedCount} 条
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-full"
          onClick={handleScreenshot}
        >
          <Camera className="size-3.5" />
          截图
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8 rounded-full"
          onClick={clearSelection}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
