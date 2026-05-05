/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在 AgentHeader 中，紧凑的三模式切换按钮。
 * 支持循环切换和工作区级别的持久化。
 * 每个会话独立维护自己的权限模式。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Zap, Compass, Map as MapIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { agentPermissionModeMapAtom, agentDefaultPermissionModeAtom, sessionPersistedPermissionModeAtom, sessionExistsAtom } from '@/atoms/agent-atoms'
import type { PromaPermissionMode } from '@proma/shared'
import { PROMA_PERMISSION_MODE_ORDER } from '@proma/shared'

/** 模式配置 */
const MODE_CONFIG: Record<PromaPermissionMode, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
}> = {
  auto: {
    icon: Compass,
    label: '自动模式',
    description: 'SDK 内置审批器自动判断，危险操作才需确认',
  },
  bypassPermissions: {
    icon: Zap,
    label: '完全自动',
    description: '所有工具调用自动允许',
  },
  plan: {
    icon: MapIcon,
    label: '计划模式',
    description: '仅规划不执行，查看工具使用计划',
  },
}

interface PermissionModeSelectorProps {
  sessionId: string
}

export function PermissionModeSelector({ sessionId }: PermissionModeSelectorProps): React.ReactElement | null {
  const [modeMap, setModeMap] = useAtom(agentPermissionModeMapAtom)
  const defaultMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedSessionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const mode = modeMap.get(sessionId) ?? persistedSessionMode ?? defaultMode
  const sessionExistsInList = useAtomValue(sessionExistsAtom(sessionId))

  // 初始化：如果当前 session 不在 Map 中，按以下优先级读回：
  // 1. session meta.permissionMode（每个 tab 独立持久化，重启恢复各自的值）
  // 2. 默认完全自动模式
  // 注意：只写入当前 session，不回写到 agentDefaultPermissionModeAtom，避免跨会话污染。
  React.useEffect(() => {
    if (!sessionExistsInList) return

    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      if (prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.set(sessionId, persistedSessionMode ?? defaultMode)
      return next
    })
  }, [sessionId, persistedSessionMode, sessionExistsInList, defaultMode, setModeMap])

  /** 循环切换模式 */
  const cycleMode = React.useCallback(async () => {
    const currentIndex = PROMA_PERMISSION_MODE_ORDER.indexOf(mode)
    const nextIndex = (currentIndex + 1) % PROMA_PERMISSION_MODE_ORDER.length
    const nextMode = PROMA_PERMISSION_MODE_ORDER[nextIndex]!
    const prevMode = mode

    // 乐观更新当前 session 的模式
    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      const next = new Map(prev)
      next.set(sessionId, nextMode)
      return next
    })

    // 热切换运行中的当前 session；失败时回滚 modeMap 保持 UI/后端一致
    try {
      await window.electronAPI.updateSessionPermissionMode(sessionId, nextMode)
    } catch (error) {
      console.error('[PermissionModeSelector] 运行中切换权限模式失败，回滚 UI:', error)
      setModeMap((prev: Map<string, PromaPermissionMode>) => {
        const next = new Map(prev)
        next.set(sessionId, prevMode)
        return next
      })
    }
  }, [mode, sessionId, setModeMap])

  const config = MODE_CONFIG[mode]
  const Icon = config.icon

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => { cycleMode(); requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus()) }}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-xs font-medium transition-colors text-muted-foreground hover:text-foreground"
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{config.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="font-medium">{config.label}模式</p>
          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          <p className="text-xs text-muted-foreground mt-1">点击切换模式</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
