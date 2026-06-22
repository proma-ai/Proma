/**
 * MemorySettings - 记忆设置页
 *
 * Chat 工具 tab 下的记忆区，提供两种记忆方案：
 *  - MemOS Cloud：官方云端记忆（含 Switch 开关，作为 chat-tools 的一项）
 *  - Nowledge Mem：本地优先记忆 + Agent 集成（仅展示配置提示词，不持久化任何凭证）
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import type { MemoryConfig } from '@proma/shared'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import nowledgeMemPrompt from './nowledge-mem-prompt.md?raw'

/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[MemorySettings] 刷新工具列表失败:', err)
  }
}

/** MemOS Cloud · 云端记忆（原有实现） */
function MemOSSection(): React.ReactElement {
  const [config, setConfig] = React.useState<MemoryConfig>({ enabled: false, apiKey: '', userId: 'proma-user' })
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const setChatTools = useSetAtom(chatToolsAtom)

  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)

  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  React.useEffect(() => {
    window.electronAPI.getMemoryConfig()
      .then((c) => {
        setConfig(c)
        setApiKey(c.apiKey)
      })
      .catch((err) => console.error('[记忆设置] 加载失败:', err))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (updated: MemoryConfig): Promise<void> => {
    setSaving(true)
    try {
      await window.electronAPI.setMemoryConfig(updated)
      // 同步记忆工具开关到 chat-tools.json（唯一状态源）
      await window.electronAPI.updateChatToolState('memory', { enabled: updated.enabled })
      setConfig(updated)
      setApiKey(updated.apiKey)
      await refreshChatTools(setChatTools)
      toast.success('记忆设置已保存')
    } catch (error) {
      console.error('[记忆设置] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  /** API Key 输入框失焦时静默保存 */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    if (apiKey === config.apiKey) return
    await handleSave({ ...config, apiKey })
  }, [apiKey, config])

  const handleTest = async (): Promise<void> => {
    if (apiKey !== config.apiKey) {
      await handleSave({ ...config, apiKey })
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testMemoryConnection()
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
      title="MemOS Cloud · 云端记忆"
      description="免费云端服务，启用后 Chat 与 Agent 都可跨会话记住偏好、决策和项目上下文"
      action={
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => handleSave({ ...config, apiKey, enabled: checked })}
          disabled={saving}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>记忆功能由 <span className="font-medium text-foreground">MemOS Cloud</span> 提供。免费用户每月提供 5 万次添加记忆，2 万次查询记忆，对于绝大部分用户均足够。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://memos-dashboard.openmem.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  MemOS Cloud 控制台
                  <ExternalLink size={10} />
                </a>
                {' '}注册账号
              </li>
              <li>在控制台的 API Keys 页面生成一个 API Key</li>
              <li>将 API Key 填入下方，然后开启开关</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey}
                onClick={handleTest}
              >
                {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="memos API Key"
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

/** Nowledge Mem · 本地优先记忆 + Agent 集成 */
function NowledgeMemSection(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const [configuredSlugs, setConfiguredSlugs] = React.useState<string[]>([])
  const [copying, setCopying] = React.useState(false)

  // 检测哪些工作区的 mcp.json 里已经写入了 nowledge-mem 条目
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const results = await Promise.all(
        workspaces.map(async (ws) => {
          try {
            const caps = await window.electronAPI.getWorkspaceCapabilities(ws.slug)
            return caps.mcpServers.some((m) => m.name === 'nowledge-mem') ? ws.slug : null
          } catch (err) {
            console.error('[Nowledge Mem] 检查工作区能力失败:', ws.slug, err)
            return null
          }
        }),
      )
      if (!cancelled) {
        setConfiguredSlugs(results.filter((s): s is string => s !== null))
      }
    })()
    return () => { cancelled = true }
  }, [workspaces])

  const handleCopy = async (): Promise<void> => {
    setCopying(true)
    try {
      await navigator.clipboard.writeText(nowledgeMemPrompt)
      toast.success('已复制配置提示词，请粘贴到 Agent 模式输入框执行')
    } catch (error) {
      console.error('[Nowledge Mem] 复制失败:', error)
      toast.error('复制失败，请检查剪贴板权限')
    } finally {
      setCopying(false)
    }
  }

  const badge = configuredSlugs.length > 0 ? (
    <span
      className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"
      title={`已配置工作区：${configuredSlugs.join('、')}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      已在 {configuredSlugs.length} 个工作区配置
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      未配置
    </span>
  )

  return (
    <SettingsSection
      title={
        <span className="inline-flex items-center gap-2 flex-wrap">
          Nowledge Mem · 本地优先记忆
          {badge}
        </span>
      }
      description="本地客户端 + Agent 集成方案，记忆完全留在你自己机器上，跨会话自动注入与回写"
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 第 1 步：下载 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 1 步：下载并安装 Nowledge Mem 桌面客户端</p>
            <a
              href="https://mem.nowledge.co/zh"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
            >
              mem.nowledge.co/zh
              <ExternalLink size={10} />
            </a>
          </div>

          {/* 第 2 步：执行前 Set Up 清单 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 2 步：执行第三步的配置提示词前请确认</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
              <li>已下载并安装 Nowledge Mem 桌面客户端（配置时无需登录或注册账号）</li>
              <li>已启动 Nowledge Mem，托盘 / Dock 中能看到运行图标</li>
              <li>Proma 已切换到 <span className="font-medium text-foreground">Agent 模式</span>（此提示词只能在 Agent 中执行）</li>
            </ul>
          </div>

          {/* 第 3 步：复制 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 3 步：复制配置提示词，粘贴到 Agent 输入框执行</p>
            <div className="flex items-center gap-3">
              <Button onClick={handleCopy} disabled={copying} size="sm">
                <Copy size={14} className="mr-1.5" />
                {copying ? '复制中...' : '复制配置提示词'}
              </Button>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">一键让 Agent 完成所有配置</span>，提示词包含 nmem CLI 安装、插件下载、MCP 与 Hooks 配置全流程
              </p>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              ⚠️ 提示词执行完成后需要 <span className="font-medium text-foreground">完全退出并重启 Proma</span>，MCP 与 Hooks 才会生效
            </p>
          </div>

          {/* 第 4 步：验证记忆闭环 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">第 4 步：重启后验证记忆是否打通</p>
            <p className="text-xs text-muted-foreground">
              在 Agent 模式中先用{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/skill:distill-memory</code>{' '}
              让 Agent 记住一段对话内容，再开一个新会话用{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">/skill:search-memory</code>{' '}
              把它搜出来。能搜到即代表记忆系统已完整生效。
            </p>
          </div>

          {/* 平台支持说明 + 帮助链接 */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              💡 平台支持：macOS、Linux 主流支持；Windows 用户需在 Git Bash + uv 环境中尝试（实验性，未经 Nowledge 官方验证）
            </p>
            <p className="text-xs text-muted-foreground">
              📖 配置过程遇到问题？查看{' '}
              <a
                href="https://mem.nowledge.co/zh/docs/integrations/proma"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                Nowledge Mem · Proma 集成文档
                <ExternalLink size={10} />
              </a>
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

export function MemorySettings(): React.ReactElement {
  return (
    <div className="space-y-8">
      <NowledgeMemSection />
      <MemOSSection />
    </div>
  )
}
