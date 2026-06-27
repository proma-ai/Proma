/**
 * ChannelForm - 模型配置编辑表单
 *
 * 支持创建和编辑模型配置，包含：
 * - 基本信息（名称、供应商、Base URL、API Key）
 * - 模型列表：已启用模型置顶 + 可用模型搜索
 * - 连接测试
 *
 * 编辑模式下修改即时保存（auto-save），创建模式仍需手动提交。
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
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom } from 'jotai'
import { channelFormDirtyAtom } from '@/atoms/settings-tab'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PROVIDER_DEFAULT_URLS,
  PROVIDER_LABELS,
  isAgentCompatibleProvider,
} from '@proma/shared'
import type {
  Channel,
  ChannelCreateInput,
  ChannelModel,
  ChannelTestResult,
  FetchModelsResult,
  ProviderType,
} from '@proma/shared'
import { resolveAnthropicMessagesUrl, resolveOpenAIChatCompletionsUrl } from '@proma/core'
import { getProviderLogo } from '@/lib/model-logo'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  onSaved: (channel?: Channel) => void
  onAgentEligibilityChange?: (channel: Channel, eligible: boolean) => void | Promise<void>
  onCancel: () => void
}

/** 所有可选供应商 */
const PROVIDER_OPTIONS: ProviderType[] = ['anthropic', 'anthropic-compatible', 'openai', 'deepseek', 'google', 'kimi-api', 'kimi-coding', 'zhipu', 'zhipu-coding', 'minimax', 'doubao', 'qwen', 'qwen-anthropic', 'xiaomi', 'xiaomi-token-plan', 'custom']

/** 供应商选项（用于 SettingsSelect） */
const PROVIDER_SELECT_OPTIONS = PROVIDER_OPTIONS.map((p) => ({
  value: p,
  label: PROVIDER_LABELS[p],
  icon: getProviderLogo(p),
}))

/** 走 Anthropic 协议的供应商集合（共用 /v1/messages 端点） */
const ANTHROPIC_PROTOCOL_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'anthropic-compatible',
  'deepseek',
  'kimi-api',
  'kimi-coding',
  'zhipu-coding',
  'minimax',
  'xiaomi',
  'xiaomi-token-plan',
  'qwen-anthropic',
])

/**
 * 生成 API 端点预览 URL
 *
 * 与运行时 channel-manager / ProviderAdapter 的端点解析逻辑保持一致。
 */
function buildPreviewUrl(baseUrl: string, provider: ProviderType): string {
  if (ANTHROPIC_PROTOCOL_PROVIDERS.has(provider)) {
    return resolveAnthropicMessagesUrl(baseUrl, provider)
  }
  if (provider === 'google') {
    return `${baseUrl.trim().replace(/\/+$/, '')}/v1beta/models/{model}:generateContent`
  }
  return resolveOpenAIChatCompletionsUrl(baseUrl, provider)
}

function getUrlInputLabel(provider: ProviderType): string {
  return provider === 'custom' || provider === 'anthropic-compatible' ? '请求地址' : 'Base URL'
}

function getUrlInputPlaceholder(provider: ProviderType): string {
  if (provider === 'custom') return 'https://api.example.com/v1/chat/completions'
  if (provider === 'anthropic-compatible') return 'https://api.example.com/v1/messages'
  return 'https://api.example.com'
}

/** auto-save 防抖延迟 */
const AUTO_SAVE_DELAY = 600

function isAgentEligibleChannel(channel: Pick<Channel, 'provider' | 'enabled'>): boolean {
  return channel.enabled && isAgentCompatibleProvider(channel.provider)
}

