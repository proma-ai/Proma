/**
 * AgentSettings - Agent 设置页
 *
 * Tab 布局：
 * 1. Skills — Master-Detail 视图（左列列表 + 右列详情 + 内联编辑）
 * 2. MCP 服务器 — 管理当前工作区的 MCP 服务器配置
 * 3. 内置工具 — 只读展示内置工具状态
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus, Plug, Pencil, Trash2, Sparkles, FolderOpen, MessageSquare, ShieldCheck, ChevronDown, ChevronRight, Brain, ImagePlus, Search, RefreshCw, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  agentChannelIdAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentPendingPromptAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import { appModeAtom } from '@/atoms/app-mode'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import type { McpServerEntry, SkillMeta, OtherWorkspaceSkillsGroup, WorkspaceMcpConfig } from '@proma/shared'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import { McpServerForm } from './McpServerForm'

// ===== Types =====

type ViewMode = 'list' | 'create' | 'edit'

interface EditingServer {
  name: string
  entry: McpServerEntry
}

interface SkillGroup {
  prefix: string
  skills: SkillMeta[]
}

// ===== Helpers =====

function groupSkillsByPrefix(skills: SkillMeta[]): SkillGroup[] {
  const prefixMap = new Map<string, SkillMeta[]>()

  for (const skill of skills) {
    const dashIdx = skill.slug.indexOf('-')
    const prefix = dashIdx > 0 ? skill.slug.slice(0, dashIdx) : ''
    const key = prefix || skill.slug
    const list = prefixMap.get(key) ?? []
    list.push(skill)
    prefixMap.set(key, list)
  }

  const groups: SkillGroup[] = []
  const standalone: SkillMeta[] = []

  for (const [prefix, list] of prefixMap) {
    if (list.length >= 2) {
      groups.push({ prefix, skills: list })
    } else {
      standalone.push(...list)
    }
  }

  if (standalone.length > 0) {
    groups.push({ prefix: '', skills: standalone })
  }

  return groups
}

function shortName(slug: string, prefix: string): string {
  if (!prefix) return slug
  return slug.startsWith(prefix + '-') ? slug.slice(prefix.length + 1) : slug
}

function extractSkillBody(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  return match?.[1] ?? content
}

function rebuildSkillMd(
  originalContent: string,
  updates: { name?: string; description?: string; body?: string },
): string {
  const fmMatch = originalContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return originalContent

  let fmBlock = fmMatch[1] ?? ''
  const currentBody = fmMatch[2] ?? ''

  if (updates.name !== undefined) {
    fmBlock = /^name:/m.test(fmBlock)
      ? fmBlock.replace(/^name:.*$/m, `name: ${updates.name}`)
      : `name: ${updates.name}\n${fmBlock}`
  }
  if (updates.description !== undefined) {
    fmBlock = /^description:/m.test(fmBlock)
      ? fmBlock.replace(/^description:.*$/m, `description: ${updates.description}`)
      : `${fmBlock}\ndescription: ${updates.description}`
  }

  const newBody = updates.body !== undefined ? updates.body : currentBody
  return `---\n${fmBlock}\n---\n${newBody}`
}

// ===== Main Component =====

export function AgentSettings(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  // Tab & view state
  const [activeTab, setActiveTab] = React.useState('skills')
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingServer, setEditingServer] = React.useState<EditingServer | null>(null)

  // Data
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [skillsDir, setSkillsDir] = React.useState('')
  const [otherWorkspaces, setOtherWorkspaces] = React.useState<OtherWorkspaceSkillsGroup[]>([])
  const [showImportDialog, setShowImportDialog] = React.useState(false)
  const [importingSkill, setImportingSkill] = React.useState<string | null>(null)
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [selectedSkillSlug, setSelectedSkillSlug] = React.useState<string | null>(null)

  const selectedSkill = skills.find((s) => s.slug === selectedSkillSlug) ?? null

  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setLoading(false)
      return
    }
    try {
      const [config, skillList, dir] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
      ])
      setMcpConfig(config)
      setSkills(skillList)
      setSkillsDir(dir)
    } catch (error) {
      console.error('[Agent 设置] 加载工作区配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  const loadOtherWorkspaces = React.useCallback(async () => {
    if (!workspaceSlug) return
    try {
      const groups = await window.electronAPI.getOtherWorkspaceSkills(workspaceSlug)
      setOtherWorkspaces(groups)
    } catch (error) {
      console.error('[Agent 设置] 加载其他工作区 Skill 失败:', error)
    }
  }, [workspaceSlug])

  React.useEffect(() => {
    if (showImportDialog) void loadOtherWorkspaces()
  }, [showImportDialog, loadOtherWorkspaces])

  React.useEffect(() => { loadData() }, [loadData])

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FolderOpen size={48} className="text-muted-foreground/50 mb-4" />
        <p className="text-sm text-muted-foreground">请先在 Agent 模式下选择或创建一个工作区</p>
      </div>
    )
  }

  const configDirName = import.meta.env.DEV ? '.proma-dev' : '.proma'

  const buildMcpPrompt = (): string => {
    const configPath = `~/${configDirName}/agent-workspaces/${workspaceSlug}/mcp.json`
    const currentConfig = JSON.stringify(mcpConfig, null, 2)
    return `请帮我配置当前工作区的 MCP 服务器，你要主动来帮我实现，你可以采用联网搜索深度研究来尝试，当前环境已经有 Claude Agent SDK 了，除非不确定的时候才来问我，否则默认将帮我完成安装，而不是指导我。

## 工作区信息
- 工作区: ${currentWorkspace.name}
- MCP 配置文件: ${configPath}

## 当前配置
\`\`\`json
${currentConfig}
\`\`\`

## 配置格式
mcp.json 格式如下：
\`\`\`json
{
  "servers": {
    "服务器名称": {
      "type": "stdio | http | sse",
      "command": "可执行命令",
      "args": ["参数1", "参数2"],
      "env": { "KEY": "VALUE" },
      "url": "http://...",
      "headers": { "Key": "Value" },
      "enabled": true
    }
  }
}
\`\`\`
其中 stdio 类型使用 command/args/env，http/sse 类型使用 url/headers。

请读取当前配置文件，根据我的需求添加或修改 MCP 服务器，然后写回文件。`
  }

  const buildSkillPrompt = (): string => {
    const skillsDirPath = `~/${configDirName}/agent-workspaces/${workspaceSlug}/skills/`
    const skillList = skills.length > 0
      ? skills.map((s) => `- ${s.name}: ${s.description ?? '无描述'}`).join('\n')
      : '暂无 Skill'
    return `请帮我配置当前工作区的 Skills，你要主动来帮我实现，你可以采用联网搜索深度研究来尝试，当前环境已经有 Claude Agent SDK 了，除非不确定的时候才来问我，否则默认将帮我完成安装，而不是指导我。

## 工作区信息
- 工作区: ${currentWorkspace.name}
- Skills 目录: ${skillsDirPath}

## Skill 格式
每个 Skill 是 skills/ 目录下的一个子目录，目录名即 slug。
目录内包含 SKILL.md 文件，格式：

\`\`\`markdown
---
name: Skill 显示名称
description: 简要描述
---

Skill 的详细指令内容...
\`\`\`

## 当前 Skills
${skillList}

请查看 skills/ 目录了解现有配置，根据我的需求创建或编辑 Skill。`
  }

  const handleConfigViaChat = async (promptMessage: string): Promise<void> => {
    if (!agentChannelId) {
      alert('请先在渠道设置中选择 Agent 供应商')
      return
    }
    try {
      const session = await window.electronAPI.createAgentSession(undefined, agentChannelId, currentWorkspaceId ?? undefined)
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
      setCurrentSessionId(session.id)
      setPendingPrompt({ sessionId: session.id, message: promptMessage })
      setAppMode('agent')
      setSettingsOpen(false)
    } catch (error) {
      console.error('[Agent 设置] 创建配置会话失败:', error)
    }
  }

  // MCP handlers
  const handleDeleteMcp = async (serverName: string): Promise<void> => {
    const entry = mcpConfig.servers[serverName]
    if (entry?.isBuiltin) return
    if (!confirm(`确定删除 MCP 服务器「${serverName}」？此操作不可恢复。`)) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[serverName]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 删除 MCP 服务器失败:', error)
    }
  }

  const handleToggleMcp = async (serverName: string): Promise<void> => {
    try {
      const entry = mcpConfig.servers[serverName]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [serverName]: { ...entry, enabled: !entry.enabled } },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 切换 MCP 服务器状态失败:', error)
    }
  }

  // Skill handlers
  const handleDeleteSkill = async (skillSlug: string, skillName: string): Promise<void> => {
    if (!confirm(`确定删除 Skill「${skillName}」？此操作不可恢复。`)) return
    try {
      await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, skillSlug)
      setSkills((prev) => prev.filter((s) => s.slug !== skillSlug))
      if (selectedSkillSlug === skillSlug) setSelectedSkillSlug(null)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 删除 Skill 失败:', error)
    }
  }

  const handleToggleSkill = async (skillSlug: string, enabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
      setSkills((prev) => prev.map((s) => s.slug === skillSlug ? { ...s, enabled } : s))
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 切换 Skill 状态失败:', error)
    }
  }

  const handleImportSkill = async (sourceSlug: string, skillSlug: string): Promise<void> => {
    if (!workspaceSlug || importingSkill) return
    setImportingSkill(skillSlug)
    try {
      const imported = await window.electronAPI.importSkillFromWorkspace(workspaceSlug, sourceSlug, skillSlug)
      setSkills((prev) => prev.some((s) => s.slug === imported.slug) ? prev : [...prev, imported])
      bumpCapabilitiesVersion((v) => v + 1)
      setShowImportDialog(false)
      toast.success(`已导入 Skill: ${imported.name}`)
    } catch (error) {
      console.error('[Agent 设置] 导入 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('导入 Skill 失败', { description: message })
    } finally {
      setImportingSkill(null)
    }
  }

  const handleUpdateSkill = async (skillSlug: string): Promise<void> => {
    if (!workspaceSlug || updatingSkill) return
    setUpdatingSkill(skillSlug)
    try {
      const updated = await window.electronAPI.updateSkillFromSource(workspaceSlug, skillSlug)
      setSkills((prev) => prev.map((s) => s.slug === skillSlug ? updated : s))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已同步更新 Skill: ${updated.name}`)
    } catch (error) {
      console.error('[Agent 设置] 更新 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('更新 Skill 失败', { description: message })
    } finally {
      setUpdatingSkill(null)
    }
  }

  const handleSkillContentSaved = (): void => {
    loadData()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  const handleFormSaved = (): void => {
    setViewMode('list')
    setEditingServer(null)
    setActiveTab('mcp')
    loadData()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingServer(null)
    setActiveTab('mcp')
  }

  // MCP form early-return
  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <McpServerForm
        server={editingServer}
        workspaceSlug={workspaceSlug}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  const serverEntries = Object.entries(mcpConfig.servers ?? {}).filter(
    ([name]) => name !== 'memos-cloud',
  )

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="relative flex rounded-xl bg-muted p-1">
          <div
            className={cn(
              'mode-slider absolute top-1 bottom-1 w-[calc(33.333%-3px)] rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out',
              activeTab === 'skills' && 'translate-x-0',
              activeTab === 'mcp' && 'translate-x-[100%]',
              activeTab === 'tools' && 'translate-x-[200%]',
            )}
          />
          {[
            { value: 'skills', label: 'Skills' },
            { value: 'mcp', label: 'MCP' },
            { value: 'tools', label: '内置工具' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={cn(
                'relative z-[1] flex-1 flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200',
                activeTab === value
                  ? 'mode-btn-selected text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ===== Skills Tab ===== */}
        <TabsContent value="skills" className="mt-4 space-y-4">
          <SettingsSection
            title="Skills"
            description={`当前工作区: ${currentWorkspace.name}`}
            action={
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => handleConfigViaChat(buildSkillPrompt())}>
                      <MessageSquare size={14} />
                      <span>AI 配置</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    Proma Agent 内置 Skills Finder，你可以在 Agent 模式下要求 Proma 帮你联网查找某类 Skills 并安装到当前的工作区使用；也可以跟 Proma Agent 一起探讨，利用 Proma Agent 内置的 Skills Creator 来一起创建高质量可复用的 Skills 到当前的工作区
                  </TooltipContent>
                </Tooltip>
                <Button size="sm" variant="outline" onClick={() => setShowImportDialog(true)}>
                  <Plus size={16} />
                  <span>从其他工作区导入</span>
                </Button>
                {skillsDir && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => window.electronAPI.openFile(skillsDir)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <FolderOpen size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>打开 Skills 目录</TooltipContent>
                  </Tooltip>
                )}
              </div>
            }
          >
            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
            ) : skills.length === 0 ? (
              <SettingsCard divided={false}>
                <div className="text-sm text-muted-foreground py-8 text-center">暂无 Skill</div>
              </SettingsCard>
            ) : (
              <div className="flex border border-border rounded-lg overflow-hidden" style={{ minHeight: 420 }}>
                <SkillListPanel
                  skills={skills}
                  selectedSlug={selectedSkillSlug}
                  onSelect={setSelectedSkillSlug}
                  onDelete={handleDeleteSkill}
                  onToggle={handleToggleSkill}
                  onUpdate={handleUpdateSkill}
                  skillsDir={skillsDir}
                />
                <div className="flex-1 overflow-y-auto">
                  {selectedSkill ? (
                    <SkillDetailPanel
                      skill={selectedSkill}
                      workspaceSlug={workspaceSlug}
                      onSaved={handleSkillContentSaved}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      选择一个 Skill 查看详情
                    </div>
                  )}
                </div>
              </div>
            )}
          </SettingsSection>
        </TabsContent>

        {/* ===== MCP Tab ===== */}
        <TabsContent value="mcp" className="mt-4 space-y-4">
          <SettingsSection
            title="MCP 服务器"
            description={`当前工作区: ${currentWorkspace.name}`}
            action={
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => handleConfigViaChat(buildMcpPrompt())}>
                      <MessageSquare size={14} />
                      <span>AI 配置</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    Proma Agent 可以帮助你联网查找公开的 MCP 并配置到当前工作区，你可以在 Agent 模式下用自然语言表达你想要的 MCP 并要求安装到当前工作区即可；也可以跟 Proma Agent 一起探讨创建你的专属 MCP 到当前工作区
                  </TooltipContent>
                </Tooltip>
                <Button size="sm" variant="outline" onClick={() => { setActiveTab('mcp'); setViewMode('create') }}>
                  <Plus size={16} />
                  <span>添加服务器</span>
                </Button>
              </div>
            }
          >
            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
            ) : serverEntries.length === 0 ? (
              <SettingsCard divided={false}>
                <div className="text-sm text-muted-foreground py-12 text-center">
                  还没有配置任何 MCP 服务器，点击上方"添加服务器"开始
                </div>
              </SettingsCard>
            ) : (
              <SettingsCard>
                {serverEntries.map(([name, entry]) => (
                  <McpServerRow
                    key={name}
                    name={name}
                    entry={entry}
                    onEdit={() => { setEditingServer({ name, entry }); setViewMode('edit') }}
                    onDelete={() => handleDeleteMcp(name)}
                    onToggle={() => handleToggleMcp(name)}
                  />
                ))}
              </SettingsCard>
            )}
          </SettingsSection>
        </TabsContent>

        {/* ===== Built-in Tools Tab ===== */}
        <TabsContent value="tools" className="mt-4">
          <BuiltinAgentTools />
        </TabsContent>
      </Tabs>

      <ImportSkillFromWorkspaceDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        otherWorkspaces={otherWorkspaces}
        installedSkills={skills}
        importingSkill={importingSkill}
        onImport={handleImportSkill}
      />
    </div>
  )
}

