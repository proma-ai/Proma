/**
 * ChannelSettings - 渠道配置页
 *
 * 分为两个区块：
 * 1. 渠道管理 — 所有渠道列表 + 添加/编辑/删除（渠道同时用于 Chat 和 Agent）
 * 2. Agent 供应商 — 从已启用的 Anthropic 兼容渠道（Anthropic / DeepSeek / Kimi / MiniMax）中
 *    通过 Switch 开关启用多个 Agent 供应商
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PROVIDER_LABELS, isAgentCompatibleProvider } from '@proma/shared'
import type { Channel } from '@proma/shared'
import { getChannelLogo, PromaLogo } from '@/lib/model-logo'
import { agentChannelIdAtom, agentModelIdAtom, agentChannelIdsAtom } from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/chat-atoms'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  const [agentChannelIds, setAgentChannelIds] = useAtom(agentChannelIdsAtom)
  const setGlobalChannels = useSetAtom(channelsAtom)
  const [deleteTarget, setDeleteTarget] = React.useState<Channel | null>(null)
  const agentChannelIdsRef = React.useRef(agentChannelIds)
  const agentChannelIdRef = React.useRef(agentChannelId)

  React.useEffect(() => {
    agentChannelIdsRef.current = agentChannelIds
  }, [agentChannelIds])

  React.useEffect(() => {
    agentChannelIdRef.current = agentChannelId
  }, [agentChannelId])

  /** 加载渠道列表 */
  const loadChannels = React.useCallback(async (): Promise<Channel[]> => {
    try {
      const list = await window.electronAPI.listChannels()
      setChannels(list)
      setGlobalChannels(list) // 同步到全局缓存
      return list
    } catch (error) {
      console.error('[渠道设置] 加载渠道列表失败:', error)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const syncAgentChannelEligibility = React.useCallback(async (
    channel: Channel,
    eligible: boolean,
  ): Promise<void> => {
    const currentIds = agentChannelIdsRef.current

    if (eligible) {
      if (currentIds.includes(channel.id)) return
      const newIds = [...currentIds, channel.id]
      agentChannelIdsRef.current = newIds
      setAgentChannelIds(newIds)
      await window.electronAPI.updateSettings({ agentChannelIds: newIds }).catch(console.error)
      return
    }

    if (!currentIds.includes(channel.id)) return
    const newIds = currentIds.filter((id) => id !== channel.id)
    agentChannelIdsRef.current = newIds
    setAgentChannelIds(newIds)

    const updates: Parameters<typeof window.electronAPI.updateSettings>[0] = {
      agentChannelIds: newIds,
    }
    if (agentChannelIdRef.current === channel.id) {
      agentChannelIdRef.current = null
      setAgentChannelId(null)
      setAgentModelId(null)
      updates.agentChannelId = undefined
      updates.agentModelId = undefined
    }

    await window.electronAPI.updateSettings(updates).catch(console.error)
  }, [setAgentChannelIds, setAgentChannelId, setAgentModelId])

  /** 删除渠道（通过弹窗确认） */
  const handleDeleteRequest = (channel: Channel): void => {
    setDeleteTarget(channel)
  }

  /** 确认删除 */
  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTarget) return
    const target = deleteTarget
    try {
      await window.electronAPI.deleteChannel(target.id)

      // 从 Agent 渠道列表中移除
      const newIds = agentChannelIds.filter((id) => id !== target.id)
      setAgentChannelIds(newIds)

      // 如果删除的是当前选中的 Agent 渠道，清空选择
      if (agentChannelId === target.id) {
        setAgentChannelId(null)
        setAgentModelId(null)
      }

      await window.electronAPI.updateSettings({
        agentChannelIds: newIds,
        ...(agentChannelId === target.id && { agentChannelId: undefined, agentModelId: undefined }),
      })

      await loadChannels()
      setDeleteTarget(null)
    } catch (error) {
      console.error('[渠道设置] 删除渠道失败:', error)
    }
  }

  /** 切换渠道启用状态 */
  const handleToggle = async (channel: Channel): Promise<void> => {
    try {
      const savedChannel = await window.electronAPI.updateChannel(channel.id, { enabled: !channel.enabled })
      await syncAgentChannelEligibility(
        savedChannel,
        savedChannel.enabled && isAgentCompatibleProvider(savedChannel.provider),
      )

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 切换渠道状态失败:', error)
    }
  }

  /** 切换 Agent 供应商开关 */
  const handleToggleAgentProvider = async (channelId: string, enabled: boolean): Promise<void> => {
    const newIds = enabled
      ? [...agentChannelIds, channelId]
      : agentChannelIds.filter((id) => id !== channelId)

    setAgentChannelIds(newIds)

    // 如果关闭的是当前选中的渠道，清空选择
    if (!enabled && agentChannelId === channelId) {
      setAgentChannelId(null)
      setAgentModelId(null)
      await window.electronAPI.updateSettings({
        agentChannelIds: newIds,
        agentChannelId: undefined,
        agentModelId: undefined,
      }).catch(console.error)
      return
    }

    await window.electronAPI.updateSettings({ agentChannelIds: newIds }).catch(console.error)
  }

  /** 表单保存回调 */
  const handleFormSaved = async (): Promise<void> => {
    setViewMode('list')
    setEditingChannel(null)
    await loadChannels()
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
        onAgentEligibilityChange={syncAgentChannelEligibility}
        onCancel={handleFormCancel}
      />
    )
  }

  // Agent 兼容渠道（已启用）：Anthropic 协议家族 / OpenAI Responses / ChatGPT Codex
  const agentCapableChannels = channels.filter(
    (c) => isAgentCompatibleProvider(c.provider) && c.enabled
  )

  // 列表视图
  return (
    <div className="space-y-8">
      {/* 区块一：模型配置 */}
      <SettingsSection
        title="模型配置"
        description="管理 AI 供应商连接，配置 API Key 和可用模型。Anthropic 渠道同时可用于 Agent 模式"
        action={
          <Button size="sm" onClick={() => setViewMode('create')}>
            <Plus size={16} />
            <span>添加配置</span>
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
              还没有配置任何模型，点击上方"添加配置"开始
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
                onDelete={() => handleDeleteRequest(channel)}
                onToggle={() => handleToggle(channel)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      {/* 区块二：Agent 供应商 */}
      <SettingsSection
        title="Agent 供应商"
        description="启用 Agent 模式可用的供应商，支持同时开启多个渠道，在 Agent 模式下可直接切换"
      >
        <SettingsCard>
          <PromaProviderCard />
        </SettingsCard>
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
        ) : agentCapableChannels.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="text-sm text-muted-foreground py-8 text-center">
              暂无可用的 Anthropic 兼容渠道，请先在上方添加 Anthropic / DeepSeek / Kimi / MiniMax 渠道并启用
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {agentCapableChannels.map((channel) => (
              <AgentProviderRow
                key={channel.id}
                channel={channel}
                enabled={agentChannelIds.includes(channel.id)}
                onToggle={(enabled) => handleToggleAgentProvider(channel.id, enabled)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      {/* 删除确认弹窗 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除渠道？</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除渠道「{deleteTarget?.name}」？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    isAgentCompatibleProvider(channel.provider) ? '可用于 Agent' : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SettingsRow
      label={channel.name}
      icon={<img src={getChannelLogo(channel)} alt="" className="w-8 h-8 rounded" />}
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
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

function AgentProviderRow({ channel, enabled, onToggle }: AgentProviderRowProps): React.ReactElement {
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
      icon={<img src={getChannelLogo(channel)} alt="" className="w-8 h-8 rounded" />}
      description={description}
    >
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
      />
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
      description="Proma 官方供应｜稳定｜靠谱｜丝滑｜简单｜可用于 Agent"
    >
      <Button size="sm" variant="outline" className="gap-1.5" onClick={handleDownload}>
        <ExternalLink size={13} />
        <span>下载后启动</span>
      </Button>
    </SettingsRow>
  )
}
