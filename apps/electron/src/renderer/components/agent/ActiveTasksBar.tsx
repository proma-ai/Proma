/**
 * ActiveTasksBar — 后台任务实时视图
 *
 * 显示在 AgentView 输入框上方，水平排列运行中的后台任务。
 * 点击任务徽章滚动到对应的 ToolActivityItem。
 */

import * as React from 'react'
import { TaskBadge } from './TaskBadge'
import { cn } from '@/lib/utils'
import type { BackgroundTask } from '@/atoms/agent-atoms'

export interface ActiveTasksBarProps {
  /** 当前会话 ID */
  sessionId: string
  /** 后台任务列表 */
  tasks: BackgroundTask[]
  /** 点击任务回调 */
  onTaskClick: (toolUseId: string) => void
  /** 附加样式 */
  className?: string
}

/**
 * ActiveTasksBar 组件
 *
 * 只在有任务时显示，提供运行中任务的概览和快速导航。
 */
export function ActiveTasksBar({
  sessionId,
  tasks,
  onTaskClick,
  className,
}: ActiveTasksBarProps): React.ReactElement | null {
  // 无任务时不渲染
  if (tasks.length === 0) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2',
        'border-t border-border/50',
        'bg-muted/30',
        className
      )}
    >
      <span className="text-xs text-muted-foreground font-medium">运行中任务:</span>
      <div className="flex items-center gap-2 flex-wrap">
        {tasks.map((task) => (
          <TaskBadge
            key={task.toolUseId}
            task={task}
            onClick={() => onTaskClick(task.toolUseId)}
          />
        ))}
      </div>
    </div>
  )
}
