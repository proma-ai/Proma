/**
 * WelcomeEmptyState — 对话/会话空状态引导
 *
 * 在没有会话时展示：
 * 1. 个性化时段问候
 * 2. 平台感知的小 Tips
 * 3. Chat/Agent 模式切换 Tab
 */

import * as React from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { Lightbulb, MessageSquare, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { userProfileAtom } from '@/atoms/user-profile'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { themeStyleAtom } from '@/atoms/theme'
import { getRandomTip, getPlatform, type Tip } from '@/lib/tips'
import { useCreateSession } from '@/hooks/useCreateSession'

/** 根据小时返回时段问候 */
function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** 模式配置 */
const MODE_CONFIG: Record<AppMode, { icon: React.ReactNode; label: string }> = {
  chat: { icon: <MessageSquare size={15} />, label: 'Chat' },
  agent: { icon: <Bot size={15} />, label: 'Agent' },
}

export function WelcomeEmptyState(): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const [mode, setMode] = useAtom(appModeAtom)
  const themeStyle = useAtomValue(themeStyleAtom)
  const { createChat, createAgent } = useCreateSession()

  // 稳定的随机 Tip（组件挂载时选一条）
  const [tip] = React.useState<Tip>(() => getRandomTip(getPlatform()))

  const hour = new Date().getHours()
  const greeting = getGreeting(hour)
  const displayName = userProfile.userName || '用户'

  // 森息晨光主题下选中按钮使用主色
  const selectedColor = themeStyle === 'forest-light' ? '#3f8361' : undefined

  /** 切换模式：切换模式并创建对应的 draft 会话 */
  const handleModeSwitch = React.useCallback(async (targetMode: AppMode): Promise<void> => {
    if (targetMode === mode) return
    setMode(targetMode)
    if (targetMode === 'chat') {
      await createChat({ draft: true })
    } else {
      await createAgent({ draft: true })
    }
  }, [mode, setMode, createChat, createAgent])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 animate-in fade-in duration-500">
      {/* 问候语 */}
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
        {displayName}，{greeting}
      </h1>

      {/* Tips */}
      <div className="flex items-center gap-2.5 rounded-full bg-muted/50 px-4 py-2 text-[13px] text-muted-foreground">
        <Lightbulb size={14} className="flex-shrink-0 text-amber-500/80" />
        <span>{tip.text}</span>
      </div>

      {/* 模式切换 Tab */}
      <div className="relative flex rounded-xl bg-muted/60 p-1">
        {/* 滑动背景指示器 */}
        <div
          className={cn(
            'absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out',
            mode === 'chat' ? 'translate-x-0' : 'translate-x-full',
          )}
        />
        {(['chat', 'agent'] as const).map((m) => {
          const config = MODE_CONFIG[m]
          const isSelected = mode === m
          return (
            <button
              key={m}
              onClick={() => handleModeSwitch(m)}
              style={isSelected && selectedColor ? { color: selectedColor } : undefined}
              className={cn(
                'relative z-[1] flex items-center gap-1.5 rounded-lg px-5 py-1.5 text-[13px] font-medium transition-colors duration-200',
                isSelected
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {config.icon}
              {config.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
