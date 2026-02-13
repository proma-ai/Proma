/**
 * ModeSwitcher - Chat/Agent 模式切换（带滑动指示器）
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { cn } from '@/lib/utils'

const modes: { value: AppMode; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'agent', label: 'Agent' },
]

export function ModeSwitcher(): React.ReactElement {
  const [mode, setMode] = useAtom(appModeAtom)

  return (
    <div className="px-2 pt-2">
      <div className="relative flex rounded-lg bg-muted p-1">
        {/* 滑动背景指示器 */}
        <div
          className={cn(
            'absolute top-1 bottom-1 w-[calc(50%-4px)] rounded bg-background shadow-sm transition-transform duration-300 ease-in-out',
            mode === 'chat' ? 'translate-x-0' : 'translate-x-full'
          )}
        />
        {modes.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={cn(
              'relative z-[1] flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200',
              mode === value
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
