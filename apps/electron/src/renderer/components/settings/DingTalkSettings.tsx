/**
 * DingTalkSettings - 钉钉集成设置页（多 Bot 版本）
 *
 * 支持多个钉钉 Bot 的配置管理、连接状态、创建引导。
 * 保存配置后自动启动 Stream 连接。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Loader2, ExternalLink, Power, PowerOff, Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsInput } from './primitives/SettingsInput'
import { SettingsSecretInput } from './primitives/SettingsSecretInput'
import { dingtalkBotStatesAtom } from '@/atoms/dingtalk-atoms'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { DingTalkBotConfig, DingTalkBotBridgeState, DingTalkBridgeStatus, DingTalkTestResult } from '@proma/shared'

/** 安全地用系统浏览器打开链接 */
function openLink(url: string): void {
  window.electronAPI.openExternal(url)
}

/** 可点击的外部链接组件 */
function Link({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
      onClick={() => openLink(href)}
    >
      {children}
      <ExternalLink className="size-3 flex-shrink-0" />
    </button>
  )
}

/** 状态指示器颜色映射 */
const STATUS_CONFIG: Record<DingTalkBridgeStatus, { color: string; label: string }> = {
  disconnected: { color: 'bg-gray-400', label: '未连接' },
  connecting: { color: 'bg-amber-400 animate-pulse', label: '连接中...' },
  connected: { color: 'bg-green-500', label: '已连接' },
  error: { color: 'bg-red-500', label: '连接错误' },
}

// ===== 主组件 =====

