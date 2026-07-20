import * as React from 'react'
import { ArrowDownIcon, ListTodo, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { TaskProgressCard } from './TaskProgressCard'
import { aggregateTaskItems, isTerminalTaskStatus, type TaskItem } from './task-progress'

const FINISH_RETENTION_MS = 4_000
const FADE_OUT_DURATION_MS = 200

function taskSignature(items: TaskItem[]): string {
  return items
    .map((item) => `${item.id}:${item.status}:${item.subject}:${item.activeForm ?? ''}`)
    .join('|')
}

function getCurrentTask(items: TaskItem[]): TaskItem | undefined {
  return [...items].reverse().find((item) => item.status === 'in_progress')
    ?? [...items].reverse().find((item) => !isTerminalTaskStatus(item.status))
}

interface TaskProgressOverlayProps {
  /** 仅当前 live turn 的任务工具活动，不传历史 turn。 */
  activities: ToolActivity[]
  streaming: boolean
}

/**
 * 取代单独的“回到最下方”按钮：任务进行时展示单行进度，点击展开完整任务卡；
 * 无任务时自动退化为原箭头按钮。
 */
export function TaskProgressOverlay({ activities, streaming }: TaskProgressOverlayProps): React.ReactElement | null {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  const liveItems = React.useMemo(
    () => aggregateTaskItems(activities, false),
    [activities],
  )
  const liveSignature = taskSignature(liveItems)
  const hasLiveTasks = liveItems.length > 0
  const hasLiveActiveTask = liveItems.some((item) => !isTerminalTaskStatus(item.status))
  const [retainedActivities, setRetainedActivities] = React.useState<ToolActivity[]>([])
  const [retainedSignature, setRetainedSignature] = React.useState('')
  const [visible, setVisible] = React.useState(false)
  const [fading, setFading] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  // liveMessages 在收尾时会被清空；保留最后一份任务快照，才能完成 4 秒反馈。
  React.useEffect(() => {
    if (!hasLiveTasks || liveSignature === retainedSignature) return
    setRetainedActivities(activities)
    setRetainedSignature(liveSignature)
    setFading(false)
    setVisible(true)
  }, [activities, hasLiveTasks, liveSignature, retainedSignature])

  const displayActivities = hasLiveTasks ? activities : retainedActivities
  const displayItems = hasLiveTasks
    ? liveItems
    : aggregateTaskItems(retainedActivities, false)
  const displaySignature = hasLiveTasks ? liveSignature : retainedSignature
  const hasDisplayTasks = displayItems.length > 0
  const shouldRetainFinishedTasks = hasDisplayTasks && (!streaming || !hasLiveActiveTask)
  const hideKey = shouldRetainFinishedTasks ? `${displaySignature}:${streaming}` : null

  React.useEffect(() => {
    if (!hideKey) {
      if (hasDisplayTasks) {
        setFading(false)
        setVisible(true)
      }
      return
    }

    const fadeTimer = window.setTimeout(() => {
      setFading(true)
    }, FINISH_RETENTION_MS - FADE_OUT_DURATION_MS)
    const hideTimer = window.setTimeout(() => {
      setVisible(false)
      setOpen(false)
      setRetainedActivities([])
      setRetainedSignature('')
    }, FINISH_RETENTION_MS)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(hideTimer)
    }
  }, [hasDisplayTasks, hideKey])

  const completedCount = displayItems.filter((item) => isTerminalTaskStatus(item.status)).length
  const currentTask = getCurrentTask(displayItems)
  const showTaskProgress = visible && hasDisplayTasks

  if (!showTaskProgress && isAtBottom) return null

  if (!showTaskProgress) {
    return (
      <Button
        className="absolute bottom-[26px] left-1/2 size-10 -translate-x-1/2 rounded-md border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-[background-color,transform] duration-200 hover:bg-accent/80 active:scale-[0.96]"
        onClick={() => scrollToBottom()}
        type="button"
        variant="ghost"
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  }

  return (
    <div className={cn(
      'pointer-events-none absolute bottom-[22px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 transition-opacity duration-200',
      fading && 'opacity-0',
    )}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'pointer-events-auto flex min-h-10 max-w-[min(460px,calc(100vw-9rem))] items-center gap-2 rounded-md border border-border/60 bg-background/85 py-2 pr-3 pl-2.5 text-left shadow-sm backdrop-blur-sm',
              'transition-[background-color,transform] duration-200 hover:bg-accent/80 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {currentTask?.status === 'in_progress'
              ? <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
              : <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {completedCount}/{displayItems.length}
            </span>
            <span className="truncate text-[13px] text-foreground/90">
              {currentTask?.activeForm ?? currentTask?.subject ?? '任务已完成'}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(420px,calc(100vw-2rem))] rounded-md border-border/60 bg-background/95 p-2 backdrop-blur-sm" side="top" align="center">
          <TaskProgressCard activities={displayActivities} alwaysExpanded />
        </PopoverContent>
      </Popover>

      {!isAtBottom && (
        <Button
          aria-label="回到最下方"
          className="pointer-events-auto size-10 rounded-md border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-[background-color,transform] duration-200 hover:bg-accent/80 active:scale-[0.96]"
          onClick={() => scrollToBottom()}
          type="button"
          variant="ghost"
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
