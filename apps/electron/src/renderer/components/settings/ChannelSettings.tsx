/**
 * ChannelSettings - 渠道配置页
 *
 * 分为两个区块：
 * 1. 聊天渠道 — 所有渠道列表 + 添加/编辑/删除
 * 2. Agent 供应商 — Anthropic 渠道 + Proma 官方渠道，radio 选择默认 Agent 渠道
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Plus, Pencil, Trash2, Shield, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PROVIDER_LABELS, PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import type { Channel } from '@proma/shared'
import { getChannelLogo, PromaLogo } from '@/lib/model-logo'
import { agentChannelIdAtom, agentModelIdAtom } from '@/atoms/agent-atoms'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import { ChannelForm } from './ChannelForm'

/** 组件视图模式 */
type ViewMode = 'list' | 'create' | 'edit'

export function ChannelSettings(): React.ReactElement {
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingChannel, setEditingChannel] = React.useState<Channel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [, setAgentModelId] = useAtom(agentModelIdAtom)

  /** 加载渠道列表 */
  const loadChannels = React.useCallback(async () => {
    try {
      const list = await window.electronAPI.listChannels()
      setChannels(list)
    } catch (error) {
      console.error('[渠道设置] 加载渠道列表失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadChannels()
  }, [loadChannels])

  /** 删除渠道 */
  const handleDelete = async (channel: Channel): Promise<void> => {
    if (!confirm(`确定删除渠道「${channel.name}」？此操作不可恢复。`)) return

    try {
      await window.electronAPI.deleteChannel(channel.id)

      // 如果删除的是当前 Agent 渠道，清空选择
      if (agentChannelId === channel.id) {
        setAgentChannelId(null)
        setAgentModelId(null)
        await window.electronAPI.updateSettings({ agentChannelId: undefined, agentModelId: undefined })
      }

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 删除渠道失败:', error)
    }
  }

  /** 切换渠道启用状态 */
  const handleToggle = async (channel: Channel): Promise<void> => {
    try {
      await window.electronAPI.updateChannel(channel.id, { enabled: !channel.enabled })

      // 如果禁用的是当前 Agent 渠道，清空选择
      if (channel.enabled && agentChannelId === channel.id) {
        setAgentChannelId(null)
        setAgentModelId(null)
        await window.electronAPI.updateSettings({ agentChannelId: undefined, agentModelId: undefined })
      }

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 切换渠道状态失败:', error)
    }
  }

  /** 选择 Agent 供应商 */
  const handleSelectAgentProvider = async (channelId: string): Promise<void> => {
    setAgentChannelId(channelId)
    setAgentModelId(null)
    try {
      await window.electronAPI.updateSettings({ agentChannelId: channelId, agentModelId: undefined })
    } catch (error) {
      console.error('[渠道设置] 保存 Agent 供应商失败:', error)
    }
  }

  /** 表单保存回调 */
  const handleFormSaved = (): void => {
    setViewMode('list')
    setEditingChannel(null)
    loadChannels()
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingChannel(null)
  }

  // 表单视图
  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <ChannelForm
        channel={editingChannel}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  // 分离官方渠道和用户渠道
  const officialChannel = channels.find((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID)
  const userChannels = channels.filter((c) => c.id !== PROMA_OFFICIAL_CHANNEL_ID)

  // Agent 供应商渠道（Anthropic 兼容 + Proma 官方，已启用）
  const agentProviderChannels = channels.filter(
    (c) => (c.provider === 'anthropic' || c.provider === 'proma') && c.enabled
  )
  // 官方渠道排在最前
  const sortedAgentProviders = [
    ...agentProviderChannels.filter((c) => c.id === PROMA_OFFICIAL_CHANNEL_ID),
    ...agentProviderChannels.filter((c) => c.id !== PROMA_OFFICIAL_CHANNEL_ID),
  ]

  // 列表视图
  return (
    <div className="space-y-8">
      {/* 区块一：聊天渠道 */}
      <SettingsSection
        title="聊天渠道供应商"
        description="管理 AI 对话的供应商连接，配置 API Key 和可用模型"
        action={
          <Button size="sm" onClick={() => setViewMode('create')}>
            <Plus size={16} />
            <span>添加渠道</span>
          </Button>
        }
      >
        {/* 官方渠道（始终排在第一位） */}
        {officialChannel && (
          <SettingsCard>
            <OfficialChannelRow
              channel={officialChannel}
              onEdit={() => {
                setEditingChannel(officialChannel)
                setViewMode('edit')
              }}
              onToggle={() => handleToggle(officialChannel)}
            />
          </SettingsCard>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : userChannels.length === 0 && !officialChannel ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-12 text-center">
              还没有配置任何渠道，点击上方"添加渠道"开始
            </div>
          </SettingsCard>
        ) : userChannels.length > 0 ? (
          <SettingsCard>
            {userChannels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                onEdit={() => {
                  setEditingChannel(channel)
                  setViewMode('edit')
                }}
                onDelete={() => handleDelete(channel)}
                onToggle={() => handleToggle(channel)}
              />
            ))}
          </SettingsCard>
        ) : null}
      </SettingsSection>

      {/* 区块二：Agent 供应商 */}
      <SettingsSection
        title="Agent 供应商"
        description="选择一个 Anthropic 兼容格式的渠道作为 Agent 模式的默认供应商"
      >
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : sortedAgentProviders.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-8 text-center">
              暂无可用的 Agent 供应商，请先在上方添加 Anthropic 渠道并启用，或登录 Proma 官方账户
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {sortedAgentProviders.map((channel) => (
              channel.id === PROMA_OFFICIAL_CHANNEL_ID ? (
                <AgentOfficialProviderRow
                  key={channel.id}
                  channel={channel}
                  selected={agentChannelId === channel.id}
                  onSelect={() => handleSelectAgentProvider(channel.id)}
                  onRefresh={loadChannels}
                />
              ) : (
                <AgentProviderRow
                  key={channel.id}
                  channel={channel}
                  selected={agentChannelId === channel.id}
                  onSelect={() => handleSelectAgentProvider(channel.id)}
                />
              )
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </div>
  )
}

// ===== 渠道行子组件 =====

interface ChannelRowProps {
  channel: Channel
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function ChannelRow({ channel, onEdit, onDelete, onToggle }: ChannelRowProps): React.ReactElement {
  const enabledCount = channel.models.filter((m) => m.enabled).length
  const description = [
    PROVIDER_LABELS[channel.provider],
    enabledCount > 0 ? `${enabledCount} 个模型已启用` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SettingsRow
      label={channel.name}
      icon={<img src={getChannelLogo(channel.baseUrl)} alt="" className="w-8 h-8 rounded" />}
      description={description}
      className="group"
    >
      <div className="flex items-center gap-2">
        {/* 操作按钮 */}
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
          title="编辑"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
          title="删除"
        >
          <Trash2 size={14} />
        </button>

        {/* 启用/关闭开关 */}
        <Switch
          checked={channel.enabled}
          onCheckedChange={onToggle}
        />
      </div>
    </SettingsRow>
  )
}

// ===== Agent 供应商行子组件 =====

interface AgentProviderRowProps {
  channel: Channel
  selected: boolean
  onSelect: () => void
}

function AgentProviderRow({ channel, selected, onSelect }: AgentProviderRowProps): React.ReactElement {
  const enabledCount = channel.models.filter((m) => m.enabled).length
  const description = [
    PROVIDER_LABELS[channel.provider],
    enabledCount > 0 ? `${enabledCount} 个模型可用` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SettingsRow
      label={channel.name}
      icon={<img src={getChannelLogo(channel.baseUrl)} alt="" className="w-8 h-8 rounded" />}
      description={description}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center justify-center w-5 h-5 rounded-full border-2 transition-colors"
        style={{
          borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
        }}
      >
        {selected && (
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: 'hsl(var(--primary))' }}
          />
        )}
      </button>
    </SettingsRow>
  )
}

// ===== Agent 官方供应商行子组件 =====

interface AgentOfficialProviderRowProps {
  channel: Channel
  selected: boolean
  onSelect: () => void
  onRefresh: () => void
}

function AgentOfficialProviderRow({ channel, selected, onSelect, onRefresh }: AgentOfficialProviderRowProps): React.ReactElement {
  const enabledCount = channel.models.filter((m) => m.enabled).length
  const [refreshing, setRefreshing] = React.useState(false)

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await window.electronAPI.syncOfficialChannel()
      onRefresh()
    } catch (error) {
      console.error('[渠道设置] 刷新官方渠道失败:', error)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <SettingsRow
      label="Proma 官方"
      icon={<img src={PromaLogo} alt="Proma" className="w-8 h-8 rounded" />}
      description={`官方供应商 · ${enabledCount} 个模型可用`}
      className="group"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
          title="刷新模型列表"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <span
          className="p-1.5 text-muted-foreground/40"
          title="官方渠道"
        >
          <Shield size={14} />
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="flex items-center justify-center w-5 h-5 rounded-full border-2 transition-colors"
          style={{
            borderColor: selected ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          }}
        >
          {selected && (
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: 'hsl(var(--primary))' }}
            />
          )}
        </button>
      </div>
    </SettingsRow>
  )
}

// ===== 官方渠道行子组件 =====

interface OfficialChannelRowProps {
  channel: Channel
  onEdit: () => void
  onToggle: () => void
}

function OfficialChannelRow({ channel, onEdit, onToggle }: OfficialChannelRowProps): React.ReactElement {
  const enabledCount = channel.models.filter((m) => m.enabled).length

  return (
    <SettingsRow
      label="Proma 官方"
      icon={<img src={PromaLogo} alt="Proma" className="w-8 h-8 rounded" />}
      description={`官方供应商 · ${enabledCount} 个模型可用`}
      className="group"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors opacity-0 group-hover:opacity-100"
          title="查看"
        >
          <Pencil size={14} />
        </button>
        <span
          className="p-1.5 text-muted-foreground/40"
          title="官方渠道不可删除"
        >
          <Shield size={14} />
        </span>
        <Switch
          checked={channel.enabled}
          onCheckedChange={onToggle}
        />
      </div>
    </SettingsRow>
  )
}
