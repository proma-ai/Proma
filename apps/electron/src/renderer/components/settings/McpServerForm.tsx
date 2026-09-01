/**
 * McpServerForm - MCP 服务器创建/编辑表单
 *
 * 支持 stdio / http / sse 三种传输类型，
 * 复用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpServerEntry, McpTransportType, WorkspaceMcpConfig } from '@proma/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'

/** 编辑中的服务器 */
interface EditingServer {
  name: string
  entry: McpServerEntry
}

interface McpServerFormProps {
  /** 编辑模式传入已有服务器，创建模式传 null */
  server: EditingServer | null
  /** 当前工作区 slug */
  workspaceSlug: string
  onSaved: () => void
  onChanged?: () => void | Promise<void>
  onCancel: () => void | Promise<void>
  /** 外部详情页请求关闭的递增标记；表单会先 flush 自动保存再触发 onCancel。 */
  closeRequestId?: number
  /** 由 MCP 内部详情页托管标题与返回操作时隐藏表单标题栏。 */
  showHeader?: boolean
}

/** 传输类型选项 */
const TRANSPORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'stdio', label: 'stdio（命令行）' },
  { value: 'http', label: 'HTTP（Streamable HTTP）' },
  { value: 'sse', label: 'SSE（Server-Sent Events）' },
]

/**
 * 解析多行文本为 key=value / key: value 的 Record
 *
 * 支持：
 * - KEY=VALUE（环境变量格式）
 * - Key: Value（HTTP 头格式）
 */
