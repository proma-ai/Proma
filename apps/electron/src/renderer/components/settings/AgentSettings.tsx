/**
 * AgentSettings - Agent 设置页
 *
 * 包含两个区块：
 * 1. MCP 服务器 — 管理当前工作区的 MCP 服务器配置
 * 2. Skills — 只读展示当前工作区的 Skill 列表
 *
 * 视图模式：list / create / edit（复用 ChannelSettings 的模式）
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus, Plug, Pencil, Trash2, Sparkles, FolderOpen, MessageSquare, ShieldCheck, ChevronDown, ChevronRight, Brain, ImagePlus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentPendingPromptAtom,
  workspaceCapabilitiesVersionAtom,
  agentThinkingAtom,
  agentEffortAtom,
  agentMaxBudgetUsdAtom,
  agentMaxTurnsAtom,
} from '@/atoms/agent-atoms'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import { appModeAtom } from '@/atoms/app-mode'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import type { McpServerEntry, SkillMeta, WorkspaceMcpConfig, ThinkingConfig, AgentEffort } from '@proma/shared'
import { SettingsSection, SettingsCard, SettingsRow, SettingsSegmentedControl, SettingsInput } from './primitives'
import { McpServerForm } from './McpServerForm'

/** 组件视图模式 */
type ViewMode = 'list' | 'create' | 'edit'

/** 编辑中的服务器信息 */
interface EditingServer {
  name: string
  entry: McpServerEntry
}

