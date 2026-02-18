/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在 AgentHeader 中，紧凑的三模式切换按钮。
 * 支持循环切换和工作区级别的持久化。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Zap, Compass, Eye } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { agentPermissionModeAtom, currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import type { PromaPermissionMode } from '@proma/shared'
import { PROMA_PERMISSION_MODE_ORDER } from '@proma/shared'

/** 模式配置 */
const MODE_CONFIG: Record<PromaPermissionMode, {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  className: string
}> = {
  auto: {
    icon: Zap,
    label: '自动',
    description: '所有工具调用自动允许',
    className: 'text-green-500 hover:text-green-400',
  },
  smart: {
    icon: Compass,
    label: '探索',
    description: '只读自动允许，写入/危险操作需确认',
    className: 'text-blue-500 hover:text-blue-400',
  },
  supervised: {
    icon: Eye,
    label: '监督',
    description: '所有操作都需要确认',
    className: 'text-amber-500 hover:text-amber-400',
  },
}

export function PermissionModeSelector(): React.ReactElement | null {
  const [mode, setMode] = useAtom(agentPermissionModeAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 获取当前工作区的 slug
  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    return ws?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 加载工作区权限模式
  React.useEffect(() => {
    if (!workspaceSlug) return

    window.electronAPI.getPermissionMode(workspaceSlug)
      .then((savedMode) => {
        setMode(savedMode)
      })
      .catch((error) => {
        console.error('[PermissionModeSelector] 加载权限模式失败:', error)
      })
  }, [workspaceSlug, setMode])

  /** 循环切换模式 */
  const cycleMode = React.useCallback(async () => {
    const currentIndex = PROMA_PERMISSION_MODE_ORDER.indexOf(mode)
    const nextIndex = (currentIndex + 1) % PROMA_PERMISSION_MODE_ORDER.length
    const nextMode = PROMA_PERMISSION_MODE_ORDER[nextIndex]!

    setMode(nextMode)

    // 持久化到工作区配置
    if (workspaceSlug) {
      try {
        await window.electronAPI.setPermissionMode(workspaceSlug, nextMode)
      } catch (error) {
        console.error('[PermissionModeSelector] 保存权限模式失败:', error)
      }
    }
  }, [mode, workspaceSlug, setMode])

  const config = MODE_CONFIG[mode]
  const Icon = config.icon

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => { cycleMode(); requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus()) }}
            className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs font-medium transition-colors ${config.className}`}
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
