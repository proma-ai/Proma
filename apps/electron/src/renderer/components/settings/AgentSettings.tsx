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
import { Plus, Plug, Pencil, Trash2, Sparkles, FolderOpen, MessageSquare, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentPendingPromptAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom } from '@/atoms/app-mode'
import type { McpServerEntry, SkillMeta, WorkspaceMcpConfig } from '@proma/shared'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
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
  const setActiveView = useSetAtom(activeViewAtom)
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
  const [loading, setLoading] = React.useState(true)

  /** 加载 MCP 配置和 Skills */
  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setLoading(false)
      return
    }

    try {
      const [config, skillList] = await Promise.all([
        window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
      ])
      setMcpConfig(config)
      setSkills(skillList)
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
      setActiveView('conversations')
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
          <SettingsCard>
            {skills.map((skill) => (
              <SettingsRow
                key={skill.slug}
                label={skill.name}
                icon={<Sparkles size={18} className="text-amber-500" />}
                description={skill.description ?? skill.slug}
                className="group"
              >
                <button
                  onClick={() => handleDeleteSkill(skill.slug, skill.name)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </SettingsRow>
            ))}
          </SettingsCard>
        )}
        <p className="text-xs text-muted-foreground px-1">
          路径: ~/.proma/agent-workspaces/{workspaceSlug}/skills/
        </p>

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
