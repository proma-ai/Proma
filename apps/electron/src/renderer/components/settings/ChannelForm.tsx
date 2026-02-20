/**
 * ChannelForm - 渠道编辑表单
 *
 * 支持创建和编辑渠道，包含：
 * - 基本信息（名称、供应商、Base URL、API Key）
 * - 模型列表编辑
 * - 连接测试
 *
 * 使用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Download,
  Info,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PROVIDER_DEFAULT_URLS,
  PROVIDER_LABELS,
  PROMA_OFFICIAL_CHANNEL_ID,
} from '@proma/shared'
import type {
  Channel,
  ChannelCreateInput,
  ChannelModel,
  ChannelTestResult,
  FetchModelsResult,
  ProviderType,
} from '@proma/shared'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'

interface ChannelFormProps {
  /** 编辑模式下传入已有渠道，创建模式传 null */
  channel: Channel | null
  onSaved: () => void
  onCancel: () => void
}

/** 所有可选供应商 */
const PROVIDER_OPTIONS: ProviderType[] = ['anthropic', 'openai', 'deepseek', 'google', 'moonshot', 'zhipu', 'minimax', 'doubao', 'qwen', 'custom']

/** 供应商选项（用于 SettingsSelect） */
const PROVIDER_SELECT_OPTIONS = PROVIDER_OPTIONS.map((p) => ({
  value: p,
  label: PROVIDER_LABELS[p],
}))

/** 各供应商的 Chat 端点路径，用于 Base URL 预览 */
const PROVIDER_CHAT_PATHS: Record<ProviderType, string> = {
  proma: '/chat',
  anthropic: '/v1/messages',
  openai: '/chat/completions',
  deepseek: '/chat/completions',
  google: '/v1beta/models/{model}:generateContent',
  moonshot: '/chat/completions',
  zhipu: '/chat/completions',
  minimax: '/chat/completions',
  doubao: '/chat/completions',
  qwen: '/chat/completions',
  custom: '/chat/completions',
}

/**
 * 生成 API 端点预览 URL
 *
 * Anthropic 特殊处理：如果 baseUrl 已包含 /v1，则不重复添加。
 */
function buildPreviewUrl(baseUrl: string, provider: ProviderType): string {
  let trimmed = baseUrl.trim().replace(/\/+$/, '')

  if (provider === 'anthropic') {
    // 去除用户误填的 /messages 后缀，与 normalizeAnthropicBaseUrl 保持一致
    trimmed = trimmed.replace(/\/messages$/, '')
    if (trimmed.match(/\/v\d+$/)) {
      return `${trimmed}/messages`
    }
    return `${trimmed}/v1/messages`
  }

  return `${trimmed}${PROVIDER_CHAT_PATHS[provider]}`
}

