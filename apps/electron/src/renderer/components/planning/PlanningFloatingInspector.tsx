import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PlanningFloatingInspectorProps {
  label: string
  onClose: () => void
  children: React.ReactNode
  /** Todo 工作区使用常驻右栏；日程仍使用覆盖式详情层。 */
  inline?: boolean
}

/**
 * 详情 Inspector。
 * 默认覆盖在任务/日程内容区；inline 模式参与 Todo 三栏网格布局。
 */
export function PlanningFloatingInspector({ label, onClose, children, inline = false }: PlanningFloatingInspectorProps): React.ReactElement {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const panel = <aside role="dialog" aria-label={label} className={inline ? 'relative flex min-h-0 min-w-0 flex-col overflow-y-auto border-l border-foreground/20 bg-card scrollbar-thin' : 'absolute bottom-3 right-3 top-3 z-40 w-[min(30rem,calc(100%-1.5rem))] overflow-y-auto rounded-none border border-foreground/20 bg-card shadow-[0_12px_32px_rgb(0_0_0_/_0.12)] scrollbar-thin'} onMouseDown={(event) => event.stopPropagation()}>
    <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 z-10 size-10" onClick={onClose} aria-label={`关闭${label}`} title="关闭 (Esc)"><X size={16} /></Button>
    {children}
  </aside>

  return inline ? panel : <><div aria-hidden className="absolute inset-0 z-30 bg-foreground/[0.02]" onMouseDown={onClose} />{panel}</>
}
