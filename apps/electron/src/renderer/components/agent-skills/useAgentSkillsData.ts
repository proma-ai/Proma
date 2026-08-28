/**
 * useAgentSkillsData — Agent 技能视图的数据层
 *
 * 封装当前工作区 Skills / MCP 的加载与增删改逻辑（IPC 调用），
 * 供「Agent 技能」全屏视图复用。当前 Skills 页面挂载期间固定初始快照，
 * 避免文件监听导致的重排和整页跳动；开关仅更新对应卡片的 enabled 字段。
 * 只读浏览不会验证或写回 MCP 配置，离开后下次进入或切换工作区时再重新读取完整能力列表。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import type { BuiltinMcpServerSummary, CliIntegrationStatus, McpServerEntry, SkillMeta, WorkspaceCapabilities, WorkspaceMcpConfig } from '@proma/shared'
import type { CatalogCliProbeState } from './integration-catalog'

const CLI_STATUS_CACHE_TTL_MS = 5 * 60 * 1000
const cliIntegrationStatusCache = new Map<string, { statuses: CliIntegrationStatus[]; cachedAt: number }>()
const cliIntegrationStatusRequests = new Map<string, Promise<CliIntegrationStatus[]>>()

/** Reuse recent probes for a short period so revisiting a workspace does not flash through loading. */
function probeCliIntegrationStatuses(workspaceSlug: string): Promise<CliIntegrationStatus[]> {
  const cached = cliIntegrationStatusCache.get(workspaceSlug)
  if (cached && Date.now() - cached.cachedAt < CLI_STATUS_CACHE_TTL_MS) return Promise.resolve(cached.statuses)

  const inFlight = cliIntegrationStatusRequests.get(workspaceSlug)
  if (inFlight) return inFlight

  const request = Promise.resolve().then(() => window.electronAPI.getCliIntegrationStatuses(workspaceSlug))
  cliIntegrationStatusRequests.set(workspaceSlug, request)
  void request.then((statuses) => {
    cliIntegrationStatusCache.set(workspaceSlug, { statuses, cachedAt: Date.now() })
    if (cliIntegrationStatusRequests.get(workspaceSlug) === request) cliIntegrationStatusRequests.delete(workspaceSlug)
  }, () => {
    if (cliIntegrationStatusRequests.get(workspaceSlug) === request) cliIntegrationStatusRequests.delete(workspaceSlug)
  })
  return request
}

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
  capabilities: WorkspaceCapabilities | null
  builtinMcpServers: BuiltinMcpServerSummary[]
  cliIntegrationStatuses: CliIntegrationStatus[]
  cliIntegrationProbeState: CatalogCliProbeState
  updatingSkill: string | null
  setCliIntegrationEnabled: (id: string, enabled: boolean) => Promise<void>
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>
  deleteSkill: (slug: string, name: string) => Promise<boolean>
  updateSkill: (slug: string) => Promise<void>
  refreshMcpConfig: () => Promise<void>
  toggleMcp: (name: string, enabled: boolean) => Promise<{ success: boolean; message: string }>
  installMcp: (name: string, entry: McpServerEntry) => Promise<boolean>
  toggleBuiltinMcp: (id: string, enabled: boolean) => Promise<void>
  deleteMcp: (name: string) => Promise<void>
}

/**
 * workspaceId 指定时用于右侧 Component Workspace：数据归属必须锁定到宿主 Agent
 * 会话的项目，不能跟随全局项目选择器切换。
 */