// ===== MCP Server Row =====

const TRANSPORT_LABELS: Record<string, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE' }

interface McpServerRowProps {
  name: string
  entry: McpServerEntry
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function McpServerRow({ name, entry, onEdit, onDelete, onToggle }: McpServerRowProps): React.ReactElement {
  const isBuiltin = entry.isBuiltin === true
  return (
    <SettingsRow
      label={name}
      icon={<Plug size={18} className="text-blue-500" />}
      description={entry.type === 'stdio' ? entry.command : entry.url}
      className="group"
    >
      <div className="flex items-center gap-2">
        {isBuiltin && (
          <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
            <ShieldCheck size={12} />
            内置
          </span>
        )}
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
          {TRANSPORT_LABELS[entry.type] ?? entry.type}
        </span>
        <button onClick={onEdit} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100" title="编辑">
          <Pencil size={14} />
        </button>
        {!isBuiltin && (
          <button onClick={onDelete} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100" title="删除">
            <Trash2 size={14} />
          </button>
        )}
        <Switch checked={entry.enabled} onCheckedChange={onToggle} />
      </div>
    </SettingsRow>
  )
}

// ===== Skill List Panel (Left) =====

interface SkillListPanelProps {
  skills: SkillMeta[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  onDelete: (slug: string, name: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
  skillsDir: string
}

function SkillListPanel({ skills, selectedSlug, onSelect, onDelete, onToggle, onUpdate, skillsDir }: SkillListPanelProps): React.ReactElement {
  const groups = React.useMemo(() => groupSkillsByPrefix(skills), [skills])
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(() =>
    new Set(groups.filter((g) => g.prefix).map((g) => g.prefix)),
  )

  const toggleGroup = (prefix: string): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }

  const openSkillFolder = (slug: string): void => {
    if (skillsDir) window.electronAPI.openFile(`${skillsDir}/${slug}`)
  }

  return (
    <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto bg-muted/20">
      {groups.map((group) =>
        group.prefix ? (
          <div key={group.prefix}>
            <button
              onClick={() => toggleGroup(group.prefix)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
            >
              {expandedGroups.has(group.prefix)
                ? <ChevronDown size={12} className="text-muted-foreground flex-shrink-0" />
                : <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />}
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate flex-1">{group.prefix}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground flex-shrink-0">{group.skills.length}</span>
            </button>
            {expandedGroups.has(group.prefix) && group.skills.map((skill) => (
              <SkillCompactItem
                key={skill.slug}
                skill={skill}
                displayName={shortName(skill.slug, group.prefix)}
                selected={selectedSlug === skill.slug}
                onSelect={() => onSelect(skill.slug)}
                onDelete={() => onDelete(skill.slug, skill.name)}
                onToggle={(enabled) => onToggle(skill.slug, enabled)}
                onOpenFolder={() => openSkillFolder(skill.slug)}
                onUpdate={skill.hasUpdate ? () => onUpdate(skill.slug) : undefined}
              />
            ))}
          </div>
        ) : (
          group.skills.map((skill) => (
            <SkillCompactItem
              key={skill.slug}
              skill={skill}
              displayName={skill.name}
              selected={selectedSlug === skill.slug}
              onSelect={() => onSelect(skill.slug)}
              onDelete={() => onDelete(skill.slug, skill.name)}
              onToggle={(enabled) => onToggle(skill.slug, enabled)}
              onOpenFolder={() => openSkillFolder(skill.slug)}
              onUpdate={skill.hasUpdate ? () => onUpdate(skill.slug) : undefined}
            />
          ))
        ),
      )}
    </div>
  )
}

// ===== Skill Compact Item =====

interface SkillCompactItemProps {
  skill: SkillMeta
  displayName: string
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
  onOpenFolder: () => void
  onUpdate?: () => void
}

function SkillCompactItem({ skill, displayName, selected, onSelect, onDelete, onToggle, onOpenFolder, onUpdate }: SkillCompactItemProps): React.ReactElement {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'group w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/40',
        !skill.enabled && 'opacity-50',
      )}
    >
      <Sparkles size={14} className="text-amber-500 flex-shrink-0" />
      <span className="text-sm truncate flex-1 min-w-0">{displayName}</span>
      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {onUpdate && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onUpdate() }}
            className="p-1 rounded text-blue-500 hover:bg-blue-500/10 cursor-pointer"
          >
            <RefreshCw size={12} />
          </span>
        )}
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onOpenFolder() }}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
        >
          <FolderOpen size={12} />
        </span>
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
        >
          <Trash2 size={12} />
        </span>
      </div>
      <Switch
        checked={skill.enabled}
        onCheckedChange={(checked) => { onToggle(checked) }}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 scale-75"
      />
    </button>
  )
}