function parseKeyValueText(text: string, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(separator)
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * 将 Record 序列化为多行 key=value / key: value 文本
 */
function serializeKeyValueText(record: Record<string, string> | undefined, separator: '=' | ':'): string {
  if (!record) return ''
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator}${separator === ':' ? ' ' : ''}${value}`)
    .join('\n')
}

interface McpFormValues {
  transportType: McpTransportType
  enabled: boolean
  testResult: { success: boolean; message: string; timestamp?: number } | null
  isBuiltin: boolean
  command: string
  argsText: string
  envText: string
  timeoutStr: string
  url: string
  headersText: string
}

/** 根据当前表单值构建 McpServerEntry */
function buildEntryFromValues(values: McpFormValues, includeTestResult = false): McpServerEntry {
  const base: McpServerEntry = {
    type: values.transportType,
    enabled: values.enabled,
    ...(values.isBuiltin && { isBuiltin: true }),
    ...(includeTestResult && values.testResult && {
      lastTestResult: {
        ...values.testResult,
        timestamp: values.testResult.timestamp ?? Date.now(),
      },
    }),
  }

  if (values.transportType === 'stdio') {
    base.command = values.command.trim()
    const args = values.argsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (args.length > 0) base.args = args
    const env = parseKeyValueText(values.envText, '=')
    if (Object.keys(env).length > 0) base.env = env
    const timeout = parseInt(values.timeoutStr, 10)
    if (!isNaN(timeout) && timeout > 0) base.timeout = timeout
  } else {
    base.url = values.url.trim()
    const headers = parseKeyValueText(values.headersText, ':')
    if (Object.keys(headers).length > 0) base.headers = headers
  }

  return base
}

export function McpServerForm({ server, workspaceSlug, onSaved, onChanged, onCancel, closeRequestId, showHeader = true }: McpServerFormProps): React.ReactElement {
  const isEdit = server !== null
  const isBuiltin = server?.entry.isBuiltin === true

  // 表单状态
  const [name, setName] = React.useState(server?.name ?? '')
  const [transportType, setTransportType] = React.useState<McpTransportType>(server?.entry.type ?? 'stdio')
  const [enabled, setEnabled] = React.useState(server?.entry.enabled ?? false) // 默认关闭
  const explicitlyDisabledRef = React.useRef(false)
  // Strict Mode 会重复执行 mount effect；只有真实用户操作才能解锁自动保存，
  // 以保证“查看配置”不会触发 SAVE_MCP_CONFIG → 禁用 → 验证 → 重启用。
  const hasUserEditedRef = React.useRef(false)
  const markUserEdited = React.useCallback((): void => {
    hasUserEditedRef.current = true
  }, [])
  const handleEnabledChange = React.useCallback((nextEnabled: boolean): void => {
    markUserEdited()
    if (!nextEnabled) explicitlyDisabledRef.current = true
    setEnabled(nextEnabled)
  }, [markUserEdited])

  // stdio 字段
  const [command, setCommand] = React.useState(server?.entry.command ?? '')
  const [argsText, setArgsText] = React.useState(server?.entry.args?.join(', ') ?? '')
  const [envText, setEnvText] = React.useState(serializeKeyValueText(server?.entry.env, '='))
  const [timeoutStr, setTimeoutStr] = React.useState(
    server?.entry.timeout != null ? String(server.entry.timeout) : ''
  )

  // http/sse 字段
  const [url, setUrl] = React.useState(server?.entry.url ?? '')
  const [headersText, setHeadersText] = React.useState(serializeKeyValueText(server?.entry.headers, ':'))

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string; timestamp?: number } | null>(
    server?.entry.lastTestResult ?? null
  )

  // 自动保存状态（仅编辑模式）
  const AUTO_SAVE_DELAY = 600
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = React.useRef(true)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // 保留最新表单值，供 unmount 时 flush 待保存变更
  const latestValuesRef = React.useRef({
    name, transportType, command, url, argsText, envText, headersText, timeoutStr, enabled, testResult, isBuiltin,
  })
  React.useEffect(() => {
    latestValuesRef.current = {
      name, transportType, command, url, argsText, envText, headersText, timeoutStr, enabled, testResult, isBuiltin,
    }
  }, [name, transportType, command, url, argsText, envText, headersText, timeoutStr, enabled, testResult, isBuiltin])

  // 监听配置改变，清空测试结果（避免展示过期的测试结果）
  React.useEffect(() => {
    if (!server) return // 新建时不需要清空

    // 检查关键配置是否改变（包括连接相关的所有字段）
    // 注意：server.entry.command/url 可能为 undefined，需要与空字符串统一比较
    const configChanged =
      transportType !== server.entry.type ||
      (transportType === 'stdio' && command !== (server.entry.command ?? '')) ||
      (transportType !== 'stdio' && url !== (server.entry.url ?? '')) ||
      argsText !== (server.entry.args?.join(', ') ?? '') ||
      envText !== serializeKeyValueText(server.entry.env, '=') ||
      headersText !== serializeKeyValueText(server.entry.headers, ':')

    if (configChanged) {
      setTestResult(null)
    }
  }, [transportType, command, url, argsText, envText, headersText, server])

  /** 构建 McpServerEntry */
  const buildEntry = (includeTestResult = false): McpServerEntry => {
    return buildEntryFromValues(
      {
        transportType,
        enabled,
        testResult,
        isBuiltin,
        command,
        argsText,
        envText,
        timeoutStr,
        url,
        headersText,
      },
      includeTestResult,
    )
  }

  const saveGenerationRef = React.useRef(0)

  /** 执行自动保存 */
  const doSaveEntry = React.useCallback(async (serverName: string, entry: McpServerEntry) => {
    const generation = ++saveGenerationRef.current
    try {
      const config = await window.electronAPI.getWorkspaceMcpConfig(workspaceSlug)
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...config.servers, [serverName]: entry },
      }
      const options = explicitlyDisabledRef.current && !entry.enabled
        ? { explicitlyDisabledServerNames: [serverName] }
        : undefined
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig, options)
      if (generation === saveGenerationRef.current && mountedRef.current) {
        // 编辑抽屉外的 MCP 卡片使用独立快照；每次持久化后通知其局部重读，
        // 让测试结果无需离开再进入页面即可同步显示。
        await onChanged?.()
        setSaveStatus('saved')
        setTimeout(() => {
          if (generation === saveGenerationRef.current && mountedRef.current) {
            setSaveStatus('idle')
          }
        }, 3000)
      }
    } catch (error) {
      console.error('[MCP 表单] 自动保存失败:', error)
      if (generation === saveGenerationRef.current && mountedRef.current) {
        toast.error('自动保存失败')
        setSaveStatus('error')
      }
    }
  }, [workspaceSlug, onChanged])

  const doSaveEntryRef = React.useRef(doSaveEntry)
  React.useEffect(() => { doSaveEntryRef.current = doSaveEntry }, [doSaveEntry])

  // 编辑模式下监听配置字段变化，防抖自动保存。
  // 测试结果只展示在当前表单，不能触发完整 mcp.json 保存；后者会重新验证其他已启用 MCP。
  React.useEffect(() => {
    // 仅用户修改配置后保存；不要让详情预览的挂载（含 Strict Mode 二次 effect）写回配置。
    if (!isEdit || !hasUserEditedRef.current) return
    const serverName = name.trim()
    if (!serverName) return
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return
    setSaveStatus('idle')
    autoSaveTimerRef.current = setTimeout(() => {
      const vals = latestValuesRef.current
      const entry = buildEntryFromValues(vals, true)
      void doSaveEntryRef.current(vals.name.trim(), entry)
    }, AUTO_SAVE_DELAY)
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [
    isEdit,
    name,
    transportType,
    command,
    url,
    argsText,
    envText,
    headersText,
    timeoutStr,
    enabled,
  ])

  // Strict Mode 会执行一次 setup → cleanup → setup；每次 setup 都恢复 mounted 状态。
  // 正常“返回”会先走 handleCancel 的 await flush，再卸载，不依赖这里的异步兜底同步 UI。
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
        const vals = latestValuesRef.current
        const serverName = vals.name.trim()
        if (!serverName) return
        if (vals.transportType === 'stdio' && !vals.command.trim()) return
        if (vals.transportType !== 'stdio' && !vals.url.trim()) return
        const entry = buildEntryFromValues(vals, true)
        void doSaveEntryRef.current(serverName, entry)
      }
    }
  }, [])
  const handleTest = async (): Promise<void> => {
    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    setTesting(true)
    setTestResult(null)

    try {
      const entry = buildEntry(false) // 测试时不包含旧的测试结果
      const result = await window.electronAPI.testMcpServer(workspaceSlug, serverName, entry)
      // 连接测试是孤立诊断：不能被视为配置编辑而触发完整 mcp.json 保存。
      // 否则 SAVE_MCP_CONFIG 会重新验证全部已启用条目，造成其他 MCP 重连。
      setTestResult({
        success: result.success,
        message: result.message,
        timestamp: Date.now(),
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : '测试失败',
        timestamp: Date.now(),
      })
    } finally {
      setTesting(false)
    }
  }

  /** 提交表单（仅创建模式） */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (isEdit) return

    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    setSaving(true)
    try {
      // 读取现有配置
      const config = await window.electronAPI.getWorkspaceMcpConfig(workspaceSlug)
      const entry = buildEntry(true) // 保存时包含测试结果

      console.log(`[MCP 表单] 保存 MCP: ${serverName}, enabled: ${entry.enabled}, testResult: ${testResult?.success ?? '未测试'}`)

      const newConfig: WorkspaceMcpConfig = {
        servers: {
          ...config.servers,
          [serverName]: entry,
        },
      }
      await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      onSaved()
    } catch (error) {
      console.error('[MCP 表单] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  /** 判断表单是否可提交 */
  const canSubmit = (): boolean => {
    if (!name.trim()) return false
    if (transportType === 'stdio' && !command.trim()) return false
    if (transportType !== 'stdio' && !url.trim()) return false
    return true
  }

  /** 判断是否可以测试 */
  const canTest = (): boolean => {
    return canSubmit()
  }

  /** 返回/关闭：编辑模式下先 flush 待保存变更 */
  const handleCancel = React.useCallback(async (): Promise<void> => {
    if (isEdit && autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
      const vals = latestValuesRef.current
      const serverName = vals.name.trim()
      if (serverName) {
        const isValid =
          (vals.transportType === 'stdio' && vals.command.trim()) ||
          (vals.transportType !== 'stdio' && vals.url.trim())
        if (isValid) {
          const entry = buildEntryFromValues(vals, true)
          await doSaveEntryRef.current(serverName, entry)
        }
      }
    }
    await onCancel()
  }, [isEdit, onCancel])

  const handledCloseRequestRef = React.useRef(closeRequestId ?? 0)
  React.useEffect(() => {
    if (closeRequestId === undefined || closeRequestId === handledCloseRequestRef.current) return
    handledCloseRequestRef.current = closeRequestId
    void handleCancel()
  }, [closeRequestId, handleCancel])

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 标题栏 + 操作按钮。内部详情页已提供统一标题与返回入口。 */}
      {showHeader && (
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={() => void handleCancel()}>
            <ArrowLeft size={18} />
          </Button>
          <h3 className="text-lg font-medium text-foreground flex-1">
            {isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
          </h3>
          {isEdit && (saveStatus === 'saved' || saveStatus === 'error') && (
            <div className={cn(
              'flex items-center gap-1.5 text-xs',
              saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}>
              {saveStatus === 'saved' && <CheckCircle2 size={12} className="text-emerald-600" />}
              {saveStatus === 'error' && <XCircle size={12} />}
              <span>
                {saveStatus === 'saved' && '已保存'}
                {saveStatus === 'error' && '保存失败'}
              </span>
            </div>
          )}
          {!isEdit && (
            <Button size="sm" type="submit" disabled={saving || !canSubmit()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              <span>创建服务器</span>
            </Button>
          )}
        </div>
      )}

      {/* 基本信息 */}
      <SettingsSection title="基本信息">
        <SettingsCard>
          <SettingsInput
            label="服务器名称"
            value={name}
            onChange={(value) => { markUserEdited(); setName(value) }}
            placeholder="例如: github-mcp"
            required
            disabled={isEdit}
          />
          <SettingsSelect
            label="传输类型"
            value={transportType}
            onValueChange={(v) => { markUserEdited(); setTransportType(v as McpTransportType) }}
            options={TRANSPORT_OPTIONS}
            placeholder="选择传输类型"
            disabled={isBuiltin}
          />

          {/* stdio 专用字段 */}
          {transportType === 'stdio' && (
            <>
              <SettingsInput
                label="命令"
                value={command}
                onChange={(value) => { markUserEdited(); setCommand(value) }}
                placeholder="例如: npx"
                required
                disabled={isBuiltin}
              />
              <SettingsInput
                label="参数"
                value={argsText}
                onChange={(value) => { markUserEdited(); setArgsText(value) }}
                placeholder="逗号分隔，例如: -y, @modelcontextprotocol/server-github"
                description="多个参数用逗号分隔"
                disabled={isBuiltin}
              />
              {/* 环境变量多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className="text-sm font-medium text-foreground">环境变量</div>
                  <div className="text-xs text-muted-foreground mt-0.5">每行一个，格式: KEY=VALUE</div>
                </div>
                <textarea
                  value={envText}
                  onChange={(e) => { markUserEdited(); setEnvText(e.target.value) }}
                  placeholder="GITHUB_TOKEN=ghp_xxx&#10;DEBUG=true"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
                />
              </div>
              <SettingsInput
                label="启动超时（秒）"
                description="MCP 服务器启动的最大等待时间，默认 30 秒"
                value={timeoutStr}
                onChange={(value) => { markUserEdited(); setTimeoutStr(value) }}
                placeholder="30"
                type="number"
              />
            </>
          )}

          {/* http/sse 专用字段 */}
          {transportType !== 'stdio' && (
            <>
              <SettingsInput
                label="URL"
                value={url}
                onChange={(value) => { markUserEdited(); setUrl(value) }}
                placeholder="例如: http://localhost:3000/mcp"
                required
              />
              {/* 请求头多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className="text-sm font-medium text-foreground">请求头</div>
                  <div className="text-xs text-muted-foreground mt-0.5">每行一个，格式: Key: Value</div>
                </div>
                <textarea
                  value={headersText}
                  onChange={(e) => { markUserEdited(); setHeadersText(e.target.value) }}
                  placeholder="Authorization: Bearer xxx&#10;X-Custom-Header: value"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
                />
              </div>
            </>
          )}

          {/* 测试连接区域 */}
          <div className="px-4 py-3 space-y-3 border-t border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">连接测试</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  可选的诊断工具；测试结果不会影响 MCP 是否启用
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !canTest()}
              >
                {testing && <Loader2 size={14} className="animate-spin" />}
                <span>{testing ? '测试中...' : '测试连接'}</span>
              </Button>
            </div>

            {/* 测试结果显示 */}
            {testResult && (
              <div
                className={cn(
                  'flex items-start gap-2 px-3 py-2 rounded-md text-sm',
                  testResult.success
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'bg-red-500/10 text-red-700 dark:text-red-400'
                )}
              >
                {testResult.success ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {testResult.success ? '测试成功' : '测试失败'}
                  </div>
                  <div className="text-xs mt-0.5 opacity-90">{testResult.message}</div>
                </div>
              </div>
            )}

            {/* 未测试警告 */}
            {!testResult && !testing && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="text-xs">
                  尚未测试连接。如需排查配置，可以点击"测试连接"。
                </div>
              </div>
            )}
          </div>

          {/* 启用开关 */}
          <SettingsToggle
            label="启用此服务器"
            description={
              enabled
                ? '保存后会进行真实连接验证；仅验证成功才会在 Agent 会话中加载。'
                : '关闭时该 MCP 不会在 Agent 会话中加载。'
            }
            checked={enabled}
            onCheckedChange={handleEnabledChange}
          />
        </SettingsCard>
      </SettingsSection>
    </form>
  )
}
