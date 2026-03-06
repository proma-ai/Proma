/**
 * FeishuNotifyToggle — 飞书通知模式切换按钮
 *
 * 三态循环：auto → always → off → auto
 * 仅在飞书 Bridge 已连接时显示。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { feishuConnectedAtom, sessionFeishuNotifyModeAtom, feishuDefaultNotifyModeAtom } from '@/atoms/feishu-atoms'
import { cn } from '@/lib/utils'
import type { FeishuNotifyMode } from '@proma/shared'

/** 模式循环顺序 */
const MODE_CYCLE: FeishuNotifyMode[] = ['auto', 'always', 'off']

/** 模式配置 */
const MODE_CONFIG: Record<FeishuNotifyMode, { color: string; tooltip: string }> = {
  auto: { color: 'text-foreground/60 hover:text-foreground', tooltip: '飞书通知: 智能 (离开时发送)' },
  always: { color: 'text-blue-500', tooltip: '飞书通知: 始终发送' },
  off: { color: 'text-foreground/30', tooltip: '飞书通知: 已关闭' },
}

interface FeishuNotifyToggleProps {
  sessionId: string
}

export function FeishuNotifyToggle({ sessionId }: FeishuNotifyToggleProps): React.ReactElement | null {
  const isConnected = useAtomValue(feishuConnectedAtom)
  const defaultMode = useAtomValue(feishuDefaultNotifyModeAtom)
  const notifyModes = useAtomValue(sessionFeishuNotifyModeAtom)
  const setNotifyModes = useSetAtom(sessionFeishuNotifyModeAtom)

  const currentMode = notifyModes.get(sessionId) ?? defaultMode

  const handleClick = React.useCallback(() => {
    const currentIndex = MODE_CYCLE.indexOf(currentMode)
    const nextMode = MODE_CYCLE[(currentIndex + 1) % MODE_CYCLE.length]!

    // 更新 atom
    setNotifyModes((prev) => {
      const map = new Map(prev)
      map.set(sessionId, nextMode)
      return map
    })

    // 同步到主进程
    window.electronAPI.setFeishuSessionNotify(sessionId, nextMode).catch(console.error)
  }, [sessionId, currentMode, setNotifyModes])

  // 仅在飞书 Bridge 已连接时显示
  if (!isConnected) return null

  const config = MODE_CONFIG[currentMode]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-[30px] rounded-full',
            config.color,
            currentMode === 'off' && 'line-through',
          )}
          onClick={handleClick}
        >
          <MessageSquare className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{config.tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}
