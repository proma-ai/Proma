import type { ReactElement } from 'react'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AgentActionHintProps {
  action: string
  className?: string
}

/** 右侧工作区组件的轻量 Agent 操作引导。 */
export function AgentActionHint({ action, className }: AgentActionHintProps): ReactElement {
  return (
    <div className={cn('flex min-h-8 items-center gap-1.5 rounded-lg bg-muted/45 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground', className)}>
      <Bot className="size-3.5 shrink-0 text-foreground/50" aria-hidden="true" />
      <p className="min-w-0 text-pretty">
        可在左侧 Agent 中直接说：<span className="text-foreground/70">{action}</span>
      </p>
    </div>
  )
}
