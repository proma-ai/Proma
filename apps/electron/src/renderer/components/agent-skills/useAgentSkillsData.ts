/**
 * useAgentSkillsData — Agent 技能视图的数据层
 *
 * 封装当前工作区 Skills / MCP 的加载与增删改逻辑（IPC 调用），
 * 供「Agent 技能」全屏视图复用。所有写操作后会 bump
 * workspaceCapabilitiesVersionAtom，通知侧边栏等订阅方刷新。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import type { SkillMeta, WorkspaceMcpConfig } from '@proma/shared'

export interface AgentSkillsData {
  /** 当前工作区（未选中时为 null） */
  workspaceSlug: string
  workspaceName: string
  hasWorkspace: boolean
  loading: boolean
  skills: SkillMeta[]
  defaultSkillSlugs: Set<string>
  skillsDir: string
  mcpConfig: WorkspaceMcpConfig
  updatingSkill: string | null
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>
  deleteSkill: (slug: string, name: string) => Promise<boolean>
  updateSkill: (slug: string) => Promise<void>
  toggleMcp: (name: string, enabled: boolean) => Promise<void>
  deleteMcp: (name: string) => Promise<void>
}

export function useAgentSkillsData(): AgentSkillsData {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  const [loading, setLoading] = React.useState(true)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [defaultSkillSlugs, setDefaultSkillSlugs] = React.useState<Set<string>>(new Set())
  const [skillsDir, setSkillsDir] = React.useState('')
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setLoading(false)
      return
    }
    try {
      const [config, skillList, dir, defaultSlugs] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
        window.electronAPI.getDefaultSkillSlugs(),
      ])
      setMcpConfig(config)
      setSkills(skillList)
      setSkillsDir(dir)
      setDefaultSkillSlugs(new Set(defaultSlugs))
    } catch (error) {
      console.error('[Agent 技能] 加载工作区配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  // workspaceSlug 或外部能力版本变化时重新拉取
  React.useEffect(() => {
    setLoading(true)
    void loadData()
  }, [loadData, capabilitiesVersion])

  const toggleSkill = React.useCallback(async (slug: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const deleteSkill = React.useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, slug)
      setSkills((prev) => prev.filter((s) => s.slug !== slug))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 Skill：${name}`)
      return true
    } catch (error) {
      console.error('[Agent 技能] 删除 Skill 失败:', error)
      toast.error('删除 Skill 失败')
      return false
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const updateSkill = React.useCallback(async (slug: string) => {
    if (!workspaceSlug || updatingSkill) return
    setUpdatingSkill(slug)
    try {
      const updated = await window.electronAPI.updateSkillFromSource(workspaceSlug, slug)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? updated : s)))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已同步更新 Skill：${updated.name}`)
    } catch (error) {
      console.error('[Agent 技能] 更新 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('更新 Skill 失败', { description: message })
    } finally {
      setUpdatingSkill(null)
    }
  }, [workspaceSlug, updatingSkill, bumpCapabilitiesVersion])

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean) => {
    try {
      const entry = mcpConfig.servers[name]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [name]: { ...entry, enabled } },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  const deleteMcp = React.useCallback(async (name: string) => {
    const entry = mcpConfig.servers[name]
    if (entry?.isBuiltin) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[name]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 MCP 服务器：${name}`)
    } catch (error) {
      console.error('[Agent 技能] 删除 MCP 服务器失败:', error)
      toast.error('删除 MCP 服务器失败')
    }
  }, [workspaceSlug, mcpConfig, bumpCapabilitiesVersion])

  return {
    workspaceSlug,
    workspaceName: currentWorkspace?.name ?? '',
    hasWorkspace: !!currentWorkspace,
    loading,
    skills,
    defaultSkillSlugs,
    skillsDir,
    mcpConfig,
    updatingSkill,
    toggleSkill,
    deleteSkill,
    updateSkill,
    toggleMcp,
    deleteMcp,
  }
}
