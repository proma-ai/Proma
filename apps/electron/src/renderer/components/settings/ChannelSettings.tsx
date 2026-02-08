/**
 * ChannelSettings - 渠道配置页
 *
 * 分为两个区块：
 * 1. 聊天渠道 — 所有渠道列表 + 添加/编辑/删除
 * 2. Agent 供应商 — 仅 Anthropic 渠道，radio 选择默认 Agent 渠道
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PROVIDER_LABELS } from '@proma/shared'
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

  // Anthropic 渠道（已启用）
  const anthropicChannels = channels.filter(
    (c) => c.provider === 'anthropic' && c.enabled
  )

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
        <SettingsCard>
          <PromaProviderCard />
        </SettingsCard>
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : channels.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-12 text-center">
              还没有配置任何渠道，点击上方"添加渠道"开始
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {channels.map((channel) => (
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
        )}
      </SettingsSection>

      {/* 区块二：Agent 供应商 */}
      <SettingsSection
        title="Agent 供应商"
        description="选择一个 Anthropic 兼容格式的渠道作为 Agent 模式的默认供应商"
      >
        <SettingsCard>
          <PromaProviderCard />
        </SettingsCard>
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : anthropicChannels.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-8 text-center">
              暂无可用的 Anthropic 兼容格式渠道，请先在上方添加 Anthropic 渠道并启用
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {anthropicChannels.map((channel) => (
              <AgentProviderRow
                key={channel.id}
                channel={channel}
                selected={agentChannelId === channel.id}
                onSelect={() => handleSelectAgentProvider(channel.id)}
              />
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

// ===== Proma 官方供应商推广卡片 =====

function PromaProviderCard(): React.ReactElement {
  const handleDownload = (): void => {
    window.open('http://proma.cool/download', '_blank')
  }

  return (
    <SettingsRow
      label="Proma"
      icon={<img src={PromaLogo} alt="Proma" className="w-8 h-8 rounded" />}
      description="Proma 官方供应｜稳定｜靠谱｜丝滑｜简单｜优惠套餐"
    >
      <Button size="sm" variant="outline" className="gap-1.5" onClick={handleDownload}>
        <ExternalLink size={13} />
        <span>下载后启动</span>
      </Button>
    </SettingsRow>
  )
}
