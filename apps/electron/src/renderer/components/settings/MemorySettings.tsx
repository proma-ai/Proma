/**
 * MemorySettings - 记忆设置页
 *
 * 独立的顶级设置 tab，管理全局跨会话记忆功能的配置。
 * Chat 和 Agent 模式共享同一份记忆配置。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import type { MemoryConfig } from '@proma/shared'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'

/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[MemorySettings] 刷新工具列表失败:', err)
  }
}

export function MemorySettings(): React.ReactElement {
  const [config, setConfig] = React.useState<MemoryConfig>({ enabled: false, apiKey: '', userId: 'proma-user' })
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const setChatTools = useSetAtom(chatToolsAtom)

  // 本地编辑状态
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)

  // 连接测试状态
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  // 加载全局配置
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
      setConfig(updated)
      setApiKey(updated.apiKey)
      // 刷新全局工具列表（available/enabled 可能变化）
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
    // 如果有未保存的 API Key，先保存再测试
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
    <div className="space-y-8">
      <SettingsSection
        title="记忆"
        description="启用后 Chat 和 Agent 模式都可跨会话记住重要信息"
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
              <p>记忆功能由 <span className="font-medium text-foreground">MemOS Cloud</span> 提供，启用后能跨会话记住你的偏好、决策和项目上下文。免费用户每月提供 5 万次添加记忆，2 万次查询记忆，对于绝大部分用户均足够。</p>
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
    </div>
  )
}
