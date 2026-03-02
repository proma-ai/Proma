/**
 * ChatToolActivityIndicator - 工具活动指示器
 *
 * 展示工具调用的状态（进行中/完成/失败），
 * 已完成的工具活动可点击展开查看结果详情。
 * 同时用于流式临时消息和历史持久化消息。
 */

import * as React from 'react'
import { Loader2, Brain, Globe, Wrench, Sparkles, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { MessageResponse } from '@/components/ai-elements/message'
import type { ChatToolActivity } from '@proma/shared'
import { cn } from '@/lib/utils'

/** 工具名称到中文标签的映射 */
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  recall_memory: { running: '正在回忆…', done: '回忆完成' },
  add_memory: { running: '正在记住…', done: '已记住' },
  web_search: { running: '正在搜索…', done: '搜索完成' },
  suggest_agent_mode: { running: '正在分析任务适配性…', done: '已推荐 Agent 模式' },
}

/** 根据工具名称返回对应图标 */
function getToolIcon(toolName: string): React.ReactElement {
  if (toolName === 'recall_memory' || toolName === 'add_memory') {
    return <Brain className="size-3" />
  }
  if (toolName === 'web_search') {
    return <Globe className="size-3" />
  }
  if (toolName === 'suggest_agent_mode') {
    return <Sparkles className="size-3" />
  }
  return <Wrench className="size-3" />
}

export function ChatToolActivityIndicator({ activities }: { activities: ChatToolActivity[] }): React.ReactElement | null {
  if (activities.length === 0) return null

  // 合并同一个 toolCallId 的 start/result 事件
  const merged = new Map<string, { toolName: string; done: boolean; isError?: boolean; result?: string }>()
  for (const a of activities) {
    const existing = merged.get(a.toolCallId)
    if (a.type === 'start') {
      merged.set(a.toolCallId, { toolName: a.toolName, done: false })
    } else if (a.type === 'result') {
      merged.set(a.toolCallId, {
        toolName: existing?.toolName ?? a.toolName,
        done: true,
        isError: a.isError,
        result: a.result,
      })
    }
  }

  const items = Array.from(merged.entries())
  if (items.length === 0) return null

  return (
    <div className="space-y-1 mb-2">
      {items.map(([callId, item]) => {
        const label = TOOL_LABELS[item.toolName] ?? { running: item.toolName, done: item.toolName }
        const hasResult = item.done && item.result

        // 已完成且有结果的工具活动，可展开查看详情
        if (hasResult) {
          return (
            <ToolActivityCollapsible key={callId} item={item} label={label} />
          )
        }

        return (
          <div
            key={callId}
            className={cn(
              'flex items-center gap-1.5 text-xs text-muted-foreground',
              'animate-in fade-in slide-in-from-left-2 duration-200',
            )}
          >
            {!item.done ? (
              <Loader2 className="size-3 animate-spin text-primary" />
            ) : item.isError ? (
              <XCircle className="size-3 text-destructive" />
            ) : (
              <CheckCircle2 className="size-3 text-green-500" />
            )}
            {getToolIcon(item.toolName)}
            <span>{item.done ? (item.isError ? `${label.done}（失败）` : label.done) : label.running}</span>
          </div>
        )
      })}
    </div>
  )
}

/** 可展开的工具活动项 */
function ToolActivityCollapsible({
  item,
  label,
}: {
  item: { toolName: string; done: boolean; isError?: boolean; result?: string }
  label: { running: string; done: string }
}): React.ReactElement {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-left">
        {item.isError ? (
          <XCircle className="size-3 text-destructive shrink-0" />
        ) : (
          <CheckCircle2 className="size-3 text-green-500 shrink-0" />
        )}
        {getToolIcon(item.toolName)}
        <span>{item.isError ? `${label.done}（失败）` : label.done}</span>
        <ChevronRight className="size-3 ml-auto transition-transform group-data-[state=open]:rotate-90 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground max-h-60 overflow-y-auto">
          <MessageResponse>{item.result ?? ''}</MessageResponse>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
