import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PlanningFloatingInspectorProps {
  label: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * 覆盖在任务/日程内容区上的详情 Inspector。
 * 它不参与底层网格布局：列表和日历保持原有宽度，点击空白、Escape 或 × 均可关闭。
 */
export function PlanningFloatingInspector({ label, onClose, children }: PlanningFloatingInspectorProps): React.ReactElement {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <>
      <div aria-hidden className="absolute inset-0 z-30 bg-foreground/[0.02]" onMouseDown={onClose} />
      <aside role="dialog" aria-label={label} className="absolute bottom-3 right-3 top-3 z-40 w-[min(30rem,calc(100%-1.5rem))] overflow-y-auto rounded-none border border-border/60 bg-card shadow-[0_12px_32px_rgb(0_0_0_/_0.12)] scrollbar-thin" onMouseDown={(event) => event.stopPropagation()}>
        <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3 z-10 size-10" onClick={onClose} aria-label={`关闭${label}`} title="关闭 (Esc)"><X size={16} /></Button>
        {children}
      </aside>
    </>
  )
}
