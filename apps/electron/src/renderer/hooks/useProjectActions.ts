/**
 * useProjectActions — 项目切换与创建的共享逻辑
 *
 * UI 层把 AgentWorkspace 展示为“项目”。底层类型和 IPC 仍沿用 workspace
 * 命名，这里只把对展示组件暴露的动作语义收敛到 project。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentWorkspace } from '@proma/shared'

interface UseProjectActionsResult {
  workspaces: AgentWorkspace[]
  currentWorkspaceId: string | null
  /** 切换到指定项目；已是当前项目时无副作用。默认切回对话视图，resetView:false 可保持当前视图（如停留在 Agent 技能） */
  selectProject: (workspaceId: string, opts?: { resetView?: boolean }) => void
  /** 创建并切到新项目；成功返回新项目，失败已 toast 并返回 null */
  createProject: (name: string) => Promise<AgentWorkspace | null>
}

export function useProjectActions(): UseProjectActionsResult {
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const createInFlightRef = React.useRef(false)

  const selectProject = React.useCallback(
    (workspaceId: string, opts?: { resetView?: boolean }): void => {
      if (workspaceId === currentWorkspaceId) return
      setCurrentWorkspaceId(workspaceId)
      if (opts?.resetView !== false) setActiveView('conversations')
      window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
    },
    [currentWorkspaceId, setCurrentWorkspaceId, setActiveView],
  )

  const createProject = React.useCallback(
    async (name: string): Promise<AgentWorkspace | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null
      if (createInFlightRef.current) return null
      createInFlightRef.current = true

      try {
        const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
        setWorkspaces((prev) => [workspace, ...prev])
        setCurrentWorkspaceId(workspace.id)
        setActiveView('conversations')
        window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
        return workspace
      } catch (error) {
        const msg = error instanceof Error ? error.message : '创建失败'
        toast.error(msg)
        return null
      } finally {
        createInFlightRef.current = false
      }
    },
    [setWorkspaces, setCurrentWorkspaceId, setActiveView],
  )

  return { workspaces, currentWorkspaceId, selectProject, createProject }
}
