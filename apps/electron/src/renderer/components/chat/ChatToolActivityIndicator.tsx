/**
 * ChatToolActivityIndicator - Chat 模式工具活动指示器
 *
 * 将 ChatToolActivity[] 的 start/result 事件合并后，
 * 使用 ChatToolBlock 渲染（ContentBlock 风格）。
 * 保持外部接口不变。
 */

import * as React from 'react'
import { ChatToolBlock } from './ChatToolBlock'
import type { ChatToolActivity } from '@proma/shared'

interface MergedActivity {
  toolName: string
  done: boolean
  isError?: boolean
  result?: string
  input: Record<string, unknown>
}

export function ChatToolActivityIndicator({
  activities,
  isStreaming = false,
}: {
  activities: ChatToolActivity[]
  isStreaming?: boolean
}): React.ReactElement | null {
  const merged = React.useMemo(() => {
    const map = new Map<string, MergedActivity>()
    for (const a of activities) {
      const existing = map.get(a.toolCallId)
      if (a.type === 'start') {
        map.set(a.toolCallId, {
          toolName: a.toolName,
          done: false,
          input: a.input ?? existing?.input ?? {},
        })
      } else if (a.type === 'result') {
        map.set(a.toolCallId, {
          toolName: existing?.toolName ?? a.toolName,
          done: true,
          isError: a.isError,
          result: a.result,
          input: a.input ?? existing?.input ?? {},
        })
      }
    }
    return Array.from(map.entries())
  }, [activities])

  if (merged.length === 0) return null

  return (
    <div className="space-y-0.5 mb-2">
      {merged.map(([callId, item], idx) => (
        <ChatToolBlock
          key={callId}
          toolName={item.toolName}
          input={item.input}
          result={item.result}
          isError={item.isError}
          isCompleted={item.done}
          animate={isStreaming}
          index={idx}
        />
      ))}
    </div>
  )
}
