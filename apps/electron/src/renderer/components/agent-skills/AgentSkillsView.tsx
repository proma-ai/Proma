/**
 * AgentSkillsView — 「Agent 技能」全屏视图
 *
 * 由侧边栏「Agent 技能」入口触发，全屏占据中间内容区（隐藏 TabBar 与右侧文件面板）。
 *
 * 结构：
 * - 顶部：标题 + 工作区切换下拉
 * - 工具条：Skills / MCP 切换 + 搜索 + 社区市场（占位）+ 新增入口
 * - 内容：能力卡片网格（商店风），点击卡片在当前 Skills 视图中预览详情
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Blocks, ChevronDown, ChevronRight, Search, Plus, Store, FolderOpen, Check, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { agentPendingPromptAtom, agentSessionDraftHtmlAtom, agentSessionDraftsAtom, agentSessionDraftSyncVersionsAtom, currentAgentSessionIdAtom, skillDetailNavigationAtomFamily, workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { agentSkillsTabAtom } from '@/atoms/active-view'
import { useProjectActions } from '@/hooks/useProjectActions'
import { useCreateSession } from '@/hooks/useCreateSession'
import { LocalProjectBadge } from '@/components/agent/LocalProjectBadge'
import { AgentActionHint } from '@/components/agent/AgentActionHint'
import { queuedTextToParagraphHtml } from '@/lib/agent-message-queue'
import type { McpServerEntry, SkillMeta } from '@proma/shared'
import { useAgentSkillsData } from './useAgentSkillsData'
import { SkillCard } from './SkillCard'
import { McpCard } from './McpCard'
import { SkillDetailView } from './SkillDetailView'
import { McpDetailView } from './McpDetailView'
import { ImportSkillDialog } from './ImportSkillDialog'
import { WorkspaceMemoryTab } from './WorkspaceMemoryTab'
import { groupSkills } from './skillGrouping'
import { EMBEDDED_CATALOG_TWO_COLUMN_MIN_WIDTH, IntegrationCatalog } from './IntegrationCatalog'
import { CredentialDialog } from './CredentialDialog'
import { buildCatalogMcpGuidePrompt, MCP_INTEGRATION_CATALOG, getCatalogServerNames, isCatalogIntegrationVisible, matchesCatalogSearch, type CatalogCliIntegration, type CatalogCliProbeState, type CatalogCredentialIntegration, type CatalogGuidedIntegration, type CatalogMcpIntegration } from './integration-catalog'

const embeddedMcpSectionContainerQuery = `
  @container (min-width: ${EMBEDDED_CATALOG_TWO_COLUMN_MIN_WIDTH}) {
    .mcp-section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`

function buildSkillClassificationPrompt(input: {
  workspaceName: string
  skillsDir: string
  skills: SkillMeta[]
}): string {
  const skillList = input.skills
    .map((skill) => {
      const meta: string[] = []
      if (skill.group) meta.push(`group=${skill.group}`)
      return `- ${skill.slug} (${skill.name})${meta.length > 0 ? ` [${meta.join('; ')}]` : ''}`
    })
    .join('\n')

  return `请帮我整理当前项目在 Proma 工作区中保存的 Skills 的分组。

项目：${input.workspaceName || '当前项目'}
Skills 目录：${input.skillsDir}

当前已安装 Skills：
${skillList || '- 暂无'}

目标：
1. 逐个读取 Skills 目录下每个子目录的 SKILL.md，基于实际 description 和正文内容判断用途，不要只靠 slug、文件夹名或固定前缀猜分类。
2. 为每个 Skill 补全或修正 frontmatter 中的 group：
   - group 是一个简短、稳定的一级分组，直接用人类可读名称，例如 "Lark"、"文档"、"演示文稿"、"规划协作"。这些只是例子，不是固定枚举；请根据实际内容归纳。
   - 分组数量要克制，优先让用户能快速折叠/浏览，不要把每个细分场景都做成新组。
3. 只修改每个 SKILL.md 的 YAML frontmatter；保留 name、description、version、license、icon 等已有字段，不要改正文内容。
4. 对已有 group 做增量修订：明显准确的保留，不准确、缺失或过粗的再调整。
5. 同一平台或同一能力域的 Skills 应该归到同一个 group。
6. 如果某个 Skill 内容证据不足，放入 "未分组"，不要编造用途。
7. 只处理上述 Skills 目录内的 Skill，不要修改仓库 bundled default-skills、README、AGENTS.md 或其他 unrelated 文件。

写入格式示例：

---
name: example
description: ...
group: Lark
version: "1.0.0"
---

完成后请回复：
- 修改了多少个 Skill
- 使用了哪些 group，各自包含哪些 Skill
- 哪些 Skill 的分类不确定，以及原因
- 是否有需要用户确认或后续合并同类项的建议`
}

function buildManualMcpGuidePrompt(): string {
  return `帮我为当前 Proma 工作区添加一个 MCP 服务器。

1. 先确认服务名和官方文档或 MCP 地址；信息不足时先问，不要猜测配置。
2. 依据官方文档核验 transport、地址/命令、依赖、认证与权限；安全步骤可直接完成，登录、授权、付费或敏感凭据由我确认或操作。
3. 写入前读取当前 mcp.json，只新增或更新目标服务，绝不覆盖其他配置；敏感凭据不写入 mcp.json、日志或普通文件。
4. 完成真实连接验证后再启用；说明结果及下一步。新 MCP 需要在下一条消息或新会话中验证工具可用性。`
}

export function AgentSkillsView({
  embedded = false,
  componentTab,
  workspaceId,
  sessionId,
}: { embedded?: boolean; componentTab?: 'skills' | 'mcp'; workspaceId?: string; sessionId?: string } = {}): React.ReactElement {
  const data = useAgentSkillsData(workspaceId)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const store = useStore()
  const setDrafts = useSetAtom(agentSessionDraftsAtom)
  const setDraftHtml = useSetAtom(agentSessionDraftHtmlAtom)
  const setDraftSyncVersions = useSetAtom(agentSessionDraftSyncVersionsAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const skillDetailNavigation = useAtomValue(skillDetailNavigationAtomFamily(sessionId ?? ''))
  const setSkillDetailNavigation = useSetAtom(skillDetailNavigationAtomFamily(sessionId ?? ''))
  const { workspaces, currentWorkspaceId: selectedWorkspaceId, selectProject } = useProjectActions()
  const { createAgent } = useCreateSession()
  const currentWorkspace = workspaces.find((workspace) => workspace.id === (workspaceId ?? selectedWorkspaceId))

  const fillCurrentAgentPrompt = React.useCallback((message: string): boolean => {
    const targetSessionId = sessionId ?? currentAgentSessionId
    if (!targetSessionId) {
      toast.error('请先打开一个 Agent 会话')
      return false
    }

    const currentDraft = store.get(agentSessionDraftsAtom).get(targetSessionId) ?? ''
    const currentDraftHtml = store.get(agentSessionDraftHtmlAtom).get(targetSessionId) ?? ''
    const hasDraft = currentDraft.trim().length > 0
    const nextDraft = hasDraft ? `${currentDraft.trimEnd()}\n\n${message}` : message

    setDrafts((previous) => {
      const next = new Map(previous)
      next.set(targetSessionId, nextDraft)
      return next
    })
    setDraftHtml((previous) => {
      const next = new Map(previous)
      if (hasDraft) {
        const draftHtml = currentDraftHtml.trim().length > 0
          ? currentDraftHtml
          : queuedTextToParagraphHtml(currentDraft)
        next.set(targetSessionId, `${draftHtml}${queuedTextToParagraphHtml(message)}`)
      } else {
        // Preserve normal RichTextInput rendering for a previously empty draft.
        next.delete(targetSessionId)
      }
      return next
    })
    setDraftSyncVersions((previous) => {
      const next = new Map(previous)
      next.set(targetSessionId, (next.get(targetSessionId) ?? 0) + 1)
      return next
    })
    return true
  }, [currentAgentSessionId, sessionId, setDraftHtml, setDraftSyncVersions, setDrafts, store])

  const [storedTab, setTab] = useAtom(agentSkillsTabAtom)
  // 右侧组件锁定能力域，避免其内部的总览 Tab 与右侧工作区标签产生两套导航。
  const tab = embedded && componentTab ? componentTab : storedTab
  const [search, setSearch] = React.useState('')
  const [selectedSkillSlug, setSelectedSkillSlug] = React.useState<string | null>(null)
  const [selectedSkillWorkspaceSlug, setSelectedSkillWorkspaceSlug] = React.useState<string | null>(null)
  const [selectedMcpName, setSelectedMcpName] = React.useState<string | null>(null)
  const [showImport, setShowImport] = React.useState(false)
  const [wsPopoverOpen, setWsPopoverOpen] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)
  const [classifyingSkills, setClassifyingSkills] = React.useState(false)
  const [guidingManualMcp, setGuidingManualMcp] = React.useState(false)
  const [installingCatalogMcpId, setInstallingCatalogMcpId] = React.useState<string | null>(null)
  const [pendingCredentialIntegration, setPendingCredentialIntegration] = React.useState<CatalogCredentialIntegration | null>(null)

  const selectSkill = React.useCallback((slug: string): void => {
    setSelectedSkillSlug(slug)
    setSelectedSkillWorkspaceSlug(data.workspaceSlug)
  }, [data.workspaceSlug])
  const closeSkill = React.useCallback((): void => {
    setSelectedSkillSlug(null)
    setSelectedSkillWorkspaceSlug(null)
  }, [])

  const q = search.trim().toLowerCase()

  const filteredSkills = React.useMemo(() => {
    return data.skills.filter((s) => {
      if (!q) return true
      return s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.group ?? '').toLowerCase().includes(q)
    })
  }, [data.skills, q])

  const customSkills = filteredSkills.filter((s) => !data.defaultSkillSlugs.has(s.slug))
  const builtinSkills = filteredSkills.filter((s) => data.defaultSkillSlugs.has(s.slug))
  const updateCount = data.skills.filter((s) => s.hasUpdate).length

  const catalogServerNames = React.useMemo(() => getCatalogServerNames(), [])

  const userMcpEntries = React.useMemo(() => {
    return Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name]) => !catalogServerNames.has(name))
      .filter(([name]) => !q || name.toLowerCase().includes(q))
  }, [catalogServerNames, data.mcpConfig, q])

  const catalogMcps = React.useMemo(() => {
    return MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogMcpIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'mcp' && matchesCatalogSearch(integration, q),
    )
  }, [q])

  const catalogClis = React.useMemo(() => {
    return MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogCliIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'cli' && matchesCatalogSearch(integration, q),
    )
  }, [q])

  const catalogGuided = React.useMemo(() => {
    return MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogGuidedIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'guided' && matchesCatalogSearch(integration, q),
    )
  }, [q])

  const catalogCredentials = React.useMemo(() => {
    return MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogCredentialIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'credential' && matchesCatalogSearch(integration, q),
    )
  }, [q])

  // 不含搜索过滤的 MCP 总数（Tab 计数与空态判断用）
  const mcpCount = React.useMemo(
    () => Object.keys(data.mcpConfig.servers ?? {}).length,
    [data.mcpConfig],
  )
  const memoryCount = (data.capabilities?.memory.agentsMd.exists ? 1 : 0) + (data.capabilities?.memory.autoMemory.fileCount ?? 0)

  const selectedSkill = selectedSkillWorkspaceSlug === data.workspaceSlug
    && data.loadedWorkspaceSlug === data.workspaceSlug
    ? data.skills.find((s) => s.slug === selectedSkillSlug) ?? null
    : null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false
  const selectedMcp = selectedMcpName ? data.mcpConfig.servers[selectedMcpName] ?? null : null

  React.useEffect(() => {
    if (!skillDetailNavigation || data.loading) return
    if (skillDetailNavigation.workspaceSlug && skillDetailNavigation.workspaceSlug !== data.workspaceSlug) {
      toast.error('该 Skill 属于另一个项目，无法在当前 Skills 中打开')
      setSkillDetailNavigation(null)
      return
    }
    if (!data.skills.some((skill) => skill.slug === skillDetailNavigation.skillSlug)) {
      toast.error('当前项目未找到该 Skill')
      setSkillDetailNavigation(null)
      return
    }
    selectSkill(skillDetailNavigation.skillSlug)
    setSkillDetailNavigation(null)
  }, [data.loading, data.skills, data.workspaceSlug, selectSkill, setSkillDetailNavigation, skillDetailNavigation])

  const openSkillFolder = (slug: string): void => {
    if (!data.workspaceSlug) return
    void window.electronAPI.openWorkspaceSkillFolder(data.workspaceSlug, slug).catch((error) => {
      console.error('[Agent 技能] 打开 Skill 目录失败:', error)
      toast.error('打开 Skill 目录失败')
    })
  }

  const guideManualMcp = React.useCallback((): void => {
    if (guidingManualMcp) return
    setGuidingManualMcp(true)
    try {
      if (fillCurrentAgentPrompt(buildManualMcpGuidePrompt())) {
        toast.success('已填入 MCP 配置提示词')
      }
    } finally {
      setGuidingManualMcp(false)
    }
  }, [fillCurrentAgentPrompt, guidingManualMcp])

  const guideCatalogMcp = React.useCallback((integration: CatalogMcpIntegration): void => {
    if (fillCurrentAgentPrompt(buildCatalogMcpGuidePrompt(integration))) {
      toast.success(`已填入 ${integration.name} 配置提示词`)
    }
  }, [fillCurrentAgentPrompt])

  const installCatalogMcp = React.useCallback(async (integration: CatalogMcpIntegration): Promise<void> => {
    if (installingCatalogMcpId) return
    if (integration.authentication !== 'none' && !integration.oauthProvider) {
      await guideCatalogMcp(integration)
      return
    }
    if (integration.authentication === 'oauth' && integration.oauthProvider && integration.entry.url) {
      setInstallingCatalogMcpId(integration.id)
      try {
        const existing = data.mcpConfig.servers[integration.serverName]
        if (!existing) {
          const installed = await data.installMcp(integration.serverName, integration.entry)
          if (!installed) return
        }
        await window.electronAPI.startMcpOAuth({
          workspaceSlug: data.workspaceSlug,
          serverName: integration.serverName,
          provider: integration.oauthProvider,
          serverUrl: integration.entry.url,
        })
        const verification = await data.toggleMcp(integration.serverName, true)
        if (!verification.success) {
          throw new Error(verification.message || 'MCP 握手或工具发现失败，请检查授权后重试')
        }
        toast.success(`${integration.name} 已完成授权`, { description: 'OAuth token 已安全保存，MCP 已启用。' })
      } catch (error) {
        console.error(`[Agent 技能] ${integration.name} OAuth 失败:`, error)
        toast.error(`${integration.name} 授权失败`, { description: error instanceof Error ? error.message : '请稍后重试' })
      } finally {
        setInstallingCatalogMcpId(null)
      }
      return
    }

    const existing = data.mcpConfig.servers[integration.serverName]
    if (existing) {
      setSelectedMcpName(integration.serverName)
      return
    }
    setInstallingCatalogMcpId(integration.id)
    try {
      const installed = await data.installMcp(integration.serverName, integration.entry)
      if (!installed) return
      toast.success(`已添加 ${integration.name}`, {
        description: integration.authentication === 'none' ? '已启用，可在「我的 MCP」中测试连接。' : '已写入待配置模板。需要时可从卡片打开配置，不会自动跳转浏览器。',
      })
      return
    } finally {
      setInstallingCatalogMcpId(null)
    }
  }, [data, guideCatalogMcp, installingCatalogMcpId])

  const connectCredentialIntegration = React.useCallback(async (integration: CatalogCredentialIntegration, value: string): Promise<void> => {
    if (installingCatalogMcpId) return
    setInstallingCatalogMcpId(integration.id)
    try {
      const existing = data.mcpConfig.servers[integration.serverName]
      if (!existing) {
        const installed = await data.installMcp(integration.serverName, integration.entry)
        if (!installed) throw new Error('无法创建连接配置')
      }
      await window.electronAPI.saveMcpApiKey({
        workspaceSlug: data.workspaceSlug,
        serverName: integration.serverName,
        serverUrl: integration.entry.url!,
        headerName: integration.credential.headerName,
        value,
      })
      const verification = await data.toggleMcp(integration.serverName, true)
      if (!verification.success) {
        throw new Error(verification.message || 'MCP 握手或工具发现失败，请检查 Token 和空间权限后重试')
      }
      toast.success(`${integration.name} 已连接`, { description: 'MCP Token 已加密保存到系统 Keychain，并已通过真实握手和工具发现验证。' })
    } catch (error) {
      console.error(`[Agent 技能] ${integration.name} 凭据配置失败:`, error)
      toast.error(`${integration.name} 连接失败`, { description: error instanceof Error ? error.message : '请检查凭据后重试' })
      throw error
    } finally {
      setInstallingCatalogMcpId(null)
    }
  }, [data, installingCatalogMcpId])

  const guideCatalogCli = React.useCallback(async (integration: CatalogCliIntegration): Promise<void> => {
    try {
      // “配置”是重新授予 Proma 使用此 CLI 的入口，不会影响 CLI 自己的登录或授权。
      await data.setCliIntegrationEnabled(integration.id, true)
    } catch {
      toast.error(`无法启用 ${integration.name} 集成`)
      return
    }

    if (fillCurrentAgentPrompt(integration.agentPrompt)) {
      toast.success(`已填入 ${integration.name} 配置提示词`)
    }
  }, [data, fillCurrentAgentPrompt])

  const disconnectCatalogCli = React.useCallback(async (integration: CatalogCliIntegration): Promise<void> => {
    try {
      await data.setCliIntegrationEnabled(integration.id, false)
      toast.success(`已断开 ${integration.name}`, { description: '仅停止 Proma 使用该 CLI，不会登出或撤销第三方授权。' })
    } catch {
      toast.error(`无法断开 ${integration.name}`)
    }
  }, [data])

  const guideCatalogIntegration = React.useCallback((integration: CatalogGuidedIntegration): void => {
    if (fillCurrentAgentPrompt(integration.agentPrompt)) {
      toast.success(`已填入 ${integration.name} 配置提示词`)
    }
  }, [fillCurrentAgentPrompt])

  const handleClassifySkills = React.useCallback(async (): Promise<void> => {
    if (classifyingSkills) return
    if (!data.skillsDir) {
      toast.error('无法定位当前项目的 Proma 工作区 Skills 目录')
      return
    }
    setClassifyingSkills(true)
    try {
      const sessionId = await createAgent()
      if (!sessionId) {
        toast.error('创建 Agent 会话失败')
        return
      }
      setPendingPrompt({
        sessionId,
        message: buildSkillClassificationPrompt({
          workspaceName: data.workspaceName,
          skillsDir: data.skillsDir,
          skills: data.skills,
        }),
      })
      toast.success('已创建 Skills 分类整理会话')
    } catch (error) {
      console.error('[Agent 技能] 创建 Skills 分类会话失败:', error)
      toast.error(error instanceof Error ? error.message : '创建 Skills 分类会话失败')
    } finally {
      setClassifyingSkills(false)
    }
  }, [classifyingSkills, createAgent, data.skills, data.skillsDir, data.workspaceName, setPendingPrompt])

  const skillDeleteDialog = (
    <ConfirmDialog
      open={pendingDeleteSkill !== null}
      onOpenChange={(open) => { if (!open) setPendingDeleteSkill(null) }}
      title={`确认删除 Skill「${pendingDeleteSkill?.name}」？`}
      description="删除后将无法恢复，确定要卸载这个 Skill 吗？"
      confirmLabel="删除"
      loadingLabel="删除中..."
      loading={isDeletingSkill}
      onConfirm={async () => {
        if (!pendingDeleteSkill || isDeletingSkill) return
        setIsDeletingSkill(true)
        const ok = await data.deleteSkill(pendingDeleteSkill.slug, pendingDeleteSkill.name)
        setIsDeletingSkill(false)
        setPendingDeleteSkill(null)
        if (ok) closeSkill()
      }}
    />
  )

  if (!data.hasWorkspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
          <Blocks className="size-8 text-foreground/30" />
        </div>
        <div className="text-[15px] font-medium text-foreground/80">未选择项目</div>
        <div className="max-w-sm text-[13px] text-foreground/50">
          请先在 Agent 模式下选择或创建一个项目，再来管理它的 Skills 与 MCP。
        </div>
      </div>
    )
  }

  if (selectedSkill) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <SkillDetailView
          key={`${data.workspaceSlug}:${selectedSkill.slug}`}
          skill={selectedSkill}
          workspaceSlug={data.workspaceSlug}
          contentVersion={data.skillsRevision}
          isBuiltin={selectedIsBuiltin}
          updating={data.updatingSkill === selectedSkill.slug}
          onBack={closeSkill}
          onToggle={(enabled) => data.toggleSkill(selectedSkill.slug, enabled)}
          onUpdate={() => data.updateSkill(selectedSkill.slug)}
          onRequestDelete={() => setPendingDeleteSkill(selectedSkill)}
          onOpenFolder={() => openSkillFolder(selectedSkill.slug)}
        />
        {skillDeleteDialog}
      </div>
    )
  }

  if (selectedMcpName && selectedMcp) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <McpDetailView
          key={selectedMcpName}
          name={selectedMcpName}
          entry={selectedMcp}
          workspaceSlug={data.workspaceSlug}
          onBack={() => setSelectedMcpName(null)}
          onChanged={async () => {
            await data.refreshMcpConfig()
            bumpCapabilities((v) => v + 1)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={cn('flex h-full flex-col overflow-hidden', embedded && 'skills-embedded-container')}
      // Container query keeps the catalog responsive to this resizable SidePanel.
      style={embedded ? { containerType: 'inline-size' } : undefined}
    >
      {/* 标题栏 + 工作区切换 */}
      {/* 不加 titlebar-drag-region：与 DropdownMenu 嵌套时 drag/no-drag 会让 Radix 拿不到
          pointerdown，下拉打不开。窗口拖拽由 AppShell 顶部 0–50px 的全局 drag 层兜底。
          pt-14 让按钮整体位于全局 drag 层（0–50px, z-50）下方，避免被吃掉点击。 */}
      <div className={cn('titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between', embedded ? 'px-4 py-3' : 'px-8 pt-14 pb-4')}>
        <div className="flex items-center gap-2.5">
          <Blocks className="size-6 text-foreground/70" />
          <h1 className={cn('font-semibold text-foreground', embedded ? 'text-lg' : 'text-2xl')}>{embedded ? (tab === 'mcp' ? 'MCP' : 'Skills') : 'Agent 技能'}</h1>
        </div>

        {!embedded && <Popover open={wsPopoverOpen} onOpenChange={setWsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04]"
            >
              <FolderOpen size={14} className="text-foreground/45" />
              <span className="max-w-[180px] truncate">{data.workspaceName}</span>
              <LocalProjectBadge
                projectRootPath={currentWorkspace?.projectRootPath}
                projectRootStatus={currentWorkspace?.projectRootStatus}
              />
              <ChevronDown size={14} className="text-foreground/45" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[320px] w-56 overflow-y-auto scrollbar-thin p-1">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  if (w.id !== selectedWorkspaceId) {
                    selectProject(w.id, { resetView: false })
                    toast.success(`已切换到项目「${w.name}」`)
                  }
                  setWsPopoverOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  w.id === selectedWorkspaceId
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <LocalProjectBadge
                  projectRootPath={w.projectRootPath}
                  projectRootStatus={w.projectRootStatus}
                />
                {w.id === selectedWorkspaceId && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>}
      </div>

      {embedded && (
        <div className="titlebar-no-drag mx-auto w-full max-w-6xl shrink-0 px-3 pb-3">
          <AgentActionHint action={tab === 'skills' ? '创建、整理、更新或删除 Skills' : '查找、配置或移除 MCP'} />
        </div>
      )}

      {/* 工具条 */}
      <div className={cn('titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3', embedded ? 'px-3 pb-3' : 'px-8 pb-4')}>
        {/* 全屏能力中心保留总览切换；右侧组件由顶栏独占一个能力域。 */}
        {!embedded && <div className="relative flex h-8 items-stretch rounded-xl bg-muted p-0.5">
          <div
            className={cn(
              'absolute bottom-0.5 top-0.5 w-[calc(33.333%-3px)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out',
              tab === 'skills' && 'translate-x-0',
              tab === 'mcp' && 'translate-x-full',
              tab === 'memory' && 'translate-x-[200%]',
            )}
          />
          {([
            { value: 'skills' as const, label: 'Skills', count: data.skills.length },
            { value: 'mcp' as const, label: 'MCP', count: mcpCount },
            { value: 'memory' as const, label: '记忆', count: memoryCount },
          ]).map(({ value, label, count }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'relative z-[1] flex min-w-[96px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors duration-200',
                tab === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>}

        {/* 搜索框 */}
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
          <Search size={14} className="shrink-0 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'skills' ? '搜索 Skills...' : tab === 'mcp' ? '搜索 MCP 服务器...' : '搜索记忆文件...'}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
          />
        </div>

        {/* 社区市场（占位） */}
        {tab === 'skills' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 text-[13px] font-medium text-foreground/35"
              >
                <Store size={14} />
                <span>社区市场</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">即将上线：一键浏览、安装与更新社区 Skills</TooltipContent>
          </Tooltip>
        )}

        {/* Skills：从其他工作区导入 */}
        {tab === 'skills' && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleClassifySkills()}
                  disabled={classifyingSkills || data.skills.length === 0}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {classifyingSkills ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  <span>AI 分类</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">创建 Agent 会话，读取 SKILL.md 内容并补全 group</TooltipContent>
            </Tooltip>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04]"
            >
              <Plus size={14} />
              <span>导入</span>
            </button>
          </>
        )}

        {/* 新增 MCP */}
        {tab === 'mcp' && (
          <button
            type="button"
            onClick={() => void guideManualMcp()}
            disabled={guidingManualMcp}
            title="创建 Agent 会话协助配置 MCP"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {guidingManualMcp ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            <span>添加服务器</span>
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className={cn('mx-auto w-full max-w-6xl', embedded ? 'px-3 pb-4' : 'px-8 pb-10')}>
          {data.loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
          ) : tab === 'skills' ? (
            <SkillsTab
              customSkills={customSkills}
              builtinSkills={builtinSkills}
              embedded={embedded}
              total={data.skills.length}
              updateCount={updateCount}
              updatingSkill={data.updatingSkill}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={selectSkill}
              onToggle={data.toggleSkill}
              onUpdate={data.updateSkill}
            />
          ) : tab === 'mcp' ? (
            <McpTab
              userEntries={userMcpEntries}
              catalogMcps={catalogMcps}
              catalogClis={catalogClis}
              catalogGuided={catalogGuided}
              catalogCredentials={catalogCredentials}
              embedded={embedded}
              installedMcpNames={new Set(Object.keys(data.mcpConfig.servers ?? {}))}
              enabledMcpNames={new Set(Object.entries(data.mcpConfig.servers ?? {}).filter(([, entry]) => entry.enabled === true).map(([name]) => name))}
              // 后台复检期间保留上一次成功的握手证据；只有刷新返回新的失败结果时才降级状态。
              verifiedMcpNames={new Set(Object.entries(data.mcpConfig.servers ?? {}).filter(([, entry]) => entry.lastTestResult?.success).map(([name]) => name))}
              // getWorkspaceSkills() 仅返回当前工作区 skills/ 下的 active Skill；不让
              // 其他工作区或 inactive Skill 误把目录卡标为可用。
              activeSkillSlugs={new Set(data.skills.filter((skill) => skill.enabled).map((skill) => skill.slug))}
              connectedCliIds={new Set(data.cliIntegrationStatuses.filter((status) => status.connected && status.enabled).map((status) => status.id))}
              cliIntegrationProbeState={data.cliIntegrationProbeState}
              installingCatalogMcpId={installingCatalogMcpId}
              onOpen={(name) => setSelectedMcpName(name)}
              onToggle={data.toggleMcp}
              onRequestDelete={setPendingDeleteMcpName}
              onInstallCatalogMcp={(integration) => { void installCatalogMcp(integration) }}
              onGuideCatalogCli={guideCatalogCli}
              onDisconnectCatalogCli={(integration) => { void disconnectCatalogCli(integration) }}
              onGuideCatalogIntegration={(integration) => { void guideCatalogIntegration(integration) }}
              onRequestCredential={setPendingCredentialIntegration}
            />
          ) : (
            <WorkspaceMemoryTab workspaceSlug={data.workspaceSlug} search={search} />
          )}
        </div>
      </div>

      {skillDeleteDialog}

      {/* MCP 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteMcpName !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteMcpName(null) }}
        title={`确认删除 MCP 服务器「${pendingDeleteMcpName}」？`}
        description="删除后将无法恢复，确定要删除这个 MCP 服务器吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingMcp}
        onConfirm={async () => {
          if (!pendingDeleteMcpName || isDeletingMcp) return
          setIsDeletingMcp(true)
          await data.deleteMcp(pendingDeleteMcpName)
          setIsDeletingMcp(false)
          setPendingDeleteMcpName(null)
        }}
      />

      <CredentialDialog
        integration={pendingCredentialIntegration}
        onOpenChange={(open) => { if (!open) setPendingCredentialIntegration(null) }}
        onSave={connectCredentialIntegration}
      />

      <ImportSkillDialog
        open={showImport}
        onOpenChange={setShowImport}
        workspaceSlug={data.workspaceSlug}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />
    </div>
  )
}

// ===== Skills Tab =====

interface SkillsTabProps {
  customSkills: SkillMeta[]
  builtinSkills: SkillMeta[]
  embedded: boolean
  total: number
  updateCount: number
  updatingSkill: string | null
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillsTab({
  customSkills,
  builtinSkills,
  embedded,
  total,
  updateCount,
  updatingSkill,
  isBuiltin,
  onOpen,
  onToggle,
  onUpdate,
}: SkillsTabProps): React.ReactElement {
  if (total === 0) {
    return <EmptyState icon={<Blocks className="size-8 text-foreground/30" />} title="暂无 Skill" hint="可以在 Agent 模式下让 Proma 帮你联网查找并安装 Skill，或从其他项目导入。" />
  }
  if (customSkills.length === 0 && builtinSkills.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 Skill" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {updateCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[13px] text-blue-600 dark:text-blue-400">
          有 {updateCount} 个 Skill 可更新到来源最新版本
        </div>
      )}
      {customSkills.length > 0 && (
        <SkillSection title="我的 Skills" skills={customSkills} embedded={embedded} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
      {builtinSkills.length > 0 && (
        <SkillSection title="PROMA 内置" skills={builtinSkills} embedded={embedded} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
    </div>
  )
}

interface SkillSectionProps {
  title: string
  skills: SkillMeta[]
  embedded: boolean
  isBuiltin: (slug: string) => boolean
  updatingSkill: string | null
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillSection({ title, skills, embedded, isBuiltin, updatingSkill, onOpen, onToggle, onUpdate }: SkillSectionProps): React.ReactElement {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
  const groups = React.useMemo(() => groupSkills(skills), [skills])

  const toggleGroup = React.useCallback((groupId: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{skills.length}</span>
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.id)
          return (
            <div key={group.id} className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex h-8 items-center gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <ChevronRight size={14} className={cn('text-foreground/35 transition-transform', !collapsed && 'rotate-90')} />
                <span>{group.title}</span>
                <span className="text-[12px] tabular-nums text-foreground/35">{group.skills.length}</span>
              </button>
              {!collapsed && (
                <div className={cn('grid gap-3', embedded ? 'skills-embedded-card-grid' : 'sm:grid-cols-2 lg:grid-cols-3')}>
                  {group.skills.map((skill) => (
                    <SkillCard
                      key={skill.slug}
                      skill={skill}
                      isBuiltin={isBuiltin(skill.slug)}
                      updating={updatingSkill === skill.slug}
                      onOpen={() => onOpen(skill.slug)}
                      onToggle={(enabled) => onToggle(skill.slug, enabled)}
                      onUpdate={() => onUpdate(skill.slug)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== MCP Tab =====

interface McpTabProps {
  userEntries: Array<[string, McpServerEntry]>
  catalogMcps: CatalogMcpIntegration[]
  catalogClis: CatalogCliIntegration[]
  catalogGuided: CatalogGuidedIntegration[]
  catalogCredentials: CatalogCredentialIntegration[]
  embedded: boolean
  installedMcpNames: Set<string>
  enabledMcpNames: Set<string>
  verifiedMcpNames: Set<string>
  activeSkillSlugs: Set<string>
  connectedCliIds: Set<string>
  cliIntegrationProbeState: CatalogCliProbeState
  installingCatalogMcpId: string | null
  onOpen: (name: string, entry: McpServerEntry) => void
  onToggle: (name: string, enabled: boolean) => void
  onRequestDelete: (name: string) => void
  onInstallCatalogMcp: (integration: CatalogMcpIntegration) => void
  onGuideCatalogCli: (integration: CatalogCliIntegration) => void
  onDisconnectCatalogCli: (integration: CatalogCliIntegration) => void
  onGuideCatalogIntegration: (integration: CatalogGuidedIntegration) => void
  onRequestCredential: (integration: CatalogCredentialIntegration) => void
}

function McpTab({ userEntries, catalogMcps, catalogClis, catalogGuided, catalogCredentials, embedded, installedMcpNames, enabledMcpNames, verifiedMcpNames, activeSkillSlugs, connectedCliIds, cliIntegrationProbeState, installingCatalogMcpId, onOpen, onToggle, onRequestDelete, onInstallCatalogMcp, onGuideCatalogCli, onDisconnectCatalogCli, onGuideCatalogIntegration, onRequestCredential }: McpTabProps): React.ReactElement {
  if (userEntries.length === 0 && catalogMcps.length === 0 && catalogClis.length === 0 && catalogGuided.length === 0 && catalogCredentials.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 MCP 服务器" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {userEntries.length > 0 && (
        <McpSection title="我的 MCP" count={userEntries.length} embedded={embedded}>
          {userEntries.map(([name, entry]) => (
            <McpCard
              key={name}
              name={name}
              entry={entry}
              onOpen={() => onOpen(name, entry)}
              onToggle={(enabled) => onToggle(name, enabled)}
              onRequestDelete={() => onRequestDelete(name)}
              statusLabel={entry.enabled ? '已启用' : '已关闭'}
              statusTone={entry.enabled ? 'success' : 'muted'}
            />
          ))}
        </McpSection>
      )}

      <IntegrationCatalog
        mcps={catalogMcps}
        clis={catalogClis}
        guided={catalogGuided}
        credentials={catalogCredentials}
        embedded={embedded}
        installedMcpNames={installedMcpNames}
        enabledMcpNames={enabledMcpNames}
        verifiedMcpNames={verifiedMcpNames}
        activeSkillSlugs={activeSkillSlugs}
        connectedCliIds={connectedCliIds}
        cliIntegrationProbeState={cliIntegrationProbeState}
        installingMcpId={installingCatalogMcpId}
        onInstallMcp={onInstallCatalogMcp}
        onGuideCli={onGuideCatalogCli}
        onDisconnectCli={onDisconnectCatalogCli}
        onGuide={onGuideCatalogIntegration}
        onRequestCredential={onRequestCredential}
        onToggleMcp={onToggle}
      />
    </div>
  )
}

function McpSection({ title, count, children, embedded }: { title: string; count: number; children: React.ReactNode; embedded: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {embedded && <style>{embeddedMcpSectionContainerQuery}</style>}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{count}</span>
      </div>
      <div className={cn('grid grid-cols-1 gap-4', embedded ? 'mcp-section-grid' : 'md:grid-cols-2')}>
        {children}
      </div>
    </div>
  )
}

// ===== Empty State =====

function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">{title}</div>
        <div className="text-[13px] leading-relaxed text-foreground/50">{hint}</div>
      </div>
      {action}
    </div>
  )
}