export function ChannelForm({ channel, onSaved, onCancel }: ChannelFormProps): React.ReactElement {
  const isEdit = channel !== null
  const isPromaOfficial = channel?.id === PROMA_OFFICIAL_CHANNEL_ID

  // 表单状态
  const [name, setName] = React.useState(channel?.name ?? '')
  const [provider, setProvider] = React.useState<ProviderType>(channel?.provider ?? 'anthropic')
  const [baseUrl, setBaseUrl] = React.useState(channel?.baseUrl ?? PROVIDER_DEFAULT_URLS.anthropic)
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [models, setModels] = React.useState<ChannelModel[]>(channel?.models ?? [])
  const [enabled, setEnabled] = React.useState(channel?.enabled ?? true)

  // 新模型输入
  const [newModelId, setNewModelId] = React.useState('')
  const [newModelName, setNewModelName] = React.useState('')

  // 模型搜索过滤
  const [modelFilter, setModelFilter] = React.useState('')

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<ChannelTestResult | null>(null)
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchResult, setFetchResult] = React.useState<FetchModelsResult | null>(null)
  const [apiKeyLoaded, setApiKeyLoaded] = React.useState(false)

  // 编辑模式下加载明文 API Key（官方渠道跳过）
  React.useEffect(() => {
    if (isEdit && channel && !apiKeyLoaded && !isPromaOfficial) {
      window.electronAPI.decryptApiKey(channel.id).then((key) => {
        setApiKey(key)
        setApiKeyLoaded(true)
      }).catch((error) => {
        console.error('[渠道表单] 解密 API Key 失败:', error)
        setApiKeyLoaded(true)
      })
    }
  }, [isEdit, channel, apiKeyLoaded])

  // 切换供应商时自动更新 Base URL
  const handleProviderChange = (newProvider: string): void => {
    const p = newProvider as ProviderType
    setProvider(p)
    setBaseUrl(PROVIDER_DEFAULT_URLS[p])
    setTestResult(null)
  }

  /** 添加模型 */
  const handleAddModel = (): void => {
    if (!newModelId.trim()) return

    const model: ChannelModel = {
      id: newModelId.trim(),
      name: newModelName.trim() || newModelId.trim(),
      enabled: true,
    }

    setModels((prev) => [...prev, model])
    setNewModelId('')
    setNewModelName('')
  }

  /** 删除模型 */
  const handleRemoveModel = (modelId: string): void => {
    setModels((prev) => prev.filter((m) => m.id !== modelId))
  }

  /** 切换模型启用状态 */
  const handleToggleModel = (modelId: string): void => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m))
    )
  }

  /** 从供应商 API 拉取可用模型列表 */
  const handleFetchModels = async (): Promise<void> => {
    if (!apiKey.trim() || !baseUrl.trim()) return

    setFetchingModels(true)
    setFetchResult(null)

    try {
      const result = await window.electronAPI.fetchModels({
        provider,
        baseUrl,
        apiKey,
      })

      setFetchResult(result)

      if (result.success && result.models.length > 0) {
        // 合并拉取的模型：保留已有模型的启用状态，新模型默认不勾选
        const existingIds = new Set(models.map((m) => m.id))
        const newModels = result.models
          .filter((m) => !existingIds.has(m.id))
          .map((m) => ({ ...m, enabled: false }))
        if (newModels.length > 0) {
          setModels((prev) => [...prev, ...newModels])
        }
      }
    } catch (error) {
      setFetchResult({ success: false, message: '拉取模型请求失败', models: [] })
    } finally {
      setFetchingModels(false)
    }
  }

  /** 测试连接（直接使用表单当前值，无需先保存） */
  const handleTest = async (): Promise<void> => {
    if (!apiKey.trim() || !baseUrl.trim()) return

    setTesting(true)
    setTestResult(null)

    try {
      const result = await window.electronAPI.testChannelDirect({
        provider,
        baseUrl,
        apiKey,
      })
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: '测试请求失败' })
    } finally {
      setTesting(false)
    }
  }

  /** 保存渠道 */
  const saveChannel = async (): Promise<void> => {
    if (isPromaOfficial && channel) {
      // 官方渠道只更新模型启用状态
      await window.electronAPI.updateChannel(channel.id, { models })
    } else if (isEdit && channel) {
      await window.electronAPI.updateChannel(channel.id, {
        name,
        provider,
        baseUrl,
        apiKey: apiKey || undefined,
        models,
        enabled,
      })
    } else {
      const input: ChannelCreateInput = {
        name,
        provider,
        baseUrl,
        apiKey,
        models,
        enabled,
      }
      await window.electronAPI.createChannel(input)
    }
  }

  /** 提交表单 */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    // 官方渠道只保存模型启用状态
    if (isPromaOfficial) {
      setSaving(true)
      try {
        await saveChannel()
        onSaved()
      } catch (error) {
        console.error('[渠道表单] 保存失败:', error)
      } finally {
        setSaving(false)
      }
      return
    }

    if (!name.trim() || !apiKey.trim()) return

    setSaving(true)
    try {
      await saveChannel()
      onSaved()
    } catch (error) {
      console.error('[渠道表单] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  // 过滤并排序模型列表：已启用的排前面，再按搜索词过滤
  const filteredModels = React.useMemo(() => {
    const sorted = [...models].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return 0
    })
    if (!modelFilter.trim()) return sorted
    const keyword = modelFilter.trim().toLowerCase()
    return sorted.filter(
      (m) => m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword)
    )
  }, [models, modelFilter])

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 标题栏 + 操作按钮 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onCancel}>
          <ArrowLeft size={18} />
        </Button>
        <h3 className="text-lg font-medium text-foreground flex-1">
          {isPromaOfficial ? 'Proma 官方渠道' : isEdit ? '编辑渠道' : '添加渠道'}
        </h3>
        <div className="flex items-center gap-2">
          {isPromaOfficial ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={onCancel}
            >
              返回
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={onCancel}
              >
                取消
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={saving || !name.trim() || (!isEdit && !apiKey.trim())}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                <span>{isEdit ? '保存修改' : '创建渠道'}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 官方渠道提示 */}
      {isPromaOfficial && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary/5 text-sm text-primary">
          <Info size={15} className="flex-shrink-0" />
          <span>模型由服务端管理，自动更新。如需调整可启用/禁用单个模型。</span>
        </div>
      )}

      {/* 基本信息卡片 — 官方渠道隐藏 */}
      {!isPromaOfficial && (
        <SettingsSection title="基本信息">
          <SettingsCard>
            <SettingsInput
              label="渠道名称"
              value={name}
              onChange={setName}
              placeholder="例如: My Anthropic"
              required
            />
            <SettingsSelect
              label="供应商类型"
              value={provider}
              onValueChange={handleProviderChange}
              options={PROVIDER_SELECT_OPTIONS}
              placeholder="选择供应商"
            />
            <SettingsInput
              label="Base URL"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://api.example.com"
              description={baseUrl.trim() ? `预览：${buildPreviewUrl(baseUrl, provider)}` : undefined}
            />
            {/* API Key + 测试连接同行 */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">API Key</div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !apiKey.trim() || !baseUrl.trim()}
                  className="h-7 text-xs"
                >
                  {testing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Zap size={12} />
                  )}
                  <span>测试连接</span>
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={isEdit ? '留空则不更新' : '输入 API Key'}
                  required={!isEdit}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {testResult && (
                <div className={cn(
                  'flex items-center gap-1.5 text-xs',
                  testResult.success ? 'text-emerald-600' : 'text-destructive'
                )}>
                  {testResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
            <SettingsToggle
              label="启用此渠道"
              description="关闭后该渠道不会在模型选择中出现"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 模型列表卡片 */}
      <SettingsSection
        title="模型列表"
        action={
          !isPromaOfficial ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels || !apiKey.trim() || !baseUrl.trim()}
              className="h-7 text-xs"
            >
              {fetchingModels ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              <span>从供应商获取</span>
            </Button>
          ) : undefined
        }
      >
        {/* 拉取结果提示 */}
        {fetchResult && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-1',
            fetchResult.success ? 'text-emerald-600' : 'text-destructive'
          )}>
            {fetchResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            <span>{fetchResult.message}</span>
          </div>
        )}

        <SettingsCard divided={false}>
          {/* 模型搜索过滤 */}
          {models.length > 5 && (
            <div className="px-4 pt-3 pb-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="搜索模型..."
                  className="h-8 text-sm pl-8"
                />
              </div>
            </div>
          )}

          {/* 模型计数 */}
          {models.length > 0 && (
            <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
              {modelFilter.trim()
                ? `${filteredModels.length} / ${models.length} 个模型`
                : `${models.filter((m) => m.enabled).length} 个已启用，共 ${models.length} 个模型`}
            </div>
          )}

          <ScrollArea className={models.length > 8 ? 'h-[320px]' : undefined}>
            <div className="divide-y divide-border/50">
              {/* 已有模型列表（过滤 + 排序后） */}
              {filteredModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-2 px-4 py-2.5"
                >
                  <input
                    type="checkbox"
                    checked={model.enabled}
                    onChange={() => handleToggleModel(model.id)}
                    className="w-3.5 h-3.5 rounded border-input accent-foreground"
                  />
                  <span className="text-sm text-foreground flex-1">
                    {model.name}
                    {model.name !== model.id && (
                      <span className="text-muted-foreground ml-1">({model.id})</span>
                    )}
                  </span>
                  {!isPromaOfficial && (
                    <button
                      type="button"
                      onClick={() => handleRemoveModel(model.id)}
                      className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}

              {/* 搜索无结果提示 */}
              {modelFilter.trim() && filteredModels.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  未找到匹配的模型
                </div>
              )}
            </div>
          </ScrollArea>

          {/* 添加新模型 — 官方渠道隐藏 */}
          {!isPromaOfficial && (
            <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/50">
              <Input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="模型 ID（如 claude-opus-4-6）"
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddModel()
                  }
                }}
              />
              <Input
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                placeholder="显示名称（可选）"
                className="flex-1 h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddModel()
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={handleAddModel}
                disabled={!newModelId.trim()}
                className="h-8 w-8 flex-shrink-0"
              >
                <Plus size={18} />
              </Button>
            </div>
          )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </form>
  )
}