export function ChannelForm({ channel, onSaved, onAgentEligibilityChange, onCancel }: ChannelFormProps): React.ReactElement {
  const isEdit = channel !== null

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
  const [showExitDialog, setShowExitDialog] = React.useState(false)

  const setChannelFormDirty = useSetAtom(channelFormDirtyAtom)
  const lastAgentEligibleRef = React.useRef(channel ? isAgentEligibleChannel(channel) : false)

  React.useEffect(() => {
    lastAgentEligibleRef.current = channel ? isAgentEligibleChannel(channel) : false
  }, [channel])

  /** 编辑模式下加载明文 API Key */
  React.useEffect(() => {
    if (isEdit && channel && !apiKeyLoaded) {
      window.electronAPI.decryptApiKey(channel.id).then((key) => {
        setApiKey(key)
        setApiKeyLoaded(true)
      }).catch((error) => {
        console.error('[模型配置表单] 解密 API Key 失败:', error)
        setApiKeyLoaded(true)
      })
    }
  }, [isEdit, channel, apiKeyLoaded])

  // ===== Auto-save（仅编辑模式） =====
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 初始化完成标志，避免加载时触发 auto-save */
  const initializedRef = React.useRef(false)

  /** 执行 auto-save */
  const doAutoSave = React.useCallback(async (
    currentModels: ChannelModel[],
    currentName: string,
    currentProvider: ProviderType,
    currentBaseUrl: string,
    currentApiKey: string,
    currentEnabled: boolean,
  ) => {
    if (!isEdit || !channel) return
    try {
      const savedChannel = await window.electronAPI.updateChannel(channel.id, {
        name: currentName,
        provider: currentProvider,
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey || undefined,
        models: currentModels,
        enabled: currentEnabled,
      })
      const eligible = isAgentEligibleChannel(savedChannel)
      if (eligible !== lastAgentEligibleRef.current) {
        lastAgentEligibleRef.current = eligible
        await onAgentEligibilityChange?.(savedChannel, eligible)
      }
      toast.success('已保存', { id: 'auto-save-success' })
    } catch (error) {
      console.error('[模型配置表单] auto-save 失败:', error)
      toast.error('自动保存失败，请检查后手动重试', { id: 'auto-save-error' })
    }
  }, [isEdit, channel, onAgentEligibilityChange])

  /** 触发防抖 auto-save */
  const scheduleAutoSave = React.useCallback((
    nextModels: ChannelModel[],
    nextName: string,
    nextProvider: ProviderType,
    nextBaseUrl: string,
    nextApiKey: string,
    nextEnabled: boolean,
  ) => {
    if (!isEdit || !initializedRef.current) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      doAutoSave(nextModels, nextName, nextProvider, nextBaseUrl, nextApiKey, nextEnabled)
    }, AUTO_SAVE_DELAY)
  }, [isEdit, doAutoSave])

  // API Key 加载完成后标记初始化
  React.useEffect(() => {
    if (isEdit && apiKeyLoaded) {
      // 延迟标记，避免加载时触发
      const t = setTimeout(() => { initializedRef.current = true }, 100)
      return () => clearTimeout(t)
    }
    if (!isEdit) {
      initializedRef.current = true
    }
  }, [isEdit, apiKeyLoaded])

  // 监听字段变化触发 auto-save
  React.useEffect(() => {
    scheduleAutoSave(models, name, provider, baseUrl, apiKey, enabled)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [models, name, provider, baseUrl, apiKey, enabled, scheduleAutoSave])

  // 切换供应商时自动更新 Base URL 与名称，Anthropic 兼容渠道自动添加预设模型
  const handleProviderChange = (newProvider: string): void => {
    const p = newProvider as ProviderType
    // 若 name 为空或仍是上一个 provider 的默认名称，则用新 provider 的名称覆盖；用户手动改过的 name 不动
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName === PROVIDER_LABELS[provider]) {
      setName(PROVIDER_LABELS[p])
    }
    setProvider(p)
    setBaseUrl(PROVIDER_DEFAULT_URLS[p])
    setTestResult(null)
    // 预设模型：首次切换到对应 provider 且无模型时自动填充
    if (models.length === 0) {
      if (p === 'deepseek') {
        setModels([
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
        ])
      } else if (p === 'kimi-api') {
        setModels([
          { id: 'kimi-k2.6', name: 'Kimi K2.6', enabled: true },
        ])
      } else if (p === 'kimi-coding') {
        setModels([
          { id: 'kimi-for-coding', name: 'Kimi for Coding', enabled: true },
        ])
      } else if (p === 'zhipu' || p === 'zhipu-coding') {
        setModels([
          { id: 'glm-5.2', name: 'GLM-5.2', enabled: true },
          { id: 'glm-5.1', name: 'GLM-5.1', enabled: false },
        ])
      } else if (p === 'minimax') {
        setModels([
          { id: 'MiniMax-M3', name: 'MiniMax-M3', enabled: true },
          { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', enabled: true },
        ])
      } else if (p === 'xiaomi' || p === 'xiaomi-token-plan') {
        setModels([
          { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', enabled: true },
          { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', enabled: true },
          { id: 'mimo-v2.5', name: 'MiMo V2.5', enabled: true },
          { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', enabled: true },
          { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', enabled: true },
        ])
      } else if (p === 'qwen-anthropic') {
        setModels([
          { id: 'qwen3.7-max', name: 'Qwen3.7 Max', enabled: true },
          { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', enabled: true },
        ])
      }
    }
  }

  /** 添加模型 */
  const handleAddModel = (): void => {
    if (!newModelId.trim()) return

    const model: ChannelModel = {
      id: newModelId.trim(),
      name: newModelName.trim() || newModelId.trim(),
      enabled: true,
      source: 'manual',
    }

    setModels((prev) => [...prev, model])
    setNewModelId('')
    setNewModelName('')
  }

  /** 删除模型 */
  const handleRemoveModel = (modelId: string): void => {
    setModels((prev) => prev.filter((m) => m.id !== modelId))
  }

  /** 切换模型启用状态（点击可用模型 → 启用，点击已启用模型 → 禁用） */
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

      // 用拉取结果作为权威清单替换：
      // - source==='manual' 的模型一律保留（即便不在新结果里）
      // - 在新结果里也存在的旧模型保留 enabled 状态
      // - 新出现的模型默认未启用
      // - 既不在新结果里、也不是手动添加的旧模型一律丢弃（清除残留）
      // 失败（result.success===false）时 result.models 为空，等价于清掉所有非手动模型
      const fetchedModels = result.success ? result.models : []
      const fetchedById = new Map(fetchedModels.map((m) => [m.id, m]))
      setModels((prev) => {
        const manualKept = prev.filter((m) => m.source === 'manual' && !fetchedById.has(m.id))
        const merged = fetchedModels.map((m) => {
          const old = prev.find((p) => p.id === m.id)
          return old ? { ...m, enabled: old.enabled } : { ...m, enabled: false }
        })
        return [...manualKept, ...merged]
      })
    } catch (error) {
      setFetchResult({ success: false, message: '拉取模型请求失败', models: [] })
      // IPC 异常等同样按"拉取结果为空"处理：清掉所有非手动模型，保留手动添加的
      setModels((prev) => prev.filter((m) => m.source === 'manual'))
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

  /** 执行创建渠道 */
  const doCreate = React.useCallback(async (): Promise<Channel | null> => {
    if (!name.trim() || !apiKey.trim()) return null

    setSaving(true)
    try {
      const input: ChannelCreateInput = {
        name,
        provider,
        baseUrl,
        apiKey,
        models,
        enabled,
      }
      const savedChannel = await window.electronAPI.createChannel(input)
      if (isAgentEligibleChannel(savedChannel)) {
        await onAgentEligibilityChange?.(savedChannel, true)
      }
      toast.success('渠道创建成功')
      return savedChannel
    } catch (error) {
      console.error('[模型配置表单] 创建失败:', error)
      toast.error('渠道创建失败，请检查配置后重试')
      return null
    } finally {
      setSaving(false)
    }
  }, [name, provider, baseUrl, apiKey, models, enabled, onAgentEligibilityChange])

  /** 创建渠道（仅新建模式） */
  const handleCreate = async (): Promise<void> => {
    if (models.length === 0) {
      toast.warning('尚未配置模型，建议先从供应商获取或手动添加', { id: 'no-models-warn' })
      return
    }
    const savedChannel = await doCreate()
    if (savedChannel) onSaved(savedChannel)
  }

  /** 检测表单是否有未保存内容 */
  const isDirty = !isEdit && (name.trim() !== '' || apiKey.trim() !== '' || models.length > 0)
  const hasNoModels = !isEdit && models.length === 0

  /** 返回按钮：创建模式下有未保存内容时拦截 */
  const handleBack = (): void => {
    if (!isEdit && isDirty) {
      setShowExitDialog(true)
      return
    }
    if (isEdit) {
      onSaved()
    } else {
      onCancel()
    }
  }

  /** 放弃编辑 */
  const handleDiscard = (): void => {
    setShowExitDialog(false)
    onCancel()
  }

  /** 保存并关闭（从弹窗触发） */
  const handleSaveAndClose = async (): Promise<void> => {
    const savedChannel = await doCreate()
    if (savedChannel) {
      setShowExitDialog(false)
      onSaved(savedChannel)
    }
  }

  // 同步表单 dirty 状态到全局 atom（供 SettingsPanel 拦截侧边栏导航）
  React.useEffect(() => {
    setChannelFormDirty(isDirty)
    return () => { setChannelFormDirty(false) }
  }, [isDirty, setChannelFormDirty])

  // 拦截窗口关闭（Cmd+W / Alt+F4 / 点击窗口 X）
  React.useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ===== 模型分区 =====
  const enabledModels = models.filter((m) => m.enabled)
  const availableModels = React.useMemo(() => {
    const disabled = models.filter((m) => !m.enabled)
    if (!modelFilter.trim()) return disabled
    const keyword = modelFilter.trim().toLowerCase()
    return disabled.filter(
      (m) => m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword)
    )
  }, [models, modelFilter])

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <h3 className="text-lg font-medium text-foreground flex-1">
          {isEdit ? '编辑模型配置' : '添加模型配置'}
        </h3>
        {/* 新建模式：创建按钮 */}
        {!isEdit && (
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={saving || !name.trim() || !apiKey.trim()}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>创建</span>
          </Button>
        )}
      </div>

      {/* 基本信息卡片 */}
      <SettingsSection title="基本信息">
        <SettingsCard>
          <SettingsSelect
            label="供应商类型"
            value={provider}
            onValueChange={handleProviderChange}
            options={PROVIDER_SELECT_OPTIONS}
            placeholder="选择供应商"
          />
          <SettingsInput
            label="供应商名称"
            value={name}
            onChange={setName}
            placeholder="例如: My Anthropic"
            required
          />
          <SettingsInput
            label={getUrlInputLabel(provider)}
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={getUrlInputPlaceholder(provider)}
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
                'flex items-start gap-1.5 text-xs',
                testResult.success ? 'text-emerald-600' : 'text-destructive'
              )}>
                {testResult.success
                  ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                  : <XCircle size={12} className="mt-0.5 shrink-0" />}
                <span className="min-w-0 break-all">{testResult.message}</span>
              </div>
            )}
          </div>
          <SettingsToggle
            label="启用此配置"
            description="关闭后该配置的模型不会在选择列表中出现"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 已启用模型 */}
      <SettingsSection
        title="已启用模型"
        description={enabledModels.length > 0 ? `${enabledModels.length} 个模型` : undefined}
      >
        <SettingsCard divided={false}>
          {enabledModels.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              还没有启用任何模型，从下方可用模型中选择
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {enabledModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-2 px-4 py-2.5 group"
                >
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  <span className="text-sm text-foreground flex-1">
                    {model.name}
                    {model.name !== model.id && (
                      <span className="text-muted-foreground ml-1">({model.id})</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleModel(model.id)}
                    className="p-0.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="取消启用"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* 可用模型 */}
      <SettingsSection
        title="可用模型"
        action={
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
          {models.filter((m) => !m.enabled).length > 5 && (
            <div className="px-4 pt-3 pb-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="搜索可用模型..."
                  className="h-8 text-sm pl-8"
                />
              </div>
            </div>
          )}

          {/* 可用模型计数 */}
          {models.filter((m) => !m.enabled).length > 0 && (
            <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
              {modelFilter.trim()
                ? `${availableModels.length} / ${models.filter((m) => !m.enabled).length} 个可用模型`
                : `${models.filter((m) => !m.enabled).length} 个可用模型`}
            </div>
          )}

          <ScrollArea className={availableModels.length > 8 ? 'h-[280px]' : undefined}>
            <div className="divide-y divide-border/50">
              {availableModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-2 px-4 py-2.5 group cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleToggleModel(model.id)}
                >
                  <Plus size={14} className="text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground flex-1">
                    {model.name}
                    {model.name !== model.id && (
                      <span className="text-muted-foreground ml-1">({model.id})</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveModel(model.id) }}
                    className="p-0.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              {/* 搜索无结果提示 */}
              {modelFilter.trim() && availableModels.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  未找到匹配的模型
                </div>
              )}

              {/* 无可用模型提示 */}
              {!modelFilter.trim() && models.filter((m) => !m.enabled).length === 0 && models.length > 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  所有模型已启用
                </div>
              )}
            </div>
          </ScrollArea>

          {/* 手动添加模型 */}
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
        </SettingsCard>
      </SettingsSection>

      {/* 退出拦截弹窗 */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              {hasNoModels
                ? '当前尚未配置模型，建议先配置模型再保存。'
                : '您填写的内容尚未保存，确定要放弃编辑吗？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscard}>放弃编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSaveAndClose}
              disabled={saving || !name.trim() || !apiKey.trim()}
            >
              {saving ? <><Loader2 size={14} className="animate-spin" /> 保存中...</> : '保存并关闭'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
