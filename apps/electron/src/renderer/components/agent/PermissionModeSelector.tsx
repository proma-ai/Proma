/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在 AgentHeader 中，紧凑的双模式切换按钮。
 * 支持循环切换和工作区级别的持久化。
 * 每个会话独立维护自己的权限模式。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Zap, Map as MapIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { agentPermissionModeMapAtom, agentDefaultPermissionModeAtom, sessionPersistedPermissionModeAtom, sessionExistsAtom, agentPlanModeSessionsAtom } from '@/atoms/agent-atoms'
import type { PromaPermissionMode } from '@proma/shared'
import { PROMA_PERMISSION_MODE_CONFIG, PROMA_PERMISSION_MODE_ORDER } from '@proma/shared'
import { getDisplayedPermissionMode, updatePlanModeSessionSet } from '@/lib/agent-plan-mode'
import { inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'

const MODE_ICONS: Record<PromaPermissionMode, React.ComponentType<{ className?: string }>> = {
  bypassPermissions: Zap,
  plan: MapIcon,
}

interface PermissionModeSelectorProps {
  sessionId: string
}

export function PermissionModeSelector({ sessionId }: PermissionModeSelectorProps): React.ReactElement | null {
  const [modeMap, setModeMap] = useAtom(agentPermissionModeMapAtom)
  const setPlanModeSessions = useSetAtom(agentPlanModeSessionsAtom)
  const planModeSessions = useAtomValue(agentPlanModeSessionsAtom)
  const defaultMode = useAtomValue(agentDefaultPermissionModeAtom)
  const persistedSessionMode = useAtomValue(sessionPersistedPermissionModeAtom(sessionId))
  const mode = modeMap.get(sessionId) ?? persistedSessionMode ?? defaultMode
  const planModeActive = planModeSessions.has(sessionId)
  const displayMode = getDisplayedPermissionMode(mode, planModeActive)
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
    const currentIndex = PROMA_PERMISSION_MODE_ORDER.indexOf(displayMode)
    const nextIndex = (currentIndex + 1) % PROMA_PERMISSION_MODE_ORDER.length
    const nextMode = PROMA_PERMISSION_MODE_ORDER[nextIndex]!
    const prevMode = mode
    const prevPlanModeActive = planModeActive

    // 乐观更新当前 session 的模式
    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      const next = new Map(prev)
      next.set(sessionId, nextMode)
      return next
    })
    setPlanModeSessions((prev: Set<string>) =>
      updatePlanModeSessionSet(prev, sessionId, nextMode === 'plan')
    )

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
      setPlanModeSessions((prev: Set<string>) =>
        updatePlanModeSessionSet(prev, sessionId, prevPlanModeActive || prevMode === 'plan')
      )
    }
  }, [displayMode, mode, planModeActive, sessionId, setModeMap, setPlanModeSessions])

  const config = PROMA_PERMISSION_MODE_CONFIG[displayMode]
  const Icon = MODE_ICONS[displayMode]

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={config.label}
            onClick={() => { cycleMode(); requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus()) }}
            className={inputToolbarButtonClass}
          >
            <Icon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="font-medium">{config.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
          <p className="text-xs text-muted-foreground mt-1">点击切换模式</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
