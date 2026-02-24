/**
 * McpServerForm - MCP 服务器创建/编辑表单
 *
 * 支持 stdio / http / sse 三种传输类型，
 * 复用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
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
  onCancel: () => void
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

export function McpServerForm({ server, workspaceSlug, onSaved, onCancel }: McpServerFormProps): React.ReactElement {
  const isEdit = server !== null
  const isBuiltin = server?.entry.isBuiltin === true

  // 表单状态
  const [name, setName] = React.useState(server?.name ?? '')
  const [transportType, setTransportType] = React.useState<McpTransportType>(server?.entry.type ?? 'stdio')
  const [enabled, setEnabled] = React.useState(server?.entry.enabled ?? false) // 默认关闭

  // stdio 字段
  const [command, setCommand] = React.useState(server?.entry.command ?? '')
  const [argsText, setArgsText] = React.useState(server?.entry.args?.join(', ') ?? '')
  const [envText, setEnvText] = React.useState(serializeKeyValueText(server?.entry.env, '='))

  // http/sse 字段
  const [url, setUrl] = React.useState(server?.entry.url ?? '')
  const [headersText, setHeadersText] = React.useState(serializeKeyValueText(server?.entry.headers, ':'))

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    server?.entry.lastTestResult ?? null
  )

  // 监听配置改变，清空测试结果（避免使用过期的测试结果）
  React.useEffect(() => {
    if (!server) return // 新建时不需要清空

    // 检查关键配置是否改变（包括连接相关的所有字段）
    const configChanged =
      transportType !== server.entry.type ||
      (transportType === 'stdio' && command !== server.entry.command) ||
      (transportType !== 'stdio' && url !== server.entry.url) ||
      argsText !== (server.entry.args?.join(', ') ?? '') ||
      envText !== serializeKeyValueText(server.entry.env, '=') ||
      headersText !== serializeKeyValueText(server.entry.headers, ':')

    if (configChanged) {
      setTestResult(null)
      setEnabled(false) // 配置改变时自动关闭开关
    }
  }, [transportType, command, url, argsText, envText, headersText, server])

  /** 构建 McpServerEntry */
  const buildEntry = (includeTestResult = false): McpServerEntry => {
    const base: McpServerEntry = {
      type: transportType,
      // 关键保护：只有测试成功才能启用
      enabled: enabled && testResult?.success === true,
      // 保留内置标记
      ...(isBuiltin && { isBuiltin: true }),
      // 保存测试结果
      ...(includeTestResult && testResult && {
        lastTestResult: {
          ...testResult,
          timestamp: Date.now(),
        },
      }),
    }

    if (transportType === 'stdio') {
      base.command = command.trim()
      const args = argsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (args.length > 0) base.args = args
      const env = parseKeyValueText(envText, '=')
      if (Object.keys(env).length > 0) base.env = env
    } else {
      base.url = url.trim()
      const headers = parseKeyValueText(headersText, ':')
      if (Object.keys(headers).length > 0) base.headers = headers
    }

    return base
  }

  /** 测试连接 */
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
      const result = await window.electronAPI.testMcpServer(serverName, entry)
      setTestResult({
        success: result.success,
        message: result.message,
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : '测试失败',
      })
    } finally {
      setTesting(false)
    }
  }

  /** 提交表单 */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    // 警告：如果用户试图启用但测试未成功
    if (enabled && !testResult?.success) {
      console.warn('[MCP 表单] 用户试图启用未测试成功的 MCP，将强制禁用')
    }

    setSaving(true)
    try {
      // 读取现有配置
      const config = await window.electronAPI.getWorkspaceMcpConfig(workspaceSlug)
      const entry = buildEntry(true) // 保存时包含测试结果

      // 日志记录实际保存的状态
      console.log(`[MCP 表单] 保存 MCP: ${serverName}, enabled: ${entry.enabled}, testResult: ${testResult?.success}`)

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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 标题栏 + 操作按钮 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onCancel}>
          <ArrowLeft size={18} />
        </Button>
        <h3 className="text-lg font-medium text-foreground flex-1">
          {isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" type="submit" disabled={saving || !canSubmit()}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>{isEdit ? '保存修改' : '创建服务器'}</span>
          </Button>
        </div>
      </div>

      {/* 基本信息 */}
      <SettingsSection title="基本信息">
        <SettingsCard>
          {/* 内置 MCP 引导提示 */}
          {isBuiltin && (
            <div className="px-4 py-3 text-sm bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-md mx-4 mt-3">
              <div className="font-medium">内置记忆服务 (MemOS Cloud)</div>
              <div className="text-xs mt-1 opacity-90">
                前往 <a href="https://memos-dashboard.openmem.net/apikeys/" target="_blank" rel="noopener noreferrer" className="underline">memos-dashboard.openmem.net</a> 注册并获取 API Key 和 User ID，填入下方环境变量后启用。
              </div>
              <div className="text-xs mt-2 opacity-80 space-y-0.5">
                <div><code className="font-mono">MEMOS_API_KEY</code> — 你的 API 密钥，在控制台 API Keys 页面生成</div>
                <div><code className="font-mono">MEMOS_USER_ID</code> — 你的用户 ID，在控制台个人设置中查看</div>
              </div>
            </div>
          )}
          <SettingsInput
            label="服务器名称"
            value={name}
            onChange={setName}
            placeholder="例如: github-mcp"
            required
            disabled={isEdit}
          />
          <SettingsSelect
            label="传输类型"
            value={transportType}
            onValueChange={(v) => setTransportType(v as McpTransportType)}
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
                onChange={setCommand}
                placeholder="例如: npx"
                required
                disabled={isBuiltin}
              />
              <SettingsInput
                label="参数"
                value={argsText}
                onChange={setArgsText}
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
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="GITHUB_TOKEN=ghp_xxx&#10;DEBUG=true"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
                />
              </div>
            </>
          )}

          {/* http/sse 专用字段 */}
          {transportType !== 'stdio' && (
            <>
              <SettingsInput
                label="URL"
                value={url}
                onChange={setUrl}
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
                  onChange={(e) => setHeadersText(e.target.value)}
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
                  必须测试成功后才能启用
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
                  尚未测试连接。请先点击"测试连接"按钮验证配置是否正确。
                </div>
              </div>
            )}
          </div>

          {/* 启用开关 */}
          <SettingsToggle
            label="启用此服务器"
            description={
              testResult?.success
                ? '开启后该 MCP 服务器将在 Agent 会话中加载'
                : '只有测试成功后才能启用'
            }
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!testResult?.success}
          />
        </SettingsCard>
      </SettingsSection>
    </form>
  )
}