export function AgentSettings(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  // 派生当前工作区 slug
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  // 视图模式
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingServer, setEditingServer] = React.useState<EditingServer | null>(null)

  // MCP 配置
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [skillsDir, setSkillsDir] = React.useState('')
  const [loading, setLoading] = React.useState(true)

  /** 加载 MCP 配置和 Skills */
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

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // 无工作区时提示
  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FolderOpen size={48} className="text-muted-foreground/50 mb-4" />
        <p className="text-sm text-muted-foreground">
          请先在 Agent 模式下选择或创建一个工作区
        </p>
      </div>
    )
  }

  /** 构建 MCP 配置提示词 */
  const buildMcpPrompt = (): string => {
    const configPath = `~/.proma/agent-workspaces/${workspaceSlug}/mcp.json`
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

  /** 构建 Skill 配置提示词 */
  const buildSkillPrompt = (): string => {
    const skillsDir = `~/.proma/agent-workspaces/${workspaceSlug}/skills/`
    const skillList = skills.length > 0
      ? skills.map((s) => `- ${s.name}: ${s.description ?? '无描述'}`).join('\n')
      : '暂无 Skill'

    return `请帮我配置当前工作区的 Skills，你要主动来帮我实，现你可以采用联网搜索深度研究来尝试，当前环境已经有 Claude Agent SDK 了，除非不确定的时候才来问我，否则默认将帮我完成安装，而不是指导我。

## 工作区信息
- 工作区: ${currentWorkspace.name}
- Skills 目录: ${skillsDir}

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

  /** 通过 Agent 对话完成配置 */
  const handleConfigViaChat = async (promptMessage: string): Promise<void> => {
    if (!agentChannelId) {
      alert('请先在渠道设置中选择 Agent 供应商')
      return
    }

    try {
      // 创建新会话
      const session = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId,
        currentWorkspaceId ?? undefined,
      )

      // 刷新会话列表
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)

      // 设置当前会话
      setCurrentSessionId(session.id)

      // 设置 pending prompt
      setPendingPrompt({ sessionId: session.id, message: promptMessage })

      // 跳转到 Agent 对话视图
      setAppMode('agent')
      setSettingsOpen(false)
    } catch (error) {
      console.error('[Agent 设置] 创建配置会话失败:', error)
    }
  }

  /** 删除 MCP 服务器 */
  const handleDelete = async (serverName: string): Promise<void> => {
    // 内置 MCP 不可删除
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

  /** 切换 MCP 服务器启用状态 */
  const handleToggle = async (serverName: string): Promise<void> => {
    try {
      const entry = mcpConfig.servers[serverName]
      if (!entry) return

      const newConfig: WorkspaceMcpConfig = {
        servers: {
          ...mcpConfig.servers,
          [serverName]: { ...entry, enabled: !entry.enabled },
        },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 切换 MCP 服务器状态失败:', error)
    }
  }

  /** 删除 Skill */
  const handleDeleteSkill = async (skillSlug: string, skillName: string): Promise<void> => {
    if (!confirm(`确定删除 Skill「${skillName}」？此操作不可恢复。`)) return

    try {
      await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, skillSlug)
      setSkills((prev) => prev.filter((s) => s.slug !== skillSlug))
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 删除 Skill 失败:', error)
    }
  }

  /** 切换 Skill 启用/禁用 */
  const handleToggleSkill = async (skillSlug: string, enabled: boolean): Promise<void> => {
    try {
      await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
      setSkills((prev) => prev.map((s) => s.slug === skillSlug ? { ...s, enabled } : s))
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 设置] 切换 Skill 状态失败:', error)
    }
  }

  /** 表单保存回调 */
  const handleFormSaved = (): void => {
    setViewMode('list')
    setEditingServer(null)
    loadData()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingServer(null)
  }

  // 表单视图
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
    ([name]) => name !== 'memos-cloud', // 记忆功能已迁移到独立配置，隐藏旧 MCP 条目
  )

  // 列表视图
  return (
    <div className="space-y-8">
      {/* 区块零：Agent 高级设置 */}
      <AgentAdvancedSettings />

      {/* 区块零点五：内置工具状态 */}
      <BuiltinAgentTools />

      {/* 区块一：MCP 服务器 */}
      <SettingsSection
        title="MCP 服务器"
        description={`当前工作区: ${currentWorkspace.name}`}
        action={
          <Button size="sm" onClick={() => setViewMode('create')}>
            <Plus size={16} />
            <span>添加服务器</span>
          </Button>
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
                onEdit={() => {
                  setEditingServer({ name, entry })
                  setViewMode('edit')
                }}
                onDelete={() => handleDelete(name)}
                onToggle={() => handleToggle(name)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <Button
        size="sm"
        className="w-full"
        onClick={() => handleConfigViaChat(buildMcpPrompt())}
      >
        <MessageSquare size={14} />
        <span>跟 Proma Agent 对话完成配置</span>
      </Button>

      {/* 区块二：Skills（只读） */}
      <SettingsSection
        title="Skills"
        description="将 SKILL.md 放入工作区 skills/ 目录即可被 Agent 自动发现"
        action={skillsDir ? (
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
        ) : undefined}
      >
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : skills.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-8 text-center">
              暂无 Skill
            </div>
          </SettingsCard>
        ) : (
          <SkillGroupedList
            skills={skills}
            skillsDir={skillsDir}
            onDelete={handleDeleteSkill}
            onToggle={handleToggleSkill}
          />
        )}

        <Button
          size="sm"
          className="w-full"
          onClick={() => handleConfigViaChat(buildSkillPrompt())}
        >
          <MessageSquare size={14} />
          <span>跟 Proma Agent 对话完成配置</span>
        </Button>
      </SettingsSection>
    </div>
  )
}

// ===== MCP 服务器行子组件 =====

/** 传输类型显示标签 */
const TRANSPORT_LABELS: Record<string, string> = {
  stdio: 'stdio',
  http: 'HTTP',
  sse: 'SSE',
}

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
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
          title="编辑"
        >
          <Pencil size={14} />
        </button>
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        )}
        <Switch
          checked={entry.enabled}
          onCheckedChange={onToggle}
        />
      </div>
    </SettingsRow>
  )
}

// ===== Skills 分组列表子组件 =====

/** 分组结果 */
interface SkillGroup {
  prefix: string
  skills: SkillMeta[]
}

/** 按前缀对 Skills 分组 */
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

  // 独立 skill 合为一个无前缀组
  if (standalone.length > 0) {
    groups.push({ prefix: '', skills: standalone })
  }

  return groups
}

/** 从 slug 中移除前缀得到短名称 */
function shortName(slug: string, prefix: string): string {
  if (!prefix) return slug
  return slug.startsWith(prefix + '-') ? slug.slice(prefix.length + 1) : slug
}

interface SkillGroupedListProps {
  skills: SkillMeta[]
  skillsDir: string
  onDelete: (slug: string, name: string) => void
  onToggle: (slug: string, enabled: boolean) => void
}

function SkillGroupedList({ skills, skillsDir, onDelete, onToggle }: SkillGroupedListProps): React.ReactElement {
  const groups = React.useMemo(() => groupSkillsByPrefix(skills), [skills])
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(new Set())
  const [expandedSkill, setExpandedSkill] = React.useState<string | null>(null)

  const toggleGroup = (prefix: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }

  const openSkillFolder = (slug: string) => {
    if (skillsDir) {
      window.electronAPI.openFile(`${skillsDir}/${slug}`)
    }
  }

  return (
    <div className="space-y-2 min-w-0">
      {groups.map((group) =>
        group.prefix ? (
          <SkillGroupCard
            key={group.prefix}
            group={group}
            expanded={expandedGroups.has(group.prefix)}
            expandedSkill={expandedSkill}
            onToggle={() => toggleGroup(group.prefix)}
            onExpandSkill={(slug) => setExpandedSkill(expandedSkill === slug ? null : slug)}
            onDelete={onDelete}
            onToggleEnabled={onToggle}
            onOpenFolder={openSkillFolder}
          />
        ) : (
          /* 独立 skill 不分组，平铺展示 */
          <SettingsCard key="__standalone__">
            {group.skills.map((skill) => (
              <SkillItemRow
                key={skill.slug}
                skill={skill}
                displayName={skill.name}
                expanded={expandedSkill === skill.slug}
                onToggleExpand={() => setExpandedSkill(expandedSkill === skill.slug ? null : skill.slug)}
                onDelete={() => onDelete(skill.slug, skill.name)}
                onToggleEnabled={(enabled) => onToggle(skill.slug, enabled)}
                onOpenFolder={() => openSkillFolder(skill.slug)}
              />
            ))}
          </SettingsCard>
        )
      )}
    </div>
  )
}

interface SkillGroupCardProps {
  group: SkillGroup
  expanded: boolean
  expandedSkill: string | null
  onToggle: () => void
  onExpandSkill: (slug: string) => void
  onDelete: (slug: string, name: string) => void
  onToggleEnabled: (slug: string, enabled: boolean) => void
  onOpenFolder: (slug: string) => void
}

function SkillGroupCard({ group, expanded, expandedSkill, onToggle, onExpandSkill, onDelete, onToggleEnabled, onOpenFolder }: SkillGroupCardProps): React.ReactElement {
  return (
    <SettingsCard divided={false}>
      {/* 分组头部 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors min-w-0"
      >
        {expanded
          ? <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
          : <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
        }
        <Sparkles size={16} className="text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{group.prefix}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium tabular-nums flex-shrink-0">
          {group.skills.length}
        </span>
      </button>

      {/* 展开的子项 */}
      {expanded && (
        <div className="overflow-hidden">
          {group.skills.map((skill) => (
            <SkillItemRow
              key={skill.slug}
              skill={skill}
              displayName={shortName(skill.slug, group.prefix)}
              expanded={expandedSkill === skill.slug}
              onToggleExpand={() => onExpandSkill(skill.slug)}
              onDelete={() => onDelete(skill.slug, skill.name)}
              onToggleEnabled={(enabled) => onToggleEnabled(skill.slug, enabled)}
              onOpenFolder={() => onOpenFolder(skill.slug)}
              indent
            />
          ))}
        </div>
      )}
    </SettingsCard>
  )
}

interface SkillItemRowProps {
  skill: SkillMeta
  displayName: string
  expanded: boolean
  onToggleExpand: () => void
  onDelete: () => void
  onToggleEnabled: (enabled: boolean) => void
  onOpenFolder: () => void
  indent?: boolean
}

function SkillItemRow({ skill, displayName, expanded, onToggleExpand, onDelete, onToggleEnabled, onOpenFolder, indent }: SkillItemRowProps): React.ReactElement {
  return (
    <div className={cn('group border-t border-border/50 overflow-hidden', !skill.enabled && 'opacity-50')}>
      <div className={cn('flex items-center gap-2 px-4 py-2', indent && 'pl-8')}>
        {indent && <Sparkles size={14} className="text-amber-400/60 flex-shrink-0" />}
        {!indent && <Sparkles size={16} className="text-amber-500 flex-shrink-0" />}

        {/* 名称 + 可展开描述 */}
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left overflow-hidden"
        >
          <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
          {expanded && skill.description && (
            <div className="text-xs text-muted-foreground mt-1 break-words">
              {skill.description}
            </div>
          )}
          {!expanded && skill.description && (
            <div className="text-xs text-muted-foreground truncate">{skill.description}</div>
          )}
        </button>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenFolder}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
              >
                <FolderOpen size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>打开文件夹</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>删除</TooltipContent>
          </Tooltip>
          <Switch
            checked={skill.enabled}
            onCheckedChange={onToggleEnabled}
          />
        </div>
      </div>
    </div>
  )
}

// ===== Agent 高级设置子组件 =====

/** 思考模式选项 */
const THINKING_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'adaptive', label: '自适应' },
  { value: 'disabled', label: '关闭' },
]

/** 推理深度选项 */
const EFFORT_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最大' },
]

/** 从 ThinkingConfig 转为 UI 字符串 */
function thinkingToValue(config: ThinkingConfig | undefined): string {
  if (!config) return 'default'
  return config.type === 'adaptive' ? 'adaptive' : config.type === 'disabled' ? 'disabled' : 'default'
}

/** 从 UI 字符串转为 ThinkingConfig（'default' 返回 undefined） */
function valueToThinking(value: string): ThinkingConfig | undefined {
  if (value === 'adaptive') return { type: 'adaptive' }
  if (value === 'disabled') return { type: 'disabled' }
  return undefined
}

/** 从 AgentEffort 转为 UI 字符串 */
function effortToValue(effort: AgentEffort | undefined): string {
  return effort ?? 'default'
}

/** 从 UI 字符串转为 AgentEffort（'default' 返回 undefined） */
function valueToEffort(value: string): AgentEffort | undefined {
  if (value === 'default') return undefined
  return value as AgentEffort
}

/** 内置 Agent 工具状态展示 */
function BuiltinAgentTools(): React.ReactElement {
  const tools = useAtomValue(chatToolsAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)

  const memoryTool = tools.find((t) => t.meta.id === 'memory')
  const nanoBananaTool = tools.find((t) => t.meta.id === 'nano-banana')

  /** 跳转到工具设置页 */
  const goToToolSettings = (): void => {
    setSettingsTab('tools')
  }

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
  ]

  return (
    <SettingsSection
      title="内置工具"
      description="启用后自动注入到 Agent 会话，在工具设置中配置"
      action={
        <Button size="sm" variant="outline" onClick={goToToolSettings}>
          <Settings size={14} />
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
                <span className={cn('shrink-0', !isActive && 'opacity-40')}>
                  {tool.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-medium', !isActive && 'text-muted-foreground')}>
                      {tool.name}
                    </span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full',
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground',
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

function AgentAdvancedSettings(): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(true)

  const thinking = useAtomValue(agentThinkingAtom)
  const setThinking = useSetAtom(agentThinkingAtom)
  const effort = useAtomValue(agentEffortAtom)
  const setEffort = useSetAtom(agentEffortAtom)
  const maxBudget = useAtomValue(agentMaxBudgetUsdAtom)
  const setMaxBudget = useSetAtom(agentMaxBudgetUsdAtom)
  const maxTurns = useAtomValue(agentMaxTurnsAtom)
  const setMaxTurns = useSetAtom(agentMaxTurnsAtom)

  // 数字输入使用字符串状态，失焦时持久化
  const [budgetStr, setBudgetStr] = React.useState(maxBudget != null ? String(maxBudget) : '')
  const [turnsStr, setTurnsStr] = React.useState(maxTurns != null ? String(maxTurns) : '')

  // 同步外部变化（如初始化加载）
  React.useEffect(() => {
    setBudgetStr(maxBudget != null ? String(maxBudget) : '')
  }, [maxBudget])
  React.useEffect(() => {
    setTurnsStr(maxTurns != null ? String(maxTurns) : '')
  }, [maxTurns])

  const handleThinkingChange = (value: string): void => {
    const config = valueToThinking(value)
    setThinking(config)
    window.electronAPI.updateSettings({ agentThinking: config })
  }

  const handleEffortChange = (value: string): void => {
    const effortValue = valueToEffort(value)
    setEffort(effortValue)
    window.electronAPI.updateSettings({ agentEffort: effortValue })
  }

  const handleBudgetBlur = (): void => {
    const num = parseFloat(budgetStr)
    const value = !isNaN(num) && num > 0 ? num : undefined
    setMaxBudget(value)
    window.electronAPI.updateSettings({ agentMaxBudgetUsd: value })
  }

  const handleTurnsBlur = (): void => {
    const num = parseInt(turnsStr, 10)
    const value = !isNaN(num) && num > 0 ? num : undefined
    setMaxTurns(value)
    window.electronAPI.updateSettings({ agentMaxTurns: value })
  }

  return (
    <SettingsSection
      title={
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 hover:text-foreground/80 transition-colors"
        >
          {collapsed
            ? <ChevronRight size={16} className="text-muted-foreground" />
            : <ChevronDown size={16} className="text-muted-foreground" />
          }
          <span>Agent 高级设置</span>
        </button>
      }
      description={collapsed ? undefined : '控制 Agent 的思考模式、推理深度和资源限制'}
    >
      {!collapsed && (
        <SettingsCard>
          <SettingsSegmentedControl
            label="思考模式"
            description="自适应模式下 Agent 会根据任务复杂度自动决定是否启用深度思考"
            value={thinkingToValue(thinking)}
            onValueChange={handleThinkingChange}
            options={THINKING_OPTIONS}
          />
          <SettingsSegmentedControl
            label="推理深度"
            description="控制 Agent 在每次回复中投入的推理计算量"
            value={effortToValue(effort)}
            onValueChange={handleEffortChange}
            options={EFFORT_OPTIONS}
          />
          <SettingsInput
            label="预算限制（美元/次）"
            description="单次 Agent 会话的最大花费，留空则不限制"
            value={budgetStr}
            onChange={setBudgetStr}
            onBlur={handleBudgetBlur}
            placeholder="例如: 1.0"
            type="number"
          />
          <SettingsInput
            label="最大轮次"
            description="单次 Agent 会话的最大交互轮次，留空则使用 SDK 默认值"
            value={turnsStr}
            onChange={setTurnsStr}
            onBlur={handleTurnsBlur}
            placeholder="例如: 30"
            type="number"
          />
        </SettingsCard>
      )}
    </SettingsSection>
  )
}