export function useAgentSkillsData(workspaceId?: string): AgentSkillsData {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const selectedWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === (workspaceId ?? selectedWorkspaceId))
  const workspaceSlug = currentWorkspace?.slug ?? ''

  const [loading, setLoading] = React.useState(true)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [defaultSkillSlugs, setDefaultSkillSlugs] = React.useState<Set<string>>(new Set())
  const [skillsDir, setSkillsDir] = React.useState('')
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [builtinMcpServers, setBuiltinMcpServers] = React.useState<BuiltinMcpServerSummary[]>([])
  const [cliIntegrationStatuses, setCliIntegrationStatuses] = React.useState<CliIntegrationStatus[]>([])
  const [cliIntegrationProbeState, setCliIntegrationProbeState] = React.useState<CatalogCliProbeState>('loading')
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)
  const loadRequestRef = React.useRef(0)
  const cliProbeRequestRef = React.useRef(0)

  const loadData = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setCapabilities(null)
      setBuiltinMcpServers([])
      setCliIntegrationStatuses([])
      setCliIntegrationProbeState('ready')
      setLoading(false)
      return
    }
    try {
      // CLI authentication checks can spawn several local commands and are intentionally
      // excluded from this first render-critical batch.
      const [config, skillList, dir, defaultSlugs, capabilities] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
        window.electronAPI.getDefaultSkillSlugs(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
      ])
      if (loadRequestRef.current !== requestId) return
      setMcpConfig(config)
      setSkills(skillList)
      setSkillsDir(dir)
      setDefaultSkillSlugs(new Set(defaultSlugs))
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
      const cachedCliStatuses = cliIntegrationStatusCache.get(workspaceSlug)
      const hasFreshCliCache = cachedCliStatuses && Date.now() - cachedCliStatuses.cachedAt < CLI_STATUS_CACHE_TTL_MS
      setCliIntegrationProbeState(hasFreshCliCache ? 'ready' : 'loading')
      setCliIntegrationStatuses(cachedCliStatuses?.statuses ?? [])
      setLoading(false)

      const cliProbeRequestId = ++cliProbeRequestRef.current
      void probeCliIntegrationStatuses(workspaceSlug)
        .then((statuses) => {
          if (loadRequestRef.current !== requestId || cliProbeRequestRef.current !== cliProbeRequestId) return
          setCliIntegrationStatuses(statuses)
          cliIntegrationStatusCache.set(workspaceSlug, { statuses, cachedAt: Date.now() })
          setCliIntegrationProbeState('ready')
        })
        .catch((error) => {
          if (loadRequestRef.current !== requestId || cliProbeRequestRef.current !== cliProbeRequestId) return
          console.warn('[Agent 技能] 后台检测 CLI 集成状态失败:', error)
          setCliIntegrationProbeState('failed')
        })

    } catch (error) {
      if (loadRequestRef.current !== requestId) return
      console.error('[Agent 技能] 加载工作区配置失败:', error)
      setLoading(false)
    }
  }, [workspaceSlug])

  // 只在进入页面或切换工作区时读取。文件监听会在切换开关后异步推送能力变化，
  // 这里刻意不订阅 capabilitiesVersion，防止扫描 active/inactive 目录后重排当前列表。
  React.useEffect(() => {
    setLoading(true)
    void loadData()
    return () => { ++cliProbeRequestRef.current }
  }, [loadData])

  const setCliIntegrationEnabled = React.useCallback(async (id: string, enabled: boolean): Promise<void> => {
    const cliProbeRequestId = ++cliProbeRequestRef.current
    try {
      const statuses = await window.electronAPI.setCliIntegrationEnabled(workspaceSlug, id, enabled)
      if (cliProbeRequestRef.current !== cliProbeRequestId) return
      setCliIntegrationStatuses(statuses)
      cliIntegrationStatusCache.set(workspaceSlug, { statuses, cachedAt: Date.now() })
      setCliIntegrationProbeState('ready')
    } catch (error) {
      if (cliProbeRequestRef.current === cliProbeRequestId) setCliIntegrationProbeState('failed')
      console.error('[Agent 技能] 切换 CLI 集成状态失败:', error)
      throw error
    }
  }, [workspaceSlug])

  const toggleSkill = React.useCallback(async (slug: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug])

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

  const refreshMcpConfig = React.useCallback(async () => {
    if (!workspaceSlug) return
    try {
      const config = await window.electronAPI.getWorkspaceMcpConfig(workspaceSlug)
      setMcpConfig(config)
    } catch (error) {
      console.error('[Agent 技能] 刷新 MCP 配置失败:', error)
    }
  }, [workspaceSlug])

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean): Promise<{ success: boolean; message: string }> => {
    try {
      // Main owns the save → validation → conditional writeback lifecycle, so a
      // slow handshake cannot restore this renderer's stale configuration.
      const result = await window.electronAPI.setMcpEnabledAndValidate(workspaceSlug, name, enabled)
      setMcpConfig(result.config)
      bumpCapabilitiesVersion((v) => v + 1)
      return result.verification
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
      return { success: false, message: error instanceof Error ? error.message : '切换 MCP 状态失败' }
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const installMcp = React.useCallback(async (name: string, entry: McpServerEntry): Promise<boolean> => {
    try {
      // Do not build a whole config from renderer state: concurrent installs or
      // edits are resolved against the latest main-process snapshot instead.
      const result = await window.electronAPI.installMcpAndValidate(workspaceSlug, name, entry)
      setMcpConfig(result.config)
      if (result.installed) bumpCapabilitiesVersion((v) => v + 1)
      return result.installed
    } catch (error) {
      console.error('[Agent 技能] 安装 MCP 失败:', error)
      toast.error('安装 MCP 失败')
      return false
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const toggleBuiltinMcp = React.useCallback(async (id: string, enabled: boolean) => {
    try {
      const capabilities = await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, id, enabled)
      setCapabilities(capabilities)
      setBuiltinMcpServers(capabilities.builtinMcpServers)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(enabled ? '已启用内置 MCP' : '已关闭内置 MCP')
    } catch (error) {
      console.error('[Agent 技能] 切换内置 MCP 状态失败:', error)
      toast.error('切换内置 MCP 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

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
      try {
        await window.electronAPI.deleteMcpCredential(workspaceSlug, name)
      } catch (error) {
        console.error('[Agent 技能] MCP 配置已删除，但安全凭据清理失败:', error)
        toast.warning('MCP 配置已删除，但安全凭据清理失败')
        return
      }
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
    capabilities,
    builtinMcpServers,
    cliIntegrationStatuses,
    cliIntegrationProbeState,
    updatingSkill,
    setCliIntegrationEnabled,
    toggleSkill,
    deleteSkill,
    updateSkill,
    refreshMcpConfig,
    toggleMcp,
    installMcp,
    toggleBuiltinMcp,
    deleteMcp,
  }
}
