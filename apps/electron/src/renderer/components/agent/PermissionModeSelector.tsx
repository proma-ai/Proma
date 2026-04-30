/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在 AgentHeader 中，紧凑的三模式切换按钮。
 * 支持循环切换和工作区级别的持久化。
 * 每个会话独立维护自己的权限模式。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Zap, Compass, Map as MapIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { agentPermissionModeMapAtom, agentDefaultPermissionModeAtom, currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
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
  const setDefaultMode = useSetAtom(agentDefaultPermissionModeAtom)
  const mode = modeMap.get(sessionId) ?? defaultMode
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 获取当前工作区的 slug
  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    return ws?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 初始化：如果当前 session 不在 Map 中，从默认值写入，确保隔离
  React.useEffect(() => {
    if (!modeMap.has(sessionId)) {
      setModeMap((prev: Map<string, PromaPermissionMode>) => {
        if (prev.has(sessionId)) return prev
        const next = new Map(prev)
        next.set(sessionId, defaultMode)
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 sessionId 变化时初始化
  }, [sessionId])

  // 加载工作区权限模式（仅值变化时更新，避免切换会话时抖动）
  React.useEffect(() => {
    if (!workspaceSlug) return

    window.electronAPI.getPermissionMode(workspaceSlug)
      .then((savedMode) => {
        if (savedMode !== defaultMode) setDefaultMode(savedMode)
      })
      .catch((error) => {
        console.error('[PermissionModeSelector] 加载权限模式失败:', error)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 workspaceSlug 变化时重新加载
  }, [workspaceSlug])

  /** 循环切换模式 */
  const cycleMode = React.useCallback(async () => {
    const currentIndex = PROMA_PERMISSION_MODE_ORDER.indexOf(mode)
    const nextIndex = (currentIndex + 1) % PROMA_PERMISSION_MODE_ORDER.length
    const nextMode = PROMA_PERMISSION_MODE_ORDER[nextIndex]!

    // 更新当前 session 的模式
    setModeMap((prev: Map<string, PromaPermissionMode>) => {
      const next = new Map(prev)
      next.set(sessionId, nextMode)
      return next
    })

    // 持久化到工作区配置
    if (workspaceSlug) {
      try {
        await window.electronAPI.setPermissionMode(workspaceSlug, nextMode)
      } catch (error) {
        console.error('[PermissionModeSelector] 保存权限模式失败:', error)
      }
    }
  }, [mode, sessionId, workspaceSlug, setModeMap])

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
