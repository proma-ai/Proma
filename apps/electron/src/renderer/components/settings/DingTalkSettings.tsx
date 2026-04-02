/**
 * DingTalkSettings - 钉钉集成设置页
 *
 * 凭证配置 + Stream 连接管理 + 创建引导。
 * 保存配置后自动启动 Stream 连接，用户可随后去钉钉后台配置事件订阅。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { Loader2, ExternalLink, Power, PowerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsRow } from './primitives/SettingsRow'
import { SettingsInput } from './primitives/SettingsInput'
import { SettingsSecretInput } from './primitives/SettingsSecretInput'
import { dingtalkBridgeStateAtom } from '@/atoms/dingtalk-atoms'
import type { DingTalkBridgeStatus } from '@proma/shared'

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

export function DingTalkSettings(): React.ReactElement {
  const [bridgeState, setBridgeState] = useAtom(dingtalkBridgeStateAtom)
  const [clientId, setClientId] = React.useState('')
  const [clientSecret, setClientSecret] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  // 加载已有配置
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getDingTalkConfig(),
      window.electronAPI.getDecryptedDingTalkSecret().catch(() => ''),
      window.electronAPI.getDingTalkStatus(),
    ]).then(([config, secret, status]) => {
      setClientId(config.clientId ?? '')
      if (secret) setClientSecret(secret)
      setBridgeState(status)
      setLoaded(true)
    })
  }, [setBridgeState])

  // 订阅状态变化
  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onDingTalkStatusChanged((state) => {
      setBridgeState(state)
    })
    return unsubscribe
  }, [setBridgeState])

  // 保存配置并自动启动连接
  const handleSave = React.useCallback(async () => {
    if (!clientId.trim()) return
    setSaving(true)
    try {
      await window.electronAPI.saveDingTalkConfig({
        enabled: true,
        clientId: clientId.trim(),
        clientSecret,
      })
      toast.success('钉钉配置已保存，正在连接 Stream...')
    } catch (error) {
      toast.error(`保存失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }, [clientId, clientSecret])

  // 测试连接
  const handleTest = React.useCallback(async () => {
    if (!clientId.trim() || !clientSecret) return
    setTesting(true)
    try {
      const result = await window.electronAPI.testDingTalkConnection(clientId.trim(), clientSecret)
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      toast.error(`测试失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }, [clientId, clientSecret])

  // 启动 Bridge
  const handleStart = React.useCallback(async () => {
    try {
      await window.electronAPI.startDingTalkBridge()
      toast.success('钉钉 Bridge 已启动')
    } catch (error) {
      toast.error(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  // 停止 Bridge
  const handleStop = React.useCallback(async () => {
    try {
      await window.electronAPI.stopDingTalkBridge()
      toast.info('钉钉 Bridge 已停止')
    } catch (error) {
      toast.error(`停止失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  const statusConfig = STATUS_CONFIG[bridgeState.status]
  const isConnected = bridgeState.status === 'connected'
  const isConnecting = bridgeState.status === 'connecting'
  const hasCredentials = clientId.trim() && clientSecret

  if (!loaded) return <div />

  return (
    <div className="space-y-8">
      {/* 连接状态 */}
      <SettingsSection
        title="钉钉集成"
        description="连接钉钉机器人，在钉钉中控制 Proma Agent"
      >
        <SettingsCard>
          <SettingsRow label="Bridge 状态">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                <span className="text-sm text-muted-foreground">{statusConfig.label}</span>
              </div>
              {isConnected ? (
                <Button size="sm" variant="outline" onClick={handleStop}>
                  <PowerOff size={14} className="mr-1.5" />
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStart}
                  disabled={isConnecting || !hasCredentials}
                >
                  {isConnecting ? (
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                  ) : (
                    <Power size={14} className="mr-1.5" />
                  )}
                  启动
                </Button>
              )}
            </div>
          </SettingsRow>
        </SettingsCard>
        {bridgeState.status === 'error' && bridgeState.errorMessage && (
          <div className="mt-2 px-3 py-2.5 rounded-lg bg-red-500/10 text-red-700 dark:text-red-400 text-sm">
            {bridgeState.errorMessage}
          </div>
        )}
        {isConnected && (
          <div className="mt-2 px-3 py-2.5 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
            Stream 连接已建立。现在可以去钉钉开放平台配置事件订阅了。
          </div>
        )}
      </SettingsSection>

      {/* 凭证配置 */}
      <SettingsSection
        title="凭证配置"
        description="从钉钉开放平台获取应用凭证"
      >
        <SettingsCard>
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
        </SettingsCard>

        <div className="flex items-center gap-3 mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testing || !hasCredentials}
          >
            {testing && <Loader2 size={14} className="animate-spin mr-1.5" />}
            测试连接
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !clientId.trim()}
          >
            {saving && <Loader2 size={14} className="animate-spin mr-1.5" />}
            保存并连接
          </Button>
        </div>
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
                在「应用能力」→「添加应用能力」中启用机器人功能。
                然后回到 Proma，<span className="text-foreground font-medium">先点击上方「保存并连接」</span>，
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
                在「权限管理」中申请所需权限（消息收发、群组管理等，如果足够信任 Agent 可以给全部权限更简单），
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
