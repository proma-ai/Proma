/**
 * ToolSettings - 工具设置页
 *
 * Chat 模式工具统一管理 tab。
 * 内嵌 MemorySettings（记忆工具）+ 联网搜索工具配置。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2, Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MemorySettings } from './MemorySettings'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'

/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[ToolSettings] 刷新工具列表失败:', err)
  }
}

/** 联网搜索工具设置区域 */
function WebSearchSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  /** 是否为 Proma Cloud 商业版用户（有云端能力可用） */
  const [cloudAvailable, setCloudAvailable] = React.useState(false)
  /** 用户是否选择使用 Proma Cloud 提供（默认 true） */
  const [useCloud, setUseCloud] = React.useState(true)
  const setChatTools = useSetAtom(chatToolsAtom)

  const savedApiKeyRef = React.useRef('')

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('web-search'),
    ]).then(([tools, credentials]) => {
      const searchTool = tools.find((t) => t.meta.id === 'web-search')
      if (searchTool) setEnabled(searchTool.enabled)
      if (credentials.apiKey) {
        setApiKey(credentials.apiKey)
        savedApiKeyRef.current = credentials.apiKey
      }
      const isCloud = credentials.cloudMode === 'true'
      setCloudAvailable(isCloud)
      setUseCloud(isCloud && credentials.useCloud !== 'false')
    }).catch((err: unknown) => {
      console.error('[联网搜索设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 切换"使用 Proma Cloud" */
  const handleCloudToggle = async (checked: boolean): Promise<void> => {
    setUseCloud(checked)
    setTestResult(null)
    try {
      const creds: Record<string, string> = {
        cloudMode: 'true',
        useCloud: checked ? 'true' : 'false',
      }
      // 关闭云端时保留已输入的 apiKey
      if (!checked && apiKey.trim()) creds.apiKey = apiKey.trim()
      await window.electronAPI.updateChatToolCredentials('web-search', creds)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[联网搜索设置] 切换云端失败:', error)
    }
  }

  /** 静默保存 API Key（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed === savedApiKeyRef.current) return
    try {
      const creds: Record<string, string> = { apiKey: trimmed }
      // 云端用户关闭了 useCloud 后手动输入 apiKey，需要保留 cloudMode
      if (cloudAvailable) {
        creds.cloudMode = 'true'
        creds.useCloud = 'false'
      }
      await window.electronAPI.updateChatToolCredentials('web-search', creds)
      savedApiKeyRef.current = trimmed
      await refreshChatTools(setChatTools)
      toast.success('联网搜索设置已保存')
    } catch (error) {
      console.error('[联网搜索设置] 保存失败:', error)
    }
  }, [apiKey, cloudAvailable, setChatTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('web-search', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[联网搜索设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed !== savedApiKeyRef.current) {
      try {
        const creds: Record<string, string> = { apiKey: trimmed }
        if (cloudAvailable) { creds.cloudMode = 'true'; creds.useCloud = 'false' }
        await window.electronAPI.updateChatToolCredentials('web-search', creds)
        savedApiKeyRef.current = trimmed
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[联网搜索设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('web-search')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  /** 实际使用云端 = 云端可用 + 用户选择使用 */
  const isUsingCloud = cloudAvailable && useCloud

  return (
    <SettingsSection
      title="联网搜索"
      description="启用后 AI 可以实时搜索互联网获取最新信息"
      action={
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 云端用户：显示 Proma Cloud 开关 */}
          {cloudAvailable && (
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Cloud size={14} className="shrink-0" />
                <span className="font-medium">使用 Proma Cloud 提供</span>
                {isUsingCloud && <span className="text-xs opacity-70">0.13 积分/次</span>}
              </div>
              <Switch checked={useCloud} onCheckedChange={handleCloudToggle} />
            </div>
          )}

          {isUsingCloud ? (
            <p className="text-xs text-muted-foreground">
              由 Proma 统一提供联网搜索能力，无需配置 API Key，搜索费用从账户余额扣除。
            </p>
          ) : (
            <>
              {/* 本地模式 / 云端用户关闭后：显示 API Key 输入 */}
              {!cloudAvailable && (
                <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
                  <p>联网搜索由 <span className="font-medium text-foreground">Tavily</span> 提供，启用后 AI 可以搜索互联网获取实时信息。</p>
                  <p className="text-xs">配置步骤：</p>
                  <ol className="text-xs list-decimal list-inside space-y-1">
                    <li>
                      访问{' '}
                      <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                        Tavily 官网<ExternalLink size={10} />
                      </a>
                      {' '}注册账号
                    </li>
                    <li>在控制台获取 API Key（免费额度每月 1000 次搜索）</li>
                    <li>将 API Key 填入下方，然后开启开关</li>
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Tavily API Key</label>
                  <Button size="sm" variant="outline" disabled={testing || !apiKey.trim()} onClick={handleTest}>
                    {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="tvly-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={handleBlurSave}
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
              </div>

              {testResult && (
                <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                  {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** Nano Banana 生图工具设置区域 */
function NanoBananaSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [model, setModel] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  /** 是否为 Proma Cloud 商业版用户 */
  const [cloudAvailable, setCloudAvailable] = React.useState(false)
  /** 用户是否选择使用 Proma Cloud 提供（默认 true） */
  const [useCloud, setUseCloud] = React.useState(true)
  const setChatTools = useSetAtom(chatToolsAtom)

  const savedCredentialsRef = React.useRef({ apiKey: '', baseUrl: '', model: '' })

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('nano-banana'),
    ]).then(([tools, credentials]) => {
      const tool = tools.find((t) => t.meta.id === 'nano-banana')
      if (tool) setEnabled(tool.enabled)
      if (credentials.apiKey) setApiKey(credentials.apiKey)
      if (credentials.baseUrl) setBaseUrl(credentials.baseUrl)
      if (credentials.model) setModel(credentials.model)
      const isCloud = credentials.cloudMode === 'true'
      setCloudAvailable(isCloud)
      setUseCloud(isCloud && credentials.useCloud !== 'false')
      savedCredentialsRef.current = {
        apiKey: credentials.apiKey || '',
        baseUrl: credentials.baseUrl || '',
        model: credentials.model || '',
      }
    }).catch((err: unknown) => {
      console.error('[Nano Banana 设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 切换"使用 Proma Cloud" */
  const handleCloudToggle = async (checked: boolean): Promise<void> => {
    setUseCloud(checked)
    setTestResult(null)
    try {
      const creds: Record<string, string> = {
        cloudMode: 'true',
        useCloud: checked ? 'true' : 'false',
        model: model || 'gemini-3.1-flash-image-preview',
      }
      // 关闭云端时保留已输入的本地凭据
      if (!checked) {
        if (apiKey.trim()) creds.apiKey = apiKey.trim()
        if (baseUrl.trim()) creds.baseUrl = baseUrl.trim()
      }
      await window.electronAPI.updateChatToolCredentials('nano-banana', creds)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[Nano Banana 设置] 切换云端失败:', error)
    }
  }

  /** 静默保存凭据（blur 时触发，仅本地模式） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey === saved.apiKey && current.baseUrl === saved.baseUrl && current.model === saved.model) return
    try {
      const creds: Record<string, string> = { ...current }
      if (cloudAvailable) {
        creds.cloudMode = 'true'
        creds.useCloud = 'false'
      }
      await window.electronAPI.updateChatToolCredentials('nano-banana', creds)
      savedCredentialsRef.current = current
      await refreshChatTools(setChatTools)
      toast.success('Nano Banana 设置已保存')
    } catch (error) {
      console.error('[Nano Banana 设置] 保存失败:', error)
    }
  }, [apiKey, baseUrl, model, cloudAvailable, setChatTools])

  /** 云端模式下切换模型（立即保存） */
  const handleCloudModelChange = async (value: string): Promise<void> => {
    setModel(value)
    try {
      await window.electronAPI.updateChatToolCredentials('nano-banana', {
        cloudMode: 'true',
        useCloud: 'true',
        model: value,
      })
      savedCredentialsRef.current = { ...savedCredentialsRef.current, model: value }
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[Nano Banana 设置] 保存模型失败:', error)
    }
  }

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('nano-banana', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[Nano Banana 设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey !== saved.apiKey || current.baseUrl !== saved.baseUrl || current.model !== saved.model) {
      try {
        const creds: Record<string, string> = { ...current }
        if (cloudAvailable) { creds.cloudMode = 'true'; creds.useCloud = 'false' }
        await window.electronAPI.updateChatToolCredentials('nano-banana', creds)
        savedCredentialsRef.current = current
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[Nano Banana 设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('nano-banana')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  const isUsingCloud = cloudAvailable && useCloud

  return (
    <SettingsSection
      title="Nano Banana"
      description="启用后 AI 可以生成和编辑图片（基于 Gemini Image Generation）"
      action={
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 云端用户：显示 Proma Cloud 开关 */}
          {cloudAvailable && (
            <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-primary">
                <Cloud size={14} className="shrink-0" />
                <span className="font-medium">使用 Proma Cloud 提供</span>
              </div>
              <Switch checked={useCloud} onCheckedChange={handleCloudToggle} />
            </div>
          )}

          {isUsingCloud ? (
            // 云端模式内容
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-sm">计费说明（积分）</p>
                <p><span className="font-medium text-foreground">Nano Banana 2</span>（Flash）：auto 0.78 · 1K 0.78 · 2K 1.17 · 4K 1.56</p>
                <p><span className="font-medium text-foreground">Nano Banana Pro</span>：auto 1.17 · 1K 1.17 · 2K 1.17 · 4K 2.34</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">模型</label>
                <Select value={model || 'gemini-3.1-flash-image-preview'} onValueChange={handleCloudModelChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="gemini-3.1-flash-image-preview">
                      <div className="text-left">
                        <div className="font-medium">Nano Banana 2</div>
                        <div className="text-xs text-muted-foreground">auto 0.78 · 1K 0.78 · 2K 1.17 · 4K 1.56 积分</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="gemini-3-pro-image-preview">
                      <div className="text-left">
                        <div className="font-medium">Nano Banana Pro</div>
                        <div className="text-xs text-muted-foreground">auto 1.17 · 1K 1.17 · 2K 1.17 · 4K 2.34 积分</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            // 本地模式内容
            <>
              {!cloudAvailable && (
                <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
                  <p>Nano Banana 基于 <span className="font-medium text-foreground">Gemini Image Generation</span> 提供 AI 图片生成与编辑能力。</p>
                  <p className="text-xs">配置步骤：</p>
                  <ol className="text-xs list-decimal list-inside space-y-1">
                    <li>
                      访问{' '}
                      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                        Google AI Studio<ExternalLink size={10} />
                      </a>
                      {' '}获取 Gemini API Key
                    </li>
                    <li>将 API Key 填入下方，可选修改 API 地址和模型</li>
                    <li>开启开关即可在对话中使用生图能力</li>
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">API Key</label>
                  <Button size="sm" variant="outline" disabled={testing || !apiKey.trim()} onClick={handleTest}>
                    {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="AIza..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onBlur={handleBlurSave}
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
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">API 地址</label>
                <Input
                  type="text"
                  placeholder="https://generativelanguage.googleapis.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={handleBlurSave}
                />
                <p className="text-xs text-muted-foreground">留空则使用 Gemini 官方地址</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">模型</label>
                <Input
                  type="text"
                  placeholder="gemini-3.1-flash-image-preview"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={handleBlurSave}
                />
                <p className="text-xs text-muted-foreground">留空则使用默认模型 gemini-3.1-flash-image-preview</p>
              </div>

              {testResult && (
                <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                  {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** [Proma Cloud] GPT Image 2 生图工具设置区域（仅云端模式） */
function GptImage2Settings(): React.ReactElement {
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [cloudAvailable, setCloudAvailable] = React.useState(false)
  const setChatTools = useSetAtom(chatToolsAtom)

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('gpt-image-2'),
    ]).then(([tools, credentials]) => {
      const tool = tools.find((t) => t.meta.id === 'gpt-image-2')
      if (tool) setEnabled(tool.enabled)
      setCloudAvailable(credentials.cloudMode === 'true')
    }).catch((err: unknown) => {
      console.error('[GPT Image 2 设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('gpt-image-2', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[GPT Image 2 设置] 切换失败:', error)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  if (!cloudAvailable) {
    return (
      <SettingsSection
        title="GPT Image 2"
        description="AI 图片生成与编辑（仅 Proma Cloud 用户可用）"
      >
        <SettingsCard divided={false}>
          <div className="p-4">
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 mb-1">
                <Cloud size={14} className="shrink-0" />
                <span className="font-medium text-foreground">仅限 Proma Cloud 用户</span>
              </div>
              <p className="text-xs">GPT Image 2 图片生成功能需要通过 Proma Cloud 提供，请确认您已登录 Proma 云端账户。</p>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection
      title="GPT Image 2"
      description="启用后 AI 可以使用 GPT Image 2 生成和编辑图片（通过 Proma Cloud）"
      action={
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
            <Cloud size={14} className="shrink-0" />
            <span className="font-medium">通过 Proma Cloud 提供</span>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">计费说明（积分/张）</p>
            <p><span className="font-medium text-foreground">Low</span>：1024 系列 0.08-0.09 · 2K/4K 0.37</p>
            <p><span className="font-medium text-foreground">Medium</span>：1024 系列 0.64-0.83 · 2K/4K 3.31</p>
            <p><span className="font-medium text-foreground">High</span>：1024 系列 2.57-3.29 · 2K/4K 13.17</p>
            <p className="text-xs text-muted-foreground/80 mt-1">支持 7 种尺寸：1024×1024/1024×1536/1536×1024/2048×2048/2048×1152/3840×2160/2160×3840</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** 自定义工具列表区域 */
function CustomToolsSection(): React.ReactElement | null {
  const tools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)

  const customTools = tools.filter((t) => t.meta.category === 'custom')
  if (customTools.length === 0) return null

  const handleToggle = async (toolId: string, checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState(toolId, { enabled: checked })
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[自定义工具] 切换失败:', error)
    }
  }

  const handleDelete = async (toolId: string, toolName: string): Promise<void> => {
    try {
      await window.electronAPI.deleteCustomChatTool(toolId)
      await refreshChatTools(setChatTools)
      toast.success(`已删除工具: ${toolName}`)
    } catch (error) {
      console.error('[自定义工具] 删除失败:', error)
      toast.error('删除工具失败')
    }
  }

  return (
    <SettingsSection
      title="自定义工具"
      description="通过 Agent 模式创建的 HTTP API 工具"
    >
      <SettingsCard divided>
        {customTools.map((tool) => (
          <div key={tool.meta.id} className="flex items-center justify-between p-4">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.meta.name}</span>
                {tool.meta.httpConfig && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {tool.meta.httpConfig.method}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {tool.meta.description}
              </p>
              {tool.meta.httpConfig && (
                <p className="text-xs text-muted-foreground/60 mt-0.5 truncate font-mono">
                  {tool.meta.httpConfig.urlTemplate}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={tool.enabled}
                onCheckedChange={(checked) => handleToggle(tool.meta.id, checked)}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(tool.meta.id, tool.meta.name)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

export function ToolSettings(): React.ReactElement {
  const [focusedTool, setFocusedTool] = useAtom(toolSettingsFocusAtom)
  const memoryRef = React.useRef<HTMLDivElement>(null)
  const webSearchRef = React.useRef<HTMLDivElement>(null)
  const nanoBananaRef = React.useRef<HTMLDivElement>(null)
  const customToolsRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!focusedTool) return
    const refs: Record<ToolSettingsFocus, React.RefObject<HTMLDivElement>> = {
      memory: memoryRef,
      'web-search': webSearchRef,
      'nano-banana': nanoBananaRef,
      'custom-tools': customToolsRef,
    }
    window.requestAnimationFrame(() => {
      refs[focusedTool].current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setFocusedTool(null)
    })
  }, [focusedTool, setFocusedTool])

  return (
    <div className="space-y-8">
      {/* 记忆工具（复用现有 MemorySettings 组件） */}
      <div ref={memoryRef}>
        <MemorySettings />
      </div>

      {/* 联网搜索工具 */}
      <div ref={webSearchRef}>
        <WebSearchSettings />
      </div>

      {/* Nano Banana 生图工具 */}
      <div ref={nanoBananaRef}>
        <NanoBananaSettings />
      </div>

      {/* [Proma Cloud] GPT Image 2 生图工具 */}
      <GptImage2Settings />

      {/* 自定义工具 */}
      <div ref={customToolsRef}>
        <CustomToolsSection />
      </div>
    </div>
  )
}
