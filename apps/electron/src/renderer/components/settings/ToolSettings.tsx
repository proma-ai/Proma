/**
 * ToolSettings - 工具设置页
 *
 * Chat 模式工具统一管理 tab。
 * 管理联网搜索与可选工具配置。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2, RefreshCw, Info, ShieldCheck, Terminal } from 'lucide-react'
import type { CuaDriverDetectionResult, CuaDriverRuntimeSource } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'
import { cn } from '@/lib/utils'

/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[ToolSettings] 刷新工具列表失败:', err)
  }
}

interface DesktopControlFormState {
  enabled: boolean
  cuaDriverPath: string
  startupTimeoutSec: number
}

function desktopControlFormState(settings: Awaited<ReturnType<typeof window.electronAPI.getSettings>>): DesktopControlFormState {
  const storedPath = settings.desktopAutomation?.cuaDriver?.path?.trim()
  return {
    enabled: settings.desktopAutomation?.enabled === true,
    cuaDriverPath: storedPath && storedPath !== 'cua-driver' ? storedPath : '',
    startupTimeoutSec: settings.desktopAutomation?.cuaDriver?.startupTimeoutSec ?? 15,
  }
}

const CUA_DRIVER_SOURCE_LABELS: Record<CuaDriverRuntimeSource, string> = {
  env: '环境变量',
  configured: '手动路径',
  bundled: '内置 cua-driver',
  'user-local': '用户目录',
  path: '系统 PATH',
}

function cuaDriverDetectionSummary(result: CuaDriverDetectionResult): string {
  if (!result.cli.ok) return `cua-driver 不可用：${result.cli.error ?? '未找到可执行文件'}`
  if (!result.manifest.ok) return `cua-driver 可运行，但 manifest 不可读：${result.manifest.error ?? '状态未知'}`
  if (!result.mcp.ok) return `cua-driver MCP 工具面异常：${result.mcp.error ?? '状态未知'}`
  return `检测通过：已发现 ${result.mcp.toolCount} 个桌面控制工具`
}

function CuaDriverDetectionStatus({ result }: { result: CuaDriverDetectionResult }): React.ReactElement {
  const statusClass = result.ok
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-destructive/20 bg-destructive/10 text-destructive'
  const previewTools = result.mcp.tools.slice(0, 8).map((tool) => tool.name)

  return (
    <div className={cn('rounded-lg border p-3 text-sm', statusClass)}>
      <div className="flex items-start gap-2">
        {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium">{cuaDriverDetectionSummary(result)}</div>
          <div className="space-y-1 text-xs opacity-90">
            <p className="break-all">
              cua-driver: {result.cli.version || '版本未知'} · {CUA_DRIVER_SOURCE_LABELS[result.cli.source]} · {result.cli.path}
            </p>
            {result.manifest.ok && (
              <p>
                MCP: {result.manifest.mcpCommand || 'cua-driver'} {(result.manifest.mcpArgs ?? ['mcp']).join(' ')}
              </p>
            )}
            {previewTools.length > 0 && (
              <p>工具: {previewTools.join('、')}{result.mcp.toolCount > previewTools.length ? ' ...' : ''}</p>
            )}
          </div>
          {result.hints.length > 0 && (
            <div className="space-y-1 text-xs opacity-90">
              {result.hints.map((hint, index) => (
                <p key={`${index}-${hint}`}>{hint}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 桌面控制后端设置区域 */