export function DingTalkSettings(): React.ReactElement {
  const botStates = useAtomValue(dingtalkBotStatesAtom)
  const [bots, setBots] = React.useState<DingTalkBotConfig[]>([])
  const [loading, setLoading] = React.useState(true)

  const loadBots = React.useCallback(async () => {
    try {
      const config = await window.electronAPI.getDingTalkMultiConfig()
      setBots(config.bots)
    } catch {
      // fallback: 旧 API
      try {
        const oldConfig = await window.electronAPI.getDingTalkConfig()
        if (oldConfig.clientId) {
          setBots([{
            id: 'legacy',
            name: '钉钉助手',
            enabled: oldConfig.enabled,
            clientId: oldConfig.clientId,
            clientSecret: oldConfig.clientSecret,
          }])
        }
      } catch { /* ignore */ }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { loadBots() }, [loadBots])

  const handleAddBot = React.useCallback(async () => {
    try {
      const saved = await window.electronAPI.saveDingTalkBotConfig({
        name: `钉钉助手 ${bots.length + 1}`,
        enabled: false,
        clientId: '',
        clientSecret: '',
      })
      setBots((prev) => [...prev, saved])
    } catch {
      toast.error('创建 Bot 失败')
    }
  }, [bots.length])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Bot 列表 */}
      <SettingsSection
        title="钉钉 Bot 列表"
        description="管理多个钉钉机器人，每个 Bot 可绑定不同的工作区和模型"
        action={
          <Button size="sm" variant="outline" onClick={handleAddBot}>
            <Plus size={14} className="mr-1.5" />
            添加 Bot
          </Button>
        }
      >
        {bots.length === 0 ? (
          <SettingsCard divided={false}>
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              还没有配置钉钉 Bot。点击「添加 Bot」开始。
            </div>
          </SettingsCard>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => (
              <BotConfigCard
                key={bot.id}
                bot={bot}
                state={botStates[bot.id]}
                onSaved={loadBots}
                onRemoved={loadBots}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {/* 创建钉钉机器人引导 */}
      <SettingsSection
        title="创建钉钉机器人"
        description="按以下步骤在钉钉开放平台创建企业内部应用"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-5 text-sm">
            {/* 步骤 1 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">1</span>
                <span className="font-medium text-foreground">创建企业内部应用</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                前往{' '}
                <Link href="https://open-dev.dingtalk.com">钉钉开放平台</Link>
                ，点击「创建应用」，选择「企业内部开发」，填写应用信息。
              </p>
            </div>

            {/* 步骤 2 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">2</span>
                <span className="font-medium text-foreground">获取凭证</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                进入应用详情页，在「凭证与基础信息」中找到{' '}
                <span className="text-foreground font-medium">Client ID (AppKey)</span> 和{' '}
                <span className="text-foreground font-medium">Client Secret (AppSecret)</span>，
                复制到上方配置表单中。
              </p>
            </div>

            {/* 步骤 3 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">3</span>
                <span className="font-medium text-foreground">添加机器人能力并保存连接</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                在「应用能力」中启用机器人功能。
                然后回到 Proma，<span className="text-foreground font-medium">先点击「保存配置」</span>，
                确认状态变为「已连接」后，再去钉钉后台配置事件订阅（选择 Stream 模式）。
              </p>
            </div>

            {/* 步骤 4 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">4</span>
                <span className="font-medium text-foreground">配置权限并发布</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                在「权限管理」中申请所需权限（消息收发、群组管理等），
                然后发布应用版本，等待企业管理员审批通过。
              </p>
            </div>

            {/* 提示 */}
            <div className="pl-7 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
              <span className="font-medium">重要：</span>配置事件订阅前，必须先在 Proma 中保存凭证并确认 Stream 连接成功，
              否则钉钉后台会提示「Stream 模式接入失败」。
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

// ===== 单个 Bot 配置卡片 =====

interface BotConfigCardProps {
  bot: DingTalkBotConfig
  state: DingTalkBotBridgeState | undefined
  onSaved: () => void
  onRemoved: () => void
}

function BotConfigCard({ bot, state, onSaved, onRemoved }: BotConfigCardProps): React.ReactElement {
  const [name, setName] = React.useState(bot.name)
  const [clientId, setClientId] = React.useState(bot.clientId)
  const [clientSecret, setClientSecret] = React.useState('')
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<DingTalkTestResult | null>(null)
  const [expanded, setExpanded] = React.useState(!bot.clientId) // 新建的 Bot 默认展开

  // 加载已有 secret（使用 bot-specific API）
  React.useEffect(() => {
    if (bot.clientSecret && bot.id) {
      window.electronAPI.getDecryptedDingTalkBotSecret?.(bot.id)
        .then((s: string) => { if (s) setClientSecret(s) })
        .catch(() => {
          // 回退到旧 API（兼容迁移前的首个 Bot）
          window.electronAPI.getDecryptedDingTalkSecret?.()
            .then((s: string) => { if (s) setClientSecret(s) })
            .catch(() => {})
        })
    }
  }, [bot.id, bot.clientSecret])

  const statusConfig = state ? STATUS_CONFIG[state.status] : STATUS_CONFIG.disconnected
  const isConnected = state?.status === 'connected' || state?.status === 'connecting'

  const handleSave = React.useCallback(async () => {
    if (!clientId.trim() || !name.trim()) return
    try {
      await window.electronAPI.saveDingTalkBotConfig({
        id: bot.id,
        name: name.trim(),
        enabled: true,
        clientId: clientId.trim(),
        clientSecret: clientSecret || '',
      })
      toast.success(`Bot "${name}" 已保存`)
      onSaved()
    } catch {
      toast.error('保存配置失败')
    }
  }, [bot.id, name, clientId, clientSecret, onSaved])

  const handleTest = React.useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testDingTalkConnection(clientId.trim(), clientSecret.trim())
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: `测试失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setTesting(false)
    }
  }, [clientId, clientSecret])

  const handleToggle = React.useCallback(async () => {
    if (isConnected) {
      await window.electronAPI.stopDingTalkBot(bot.id)
      toast.success(`Bot "${bot.name}" 已停止`)
    } else {
      try {
        await window.electronAPI.startDingTalkBot(bot.id)
        toast.success(`Bot "${bot.name}" 启动中...`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '启动失败')
      }
    }
  }, [bot.id, bot.name, isConnected])

  const handleRemove = React.useCallback(async () => {
    try {
      await window.electronAPI.removeDingTalkBot(bot.id)
      toast.success(`Bot "${bot.name}" 已删除`)
      onRemoved()
    } catch {
      toast.error('删除失败')
    }
  }, [bot.id, bot.name, onRemoved])

  return (
    <SettingsCard>
      {/* 头部：名称 + 状态 + 展开/折叠 */}
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusConfig.color}`} />
          <span className="font-medium text-sm">{bot.name || '未命名 Bot'}</span>
          <span className="text-xs text-muted-foreground">{bot.clientId ? bot.clientId.slice(0, 12) + '...' : '未配置'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleToggle() }}>
              <PowerOff size={14} className="mr-1" />
              停止
            </Button>
          ) : bot.clientId ? (
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleToggle() }}
              disabled={state?.status === 'connecting'}>
              {state?.status === 'connecting' ? <Loader2 size={14} className="animate-spin mr-1" /> : <Power size={14} className="mr-1" />}
              启动
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {/* 展开的配置表单 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          <SettingsInput
            label="Bot 名称"
            value={name}
            onChange={setName}
            placeholder="如：研发助手"
          />
          <SettingsInput
            label="Client ID (AppKey)"
            value={clientId}
            onChange={setClientId}
            placeholder="dingxxxxxxxx"
          />
          <SettingsSecretInput
            label="Client Secret (AppSecret)"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="输入 Client Secret"
          />

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={handleTest}
              disabled={testing || !clientId.trim() || !clientSecret.trim()}>
              {testing && <Loader2 size={14} className="animate-spin" />}
              <span>{testing ? '测试中...' : '测试连接'}</span>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!clientId.trim() || !name.trim()}>
              保存配置
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <Trash2 size={14} className="mr-1" />
                  删除
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                  <AlertDialogDescription>
                    删除 Bot &quot;{bot.name}&quot; 将同时断开连接。此操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemove}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {testResult && (
            <div className={cn(
              'p-3 rounded-lg flex items-start gap-2 text-sm',
              testResult.success ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'
            )}>
              {testResult.success
                ? <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
                : <XCircle size={16} className="flex-shrink-0 mt-0.5" />
              }
              <span>{testResult.message}</span>
            </div>
          )}

          {state?.status === 'error' && state.errorMessage && (
            <div className="p-2.5 rounded-lg bg-red-500/10 text-red-700 dark:text-red-400 text-sm">
              {state.errorMessage}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  )
}
