/**
 * useFlowsManager — Flows tab 状态与操作 hook
 *
 * 从 AgentSettings 中提取，管理 Flow 列表加载、CRUD、导入等操作。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { useSetAtom } from 'jotai'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import type { FlowMeta, OtherWorkspaceFlowsGroup } from '@proma/shared'

export interface UseFlowsManagerReturn {
  flows: FlowMeta[]
  flowsDir: string
  flowsLoading: boolean
  otherWorkspaceFlows: OtherWorkspaceFlowsGroup[]
  showImportFlowDialog: boolean
  selectedFlowSlug: string | null
  selectedFlow: FlowMeta | null
  setShowImportFlowDialog: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedFlowSlug: React.Dispatch<React.SetStateAction<string | null>>
  reloadFlows: () => void
  handleFlowToggle: (flowSlug: string, enabled: boolean) => void
  handleDeleteFlow: (flowSlug: string) => void
  handleFlowContentSaved: () => void
  handleUpdateFlowFromDefault: (flowSlug: string) => Promise<void>
  handleUpdateFlowFromSource: (flowSlug: string, sourceWorkspaceSlug: string) => Promise<void>
  handleImportFlow: (sourceSlug: string, flowSlug: string) => Promise<void>
}

export function useFlowsManager(workspaceSlug: string): UseFlowsManagerReturn {
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const [flows, setFlows] = React.useState<FlowMeta[]>([])
  const [flowsDir, setFlowsDir] = React.useState('')
  const [flowsLoading, setFlowsLoading] = React.useState(true)
  const [otherWorkspaceFlows, setOtherWorkspaceFlows] = React.useState<OtherWorkspaceFlowsGroup[]>([])
  const [showImportFlowDialog, setShowImportFlowDialog] = React.useState(false)
  const [selectedFlowSlug, setSelectedFlowSlug] = React.useState<string | null>(null)

  const selectedFlow = flows.find((f) => f.slug === selectedFlowSlug) ?? null

  const loadFlows = React.useCallback(async () => {
    if (!workspaceSlug) {
      setFlowsLoading(false)
      return
    }
    try {
      const [flowList, flowDir] = await Promise.all([
        window.electronAPI.getFlows(workspaceSlug),
        window.electronAPI.getWorkspaceFlowsDir(workspaceSlug),
      ])
      setFlows(flowList)
      setFlowsDir(flowDir)
    } catch (error) {
      console.error('[Flows] 加载失败:', error)
    } finally {
      setFlowsLoading(false)
    }
  }, [workspaceSlug])

  const loadOtherWorkspaceFlows = React.useCallback(async () => {
    if (!workspaceSlug) return
    try {
      const groups = await window.electronAPI.getOtherWorkspaceFlows(workspaceSlug)
      setOtherWorkspaceFlows(groups)
    } catch (error) {
      console.error('[Flows] 加载其他工作区 Flow 失败:', error)
    }
  }, [workspaceSlug])

  React.useEffect(() => {
    if (showImportFlowDialog) void loadOtherWorkspaceFlows()
  }, [showImportFlowDialog, loadOtherWorkspaceFlows])

  React.useEffect(() => { void loadFlows() }, [loadFlows])

  const handleFlowToggle = (flowSlug: string, enabled: boolean): void => {
    if (!workspaceSlug) return
    window.electronAPI.toggleFlow(workspaceSlug, flowSlug)
      .then(() => {
        setFlows((prev) => prev.map((f) => f.slug === flowSlug ? { ...f, enabled } : f))
        bumpCapabilitiesVersion((v) => v + 1)
        toast.success(enabled ? `已启用 Flow: ${flowSlug}` : `已禁用 Flow: ${flowSlug}`)
      })
      .catch((err: unknown) => {
        toast.error(`切换 Flow 失败: ${(err as Error).message}`)
      })
  }

  const handleDeleteFlow = (flowSlug: string): void => {
    if (!workspaceSlug) return
    window.electronAPI.deleteFlow(workspaceSlug, flowSlug)
      .then(() => {
        if (selectedFlowSlug === flowSlug) setSelectedFlowSlug(null)
        setFlows((prev) => prev.filter((f) => f.slug !== flowSlug))
        bumpCapabilitiesVersion((v) => v + 1)
        toast.success(`已删除 Flow: ${flowSlug}`)
      })
      .catch((err: unknown) => {
        toast.error(`删除 Flow 失败: ${(err as Error).message}`)
      })
  }

  const handleFlowContentSaved = (): void => {
    void loadFlows()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  const handleUpdateFlowFromDefault = async (flowSlug: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.upgradeDefaultFlow(workspaceSlug, flowSlug)
      await loadFlows()
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已更新 Flow: ${flowSlug}`)
    } catch (err: unknown) {
      toast.error(`更新 Flow 失败: ${(err as Error).message}`)
    }
  }

  const handleUpdateFlowFromSource = async (flowSlug: string, sourceWorkspaceSlug: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.updateFlowFromSource(workspaceSlug, sourceWorkspaceSlug, flowSlug)
      await loadFlows()
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已更新 Flow: ${flowSlug}`)
    } catch (err: unknown) {
      toast.error(`更新 Flow 失败: ${(err as Error).message}`)
    }
  }

  const handleImportFlow = async (sourceSlug: string, flowSlug: string): Promise<void> => {
    if (!workspaceSlug) return
    try {
      await window.electronAPI.importFlowFromWorkspace(workspaceSlug, sourceSlug, flowSlug)
      await loadFlows()
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已导入 Flow: ${flowSlug}`)
    } catch (err: unknown) {
      toast.error(`导入 Flow 失败: ${(err as Error).message}`)
    }
  }

  return {
    flows,
    flowsDir,
    flowsLoading,
    otherWorkspaceFlows,
    showImportFlowDialog,
    selectedFlowSlug,
    selectedFlow,
    setShowImportFlowDialog,
    setSelectedFlowSlug,
    reloadFlows: loadFlows,
    handleFlowToggle,
    handleDeleteFlow,
    handleFlowContentSaved,
    handleUpdateFlowFromDefault,
    handleUpdateFlowFromSource,
    handleImportFlow,
  }
}