// ===== Skill Detail Panel (Right) =====

interface SkillDetailPanelProps {
  skill: SkillMeta
  workspaceSlug: string
  onSaved: () => void
}

function SkillDetailPanel({ skill, workspaceSlug, onSaved }: SkillDetailPanelProps): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [loadingContent, setLoadingContent] = React.useState(false)
  const currentSlugRef = React.useRef(skill.slug)

  const [isEditingMeta, setIsEditingMeta] = React.useState(false)
  const [isEditingBody, setIsEditingBody] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [editBody, setEditBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    currentSlugRef.current = skill.slug
    setIsEditingMeta(false)
    setIsEditingBody(false)
    setLoadingContent(true)

    window.electronAPI.readSkillContent(workspaceSlug, skill.slug)
      .then((text) => {
        if (currentSlugRef.current === skill.slug) setContent(text)
      })
      .catch((err) => {
        console.error('[SkillDetail] 加载内容失败:', err)
        if (currentSlugRef.current === skill.slug) setContent(null)
      })
      .finally(() => {
        if (currentSlugRef.current === skill.slug) setLoadingContent(false)
      })
  }, [skill.slug, workspaceSlug])

  const body = React.useMemo(() => extractSkillBody(content ?? ''), [content])

  const startEditMeta = (): void => {
    setEditName(skill.name)
    setEditDescription(skill.description ?? '')
    setIsEditingMeta(true)
  }

  const saveMeta = async (): Promise<void> => {
    if (!content) return
    setSaving(true)
    try {
      const newContent = rebuildSkillMd(content, { name: editName, description: editDescription })
      await window.electronAPI.writeSkillContent(workspaceSlug, skill.slug, newContent)
      setContent(newContent)
      setIsEditingMeta(false)
      onSaved()
      toast.success('元数据已保存')
    } catch (err) {
      console.error('[SkillDetail] 保存元数据失败:', err)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const startEditBody = (): void => {
    setEditBody(body)
    setIsEditingBody(true)
  }

  const saveBody = async (): Promise<void> => {
    if (!content) return
    setSaving(true)
    try {
      const newContent = rebuildSkillMd(content, { body: editBody })
      await window.electronAPI.writeSkillContent(workspaceSlug, skill.slug, newContent)
      setContent(newContent)
      setIsEditingBody(false)
      onSaved()
      toast.success('说明已保存')
    } catch (err) {
      console.error('[SkillDetail] 保存说明失败:', err)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loadingContent) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">加载中...</div>
  }

  const sourceLabel = skill.importSource
    ? `从 ${skill.importSource.sourceWorkspaceName} 导入`
    : '当前工作区'

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-amber-500/12 p-2.5 text-amber-500 shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{skill.name}</h3>
          {skill.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
          )}
        </div>
      </div>

      {/* Metadata Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">元数据</h4>
          {!isEditingMeta ? (
            <button onClick={startEditMeta} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <Pencil size={12} /> 编辑
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIsEditingMeta(false)} disabled={saving}>
                <X size={14} /> 取消
              </Button>
              <Button size="sm" onClick={() => void saveMeta()} disabled={saving}>
                <Save size={14} /> {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          )}
        </div>

        <SettingsCard divided>
          <MetadataRow label="标识符" value={skill.slug} />
          {isEditingMeta ? (
            <>
              <MetadataEditRow label="名称" value={editName} onChange={setEditName} />
              <MetadataEditRow label="描述" value={editDescription} onChange={setEditDescription} multiline />
            </>
          ) : (
            <>
              <MetadataRow label="名称" value={skill.name} />
              <MetadataRow label="描述" value={skill.description ?? '无描述'} />
            </>
          )}
          <MetadataRow label="数据源" value={sourceLabel} />
          <MetadataRow label="位置" value={`skills/${skill.slug}`} />
          {skill.version && <MetadataRow label="版本" value={skill.version} />}
        </SettingsCard>
      </div>

      {/* Body Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">说明</h4>
          {!isEditingBody ? (
            <button onClick={startEditBody} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <Pencil size={12} /> 编辑
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIsEditingBody(false)} disabled={saving}>
                <X size={14} /> 取消
              </Button>
              <Button size="sm" onClick={() => void saveBody()} disabled={saving}>
                <Save size={14} /> {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          )}
        </div>

        <SettingsCard divided={false}>
          <div className="p-4">
            {isEditingBody ? (
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="w-full min-h-[300px] bg-transparent text-sm font-mono resize-y border border-border rounded-md p-3 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="输入 Skill 说明内容（支持 Markdown）..."
              />
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>{body || '暂无说明内容'}</Markdown>
              </div>
            )}
          </div>
        </SettingsCard>
      </div>
    </div>
  )
}

// ===== Metadata Helpers =====

function MetadataRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <span className="text-xs text-muted-foreground w-16 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-foreground flex-1 min-w-0 break-words">{value}</span>
    </div>
  )
}

function MetadataEditRow({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }): React.ReactElement {
  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <span className="text-xs text-muted-foreground w-16 flex-shrink-0 pt-2">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 text-sm bg-transparent border border-border rounded-md px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 text-sm bg-transparent border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  )
}

// ===== Built-in Agent Tools =====

function BuiltinAgentTools(): React.ReactElement {
  const tools = useAtomValue(chatToolsAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const memoryTool = tools.find((t) => t.meta.id === 'memory')
  const nanoBananaTool = tools.find((t) => t.meta.id === 'nano-banana')
  const webSearchTool = tools.find((t) => t.meta.id === 'web-search')

  interface BuiltinToolItem {
    id: string
    name: string
    description: string
    icon: React.ReactElement
    enabled: boolean
    available: boolean
  }

  const builtinTools: BuiltinToolItem[] = [
    {
      id: 'memory',
      name: '记忆',
      description: '长期记忆存储与检索',
      icon: <Brain className="size-4" />,
      enabled: memoryTool?.enabled ?? false,
      available: memoryTool?.available ?? false,
    },
    {
      id: 'nano-banana',
      name: 'Nano Banana',
      description: 'AI 图片生成与编辑',
      icon: <ImagePlus className="size-4" />,
      enabled: nanoBananaTool?.enabled ?? false,
      available: nanoBananaTool?.available ?? false,
    },
    {
      id: 'web-search',
      name: '联网搜索',
      description: '实时搜索互联网获取最新信息',
      icon: <Search className="size-4" />,
      enabled: webSearchTool?.enabled ?? false,
      available: webSearchTool?.available ?? false,
    },
  ]

  return (
    <SettingsSection
      title="内置工具"
      description="启用后自动注入到 Agent 会话，在工具设置中配置"
      action={
        <Button size="sm" variant="outline" onClick={() => setSettingsTab('tools')}>
          <Pencil size={14} />
          <span>配置</span>
        </Button>
      }
    >
      <SettingsCard divided>
        {builtinTools.map((tool) => {
          const isActive = tool.enabled && tool.available
          return (
            <div key={tool.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn('shrink-0', !isActive && 'opacity-40')}>{tool.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-medium', !isActive && 'text-muted-foreground')}>{tool.name}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full',
                      isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                    )}>
                      {isActive ? '已启用' : !tool.available ? '需配置' : '未启用'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
                </div>
              </div>
            </div>
          )
        })}
      </SettingsCard>
    </SettingsSection>
  )
}

// ===== Import Skill Dialog =====

interface ImportSkillFromWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  otherWorkspaces: OtherWorkspaceSkillsGroup[]
  installedSkills: SkillMeta[]
  importingSkill: string | null
  onImport: (sourceSlug: string, skillSlug: string) => Promise<void>
}

function ImportSkillFromWorkspaceDialog({
  open,
  onOpenChange,
  otherWorkspaces,
  installedSkills,
  importingSkill,
  onImport,
}: ImportSkillFromWorkspaceDialogProps): React.ReactElement {
  const installedSlugs = React.useMemo(
    () => new Set(installedSkills.map((skill) => skill.slug)),
    [installedSkills],
  )

  const availableWorkspaces = React.useMemo(
    () =>
      otherWorkspaces
        .map((workspace) => ({
          ...workspace,
          skills: workspace.skills.filter((skill) => !installedSlugs.has(skill.slug)),
        }))
        .filter((workspace) => workspace.skills.length > 0),
    [otherWorkspaces, installedSlugs],
  )
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = React.useState('')

  const selectedWorkspace = React.useMemo(
    () => availableWorkspaces.find((workspace) => workspace.workspaceSlug === selectedWorkspaceSlug) ?? null,
    [availableWorkspaces, selectedWorkspaceSlug],
  )

  React.useEffect(() => {
    if (!open || availableWorkspaces.length === 0) {
      setSelectedWorkspaceSlug('')
      return
    }
    setSelectedWorkspaceSlug((current) =>
      availableWorkspaces.some((workspace) => workspace.workspaceSlug === current)
        ? current
        : availableWorkspaces[0]?.workspaceSlug ?? '',
    )
  }, [availableWorkspaces, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>从其他工作区导入 Skill</DialogTitle>
          <DialogDescription>
            从其他工作区中选择 Skill 导入到当前工作区。已安装的同名 Skill 会自动过滤。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-6 pb-6 max-h-[60vh]">
          {availableWorkspaces.length === 0 ? (
            <SettingsCard divided={false}>
              <div className="py-10 text-center text-sm text-muted-foreground">
                没有可导入的 Skill。其他工作区暂无 Skill，或者它们都已经安装到当前工作区了。
              </div>
            </SettingsCard>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">选择来源工作区</div>
                <Select value={selectedWorkspaceSlug} onValueChange={setSelectedWorkspaceSlug}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择来源工作区" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWorkspaces.map((workspace) => (
                      <SelectItem key={workspace.workspaceSlug} value={workspace.workspaceSlug}>
                        {workspace.workspaceName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(selectedWorkspace ? [selectedWorkspace] : []).map((workspace) => (
                <div key={workspace.workspaceSlug}>
                  <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span className="truncate">{workspace.workspaceName}</span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {workspace.skills.length} 个
                    </span>
                  </div>
                  <div className="pr-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {workspace.skills.map((skill) => (
                        <SettingsCard key={skill.slug} divided={false} className="overflow-hidden">
                          <div className="flex h-full flex-col gap-4 p-4">
                            <div className="flex items-start gap-3">
                              <div className="rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm">
                                <Sparkles size={18} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                                  {skill.version ? (
                                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                      v{skill.version}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">{skill.slug}</div>
                              </div>
                            </div>
                            <div className="line-clamp-3 min-h-[40px] text-sm leading-6 text-muted-foreground">
                              {skill.description ?? '暂无描述'}
                            </div>
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={() => void onImport(workspace.workspaceSlug, skill.slug)}
                              disabled={importingSkill !== null}
                            >
                              {importingSkill === skill.slug ? '导入中...' : '导入'}
                            </Button>
                          </div>
                        </SettingsCard>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