function DesktopControlSettings(): React.ReactElement {
  const [state, setState] = React.useState<DesktopControlFormState>({
    enabled: false,
    cuaDriverPath: '',
    startupTimeoutSec: 15,
  })
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [detecting, setDetecting] = React.useState(false)
  const [detection, setDetection] = React.useState<CuaDriverDetectionResult | null>(null)
  const savedRef = React.useRef(state)

  React.useEffect(() => {
    window.electronAPI.getSettings()
      .then((settings) => {
        const next = desktopControlFormState(settings)
        setState(next)
        savedRef.current = next
      })
      .catch((error: unknown) => {
        console.error('[桌面控制设置] 加载失败:', error)
        toast.error('桌面控制设置加载失败')
      })
      .finally(() => setLoading(false))
  }, [])

  const persist = React.useCallback(async (next: DesktopControlFormState, showToast = true): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.electronAPI.updateSettings({
        desktopAutomation: {
          enabled: next.enabled,
          cuaDriver: {
            path: next.cuaDriverPath.trim() || undefined,
            startupTimeoutSec: next.startupTimeoutSec,
          },
        },
      })
      const persisted = desktopControlFormState(saved)
      setState(persisted)
      savedRef.current = persisted
      if (showToast) toast.success('桌面控制设置已保存')
    } catch (error) {
      console.error('[桌面控制设置] 保存失败:', error)
      setState(savedRef.current)
      toast.error('桌面控制设置保存失败')
    } finally {
      setSaving(false)
    }
  }, [])

  const handleEnabledChange = (checked: boolean): void => {
    const next = { ...state, enabled: checked }
    setState(next)
    void persist(next)
  }

  const handlePathBlur = (): void => {
    const next = { ...state, cuaDriverPath: state.cuaDriverPath.trim() }
    if (next.cuaDriverPath === savedRef.current.cuaDriverPath) return
    setState(next)
    void persist(next)
  }

  const handleTimeoutBlur = (): void => {
    const normalized = Math.max(5, Math.min(60, Math.floor(state.startupTimeoutSec || 15)))
    const next = { ...state, startupTimeoutSec: normalized }
    if (next.startupTimeoutSec === savedRef.current.startupTimeoutSec) return
    setState(next)
    void persist(next, false)
  }

  const handleDetectCuaDriver = async (): Promise<void> => {
    setDetecting(true)
    setDetection(null)
    try {
      const next = {
        ...state,
        cuaDriverPath: state.cuaDriverPath.trim(),
        startupTimeoutSec: Math.max(5, Math.min(60, Math.floor(state.startupTimeoutSec || 15))),
      }
      if (
        next.enabled !== savedRef.current.enabled
        || next.cuaDriverPath !== savedRef.current.cuaDriverPath
        || next.startupTimeoutSec !== savedRef.current.startupTimeoutSec
      ) {
        await persist(next, false)
      }
      const result = await window.electronAPI.detectCuaDriver()
      setDetection(result)
      if (result.ok) toast.success('Cua Driver 检测通过')
      else toast.error('Cua Driver 检测未通过')
    } catch (error) {
      console.error('[Cua Driver 检测] 失败:', error)
      toast.error(error instanceof Error ? error.message : 'Cua Driver 检测失败')
    } finally {
      setDetecting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="桌面控制"
      description="让 Agent 操作本机窗口、桌面软件和系统文件选择框"
      action={
        <Switch
          checked={state.enabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <Info size={15} />
              <span>{state.enabled ? '当前启用 Cua Driver 桌面控制' : '当前未向 Agent 开放桌面控制'}</span>
            </div>
            <p>
              开启后，Agent 会通过内置 Cua Driver 读取窗口、点击桌面应用、输入文本和发送快捷键。它适合处理非网页软件、系统文件上传窗口、ERP/客户端表单等任务。
            </p>
            <p className="text-xs">
              这项能力可以影响你电脑上的其他应用，默认关闭。建议先用一键检测确认可用，再在可信任务中开启。
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck size={15} />
                <span>Cua Driver 准备状态</span>
              </div>
              <p className="text-xs text-muted-foreground">
                检测不会执行点击或输入，只确认 cua-driver 可运行，并能暴露桌面控制 MCP 工具。
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDetectCuaDriver}
              disabled={detecting || saving}
              className="shrink-0"
            >
              {detecting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCw size={14} className="mr-1.5" />}
              {detecting ? '检测中...' : '一键检测'}
            </Button>
          </div>

          {detection && <CuaDriverDetectionStatus result={detection} />}

          {state.enabled && (
            <div className="space-y-4 rounded-lg border border-border/50 p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Terminal size={15} />
                  <span>Cua Driver 高级设置</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  一般不需要填写路径。留空时会优先使用应用内置 cua-driver，其次查找用户目录和系统 PATH。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">cua-driver 命令路径</label>
                <Input
                  value={state.cuaDriverPath}
                  onChange={(event) => {
                    setDetection(null)
                    setState((current) => ({ ...current, cuaDriverPath: event.target.value }))
                  }}
                  onBlur={handlePathBlur}
                  placeholder="留空自动使用内置 cua-driver"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  只有需要覆盖内置版本时才填写，例如 C:\Users\你\.local\bin\cua-driver.exe。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">MCP 启动超时（秒）</label>
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={state.startupTimeoutSec}
                  onChange={(event) => {
                    setDetection(null)
                    setState((current) => ({ ...current, startupTimeoutSec: Number(event.target.value) }))
                  }}
                  onBlur={handleTimeoutBlur}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  默认 15 秒。旧电脑或首次启动较慢时可调高，避免 Agent 会话启动时过早跳过桌面控制。
                </p>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** 联网搜索工具设置区域 */
function WebSearchSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setChatTools = useSetAtom(chatToolsAtom)

  // 已保存的 API Key（用于判断是否有变更）
  const savedApiKeyRef = React.useRef('')

  // 从主进程加载当前配置 + 凭据
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('web-search'),
    ]).then(([tools, credentials]) => {
      const searchTool = tools.find((t) => t.meta.id === 'web-search')
      if (searchTool) {
        setEnabled(searchTool.enabled)
      }
      if (credentials.apiKey) {
        setApiKey(credentials.apiKey)
        savedApiKeyRef.current = credentials.apiKey
      }
    }).catch((err: unknown) => {
      console.error('[联网搜索设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 静默保存 API Key（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed === savedApiKeyRef.current) return
    try {
      await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
      savedApiKeyRef.current = trimmed
      // 刷新全局工具列表（available 状态可能变化）
      await refreshChatTools(setChatTools)
      toast.success('联网搜索设置已保存')
    } catch (error) {
      console.error('[联网搜索设置] 保存失败:', error)
    }
  }, [apiKey, setChatTools])

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
    // 先保存可能的变更
    const trimmed = apiKey.trim()
    if (trimmed !== savedApiKeyRef.current) {
      try {
        await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
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

  return (
    <SettingsSection
      title="联网搜索"
      description="启用后 AI 可以实时搜索互联网获取最新信息"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>联网搜索由 <span className="font-medium text-foreground">Tavily</span> 提供，启用后 AI 可以搜索互联网获取实时信息。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Tavily 官网
                  <ExternalLink size={10} />
                </a>
                {' '}注册账号
              </li>
              <li>在控制台获取 API Key（免费额度每月 1000 次搜索）</li>
              <li>将 API Key 填入下方，然后开启开关</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
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

  /** 静默保存凭据（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey === saved.apiKey && current.baseUrl === saved.baseUrl && current.model === saved.model) return
    try {
      await window.electronAPI.updateChatToolCredentials('nano-banana', current)
      savedCredentialsRef.current = current
      await refreshChatTools(setChatTools)
      toast.success('Nano Banana 设置已保存')
    } catch (error) {
      console.error('[Nano Banana 设置] 保存失败:', error)
    }
  }, [apiKey, baseUrl, model, setChatTools])

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
    // 先保存可能的变更
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey !== saved.apiKey || current.baseUrl !== saved.baseUrl || current.model !== saved.model) {
      try {
        await window.electronAPI.updateChatToolCredentials('nano-banana', current)
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

  return (
    <SettingsSection
      title="Nano Banana"
      description="启用后 AI 可以生成和编辑图片（基于 Gemini Image Generation）"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>Nano Banana 基于 <span className="font-medium text-foreground">Gemini Image Generation</span> 提供 AI 图片生成与编辑能力。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Google AI Studio
                  <ExternalLink size={10} />
                </a>
                {' '}获取 Gemini API Key
              </li>
              <li>将 API Key 填入下方，可选修改 API 地址和模型</li>
              <li>开启开关即可在对话中使用生图能力</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
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
  const desktopControlRef = React.useRef<HTMLDivElement>(null)
  const webSearchRef = React.useRef<HTMLDivElement>(null)
  const nanoBananaRef = React.useRef<HTMLDivElement>(null)
  const customToolsRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!focusedTool) return
    const refs: Record<ToolSettingsFocus, React.RefObject<HTMLDivElement>> = {
      'desktop-control': desktopControlRef,
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
      {/* 桌面控制 */}
      <div ref={desktopControlRef}>
        <DesktopControlSettings />
      </div>

      {/* 联网搜索工具 */}
      <div ref={webSearchRef}>
        <WebSearchSettings />
      </div>

      {/* Nano Banana 生图工具 */}
      <div ref={nanoBananaRef}>
        <NanoBananaSettings />
      </div>

      {/* 自定义工具 */}
      <div ref={customToolsRef}>
        <CustomToolsSection />
      </div>

    </div>
  )
}
