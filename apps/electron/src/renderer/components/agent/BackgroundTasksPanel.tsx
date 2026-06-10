/**
 * BackgroundTasksPanel — 后台任务面板
 *
 * 显示在助手消息的工具执行区域下方，展示运行中的后台任务。
 * 参考 Craft-agent-oss 的表格样式设计。
 */

import * as React from 'react'
import { Loader2, Terminal, GitBranch, Workflow as WorkflowIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BackgroundTask } from '@/atoms/agent-atoms'

export interface BackgroundTasksPanelProps {
  tasks: BackgroundTask[]
  className?: string
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds).toFixed(seconds < 10 ? 1 : 0)}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function buildTaskMeta(task: BackgroundTask): string {
  const parts: string[] = []
  if (task.lastToolName) parts.push(task.lastToolName)
  if (task.usage?.totalTokens != null) parts.push(`${formatNumber(task.usage.totalTokens)} tokens`)
  if (task.usage?.toolUses != null) parts.push(`${formatNumber(task.usage.toolUses)} tools`)
  const elapsedSeconds = task.usage ? task.usage.durationMs / 1000 : task.elapsedSeconds
  if (elapsedSeconds > 0) parts.push(formatElapsed(elapsedSeconds))
  return parts.join(' · ')
}

/**
 * BackgroundTasksPanel 组件
 *
 * 以表格形式展示运行中的后台任务。
 */
export function BackgroundTasksPanel({
  tasks,
  className,
}: BackgroundTasksPanelProps): React.ReactElement | null {
  // 无任务时不渲染
  if (tasks.length === 0) return null

  return (
    <div className={cn('mt-2', className)}>
      {/* 标题 */}
      <div className="text-xs text-foreground/60 mb-1.5 px-0.5">
        {tasks.length} 个后台任务：
      </div>

      {/* 任务表格 */}
      <div className="rounded-md border border-border/50 overflow-hidden bg-muted/20">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th className="text-left py-1.5 px-2 font-medium text-foreground/50 w-8 text-[11px]">#</th>
              <th className="text-left py-1.5 px-2 font-medium text-foreground/50 text-[11px]">任务描述</th>
              <th className="text-left py-1.5 px-2 font-medium text-foreground/50 w-20 text-[11px]">状态</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => {
              const Icon = task.type === 'shell' ? Terminal : task.type === 'workflow' ? WorkflowIcon : GitBranch
              const taskLabel = task.type === 'shell' ? 'Shell' : task.type === 'workflow' ? 'Workflow' : 'Task'
              const description = task.description || task.intent || `${taskLabel} 任务`
              const meta = buildTaskMeta(task)

              return (
                <tr
                  key={task.toolUseId}
                  className="border-b border-border/30 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  {/* 序号 */}
                  <td className="py-1.5 px-2 text-foreground/40 font-mono text-[10px]">
                    {index + 1}
                  </td>

                  {/* 任务描述 */}
                  <td className="py-1.5 px-2">
                    <div className="flex items-start gap-1.5">
                      <Icon className="size-3 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-foreground/70 text-[11px]">{description}</div>
                        {meta && <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{meta}</div>}
                      </div>
                    </div>
                  </td>

                  {/* 状态 */}
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1">
                      <Loader2 className="size-2.5 animate-spin text-primary" />
                      <span className="text-primary font-medium text-[11px]">运行中</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
