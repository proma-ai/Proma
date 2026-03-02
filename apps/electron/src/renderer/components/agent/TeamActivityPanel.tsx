/**
 * TeamActivityPanel — Team/Task 子代理活动面板（Placeholder）
 *
 * TODO: 完成 Agent Teams UI 展示
 * - 按 team_name 分组展示子代理活动
 * - 实时状态、计时器、子工具活动展开
 */

import { Bot } from 'lucide-react'

interface TeamActivityPanelProps {
  sessionId: string
}

export function TeamActivityPanel({ sessionId: _sessionId }: TeamActivityPanelProps): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2.5 text-muted-foreground/60">
        <Bot className="size-8" />
        <p className="text-xs">Team 活动面板</p>
        <p className="text-[11px]">UI 待完成</p>
      </div>
    </div>
  )
}
