/**
 * BackgroundTasksPanel — 后台任务面板
 *
 * 显示在助手消息的工具执行区域下方，展示运行中/已完成的后台任务。
 * workflow 任务完成后显示"保存为 Flow"按钮，运行中展示子 Agent 进度树。
 */

import * as React from 'react'
import { Loader2, Terminal, GitBranch, CheckCircle2, XCircle, StopCircle, Save, Workflow, Wrench, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import type { BackgroundTask, FlowProgressItem } from '@/atoms/agent-atoms'

export interface BackgroundTasksPanelProps {
  tasks: BackgroundTask[]
  /** 当前工作区 slug，用于"保存为 Flow" */
  workspaceSlug?: string
  /** 重试 Flow 的回调（传入 flow slug） */
  onRetryFlow?: (flowSlug: string) => void
  className?: string
}

/** 渲染子节点进度树 */
function ProgressTreeNode({ item }: { item: FlowProgressItem }): React.ReactElement {
  const StatusIcon = item.status === 'completed' ? CheckCircle2
    : item.status === 'failed' ? XCircle
    : item.status === 'stopped' ? StopCircle
    : Loader2

  return (
    <div className="ml-4 border-l border-border/40 pl-2">
      <div className="flex items-center gap-1.5 py-0.5">
        <StatusIcon className={cn(
          'size-2.5 shrink-0',
          item.status === 'completed' ? 'text-green-500' :
          item.status === 'failed' ? 'text-destructive' :
          item.status === 'running' ? 'animate-spin text-primary' :
          'text-muted-foreground',
        )} />
        <span className="text-[11px] text-foreground/70 truncate">{item.name}</span>
        {item.lastToolName && item.status === 'running' && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
            <Wrench size={8} />
            {item.lastToolName}
          </span>
        )}
      </div>
      {item.summary && (
        <div className="ml-4 text-[10px] text-muted-foreground/60 truncate">{item.summary}</div>
      )}
      {item.children?.map((child) => (
        <ProgressTreeNode key={child.id} item={child} />
      ))}
    </div>
  )
}

/**
 * BackgroundTasksPanel 组件
 *
 * 以表格形式展示后台任务。workflow 完成后显示"保存为 Flow"按钮。
 */
export function BackgroundTasksPanel({
  tasks,
  workspaceSlug,
  onRetryFlow,
  className,
}: BackgroundTasksPanelProps): React.ReactElement | null {
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  // 无任务时不渲染
  if (tasks.length === 0) return null

  const handleSaveAsFlow = async (task: BackgroundTask): Promise<void> => {
    if (!workspaceSlug || !task.outputFile) return
    try {
      const slug = await window.electronAPI.saveWorkflowAsFlow(workspaceSlug, task.outputFile, task.flowSlug)
      toast.success(`已保存为 Flow: ${slug}`)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (err: unknown) {
      toast.error(`保存 Flow 失败: ${(err as Error).message}`)
    }
  }

  return (
    <div className={cn('mt-2', className)}>
      {/* 标题 */}
      <div className="text-xs text-foreground/60 mb-1.5 px-0.5">
        {tasks.length} 个后台任务：
      </div>

      {/* 任务卡片式展示 */}
      <div className="space-y-2">
        {tasks.map((task) => {
          const Icon = task.type === 'shell' ? Terminal : task.type === 'workflow' ? Workflow : GitBranch
          const description = task.intent || `${task.type === 'shell' ? 'Shell' : task.type === 'workflow' ? 'Workflow' : 'Task'} 任务`
          const isRunning = !task.status || task.status === 'running'
          const isCompleted = task.status === 'completed'
          const canSaveAsFlow = task.type === 'workflow' && isCompleted && task.outputFile
          const hasChildren = task.children && task.children.length > 0

          return (
            <div
              key={task.toolUseId}
              className={cn(
                'rounded-lg border border-border/50 overflow-hidden',
                isRunning ? 'bg-muted/30' : 'bg-muted/15',
              )}
            >
              {/* 主行 */}
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className={cn(
                    'size-3.5 shrink-0',
                    task.type === 'workflow' ? 'text-amber-500' : 'text-muted-foreground',
                  )} />
                  <span className="text-sm text-foreground/80 truncate">{description}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* 状态 */}
                  {isRunning ? (
                    <div className="flex items-center gap-1">
                      <Loader2 className="size-2.5 animate-spin text-primary" />
                      <span className="text-primary font-medium text-[11px]">运行中</span>
                    </div>
                  ) : isCompleted ? (
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="size-2.5 text-green-500" />
                      <span className="text-green-600 font-medium text-[11px]">完成</span>
                    </div>
                  ) : task.status === 'failed' ? (
                    <div className="flex items-center gap-1">
                      <XCircle className="size-2.5 text-destructive" />
                      <span className="text-destructive font-medium text-[11px]">失败</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <StopCircle className="size-2.5 text-muted-foreground" />
                      <span className="text-muted-foreground font-medium text-[11px]">已停止</span>
                    </div>
                  )}

                  {/* 保存为 Flow 按钮 */}
                  {canSaveAsFlow && workspaceSlug && (
                    <button
                      type="button"
                      onClick={() => { void handleSaveAsFlow(task) }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                    >
                      <Save className="size-2.5" />
                      保存为 Flow
                    </button>
                  )}

                  {/* 重试按钮（失败的 workflow） */}
                  {task.type === 'workflow' && task.status === 'failed' && task.flowSlug && onRetryFlow && (
                    <button
                      type="button"
                      onClick={() => { onRetryFlow(task.flowSlug!) }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                    >
                      <RotateCcw className="size-2.5" />
                      重试
                    </button>
                  )}
                </div>
              </div>

              {/* 进度树（运行中或完成时有子节点时展示） */}
              {hasChildren && (
                <div className="px-3 pb-2 pt-0.5 border-t border-border/30">
                  {task.children!.map((child) => (
                    <ProgressTreeNode key={child.id} item={child} />
                  ))}
                </div>
              )}

              {/* 完成摘要 */}
              {task.summary && !isRunning && !hasChildren && (
                <div className="px-3 pb-2 text-[11px] text-muted-foreground truncate border-t border-border/30 pt-1.5">
                  {task.summary}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
