/**
 * WeChatSettings - 微信集成设置页
 *
 * 基于微信 iLink Bot API，扫码登录 + 长轮询消息。
 * 用户流程：点击登录 → 显示二维码 → 扫码 → 自动连接。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { Loader2, Power, PowerOff, LogOut, QrCode, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { SettingsRow } from './primitives/SettingsRow'
import { wechatBridgeStateAtom } from '@/atoms/wechat-atoms'
import type { WeChatBridgeStatus } from '@proma/shared'

/** 安全地用系统浏览器打开链接 */
function openLink(url: string): void {
  window.electronAPI.openExternal(url)
}

/** 状态指示器配置 */
const STATUS_CONFIG: Record<WeChatBridgeStatus, { color: string; label: string }> = {
  disconnected: { color: 'bg-gray-400', label: '未连接' },
  waiting_scan: { color: 'bg-amber-400 animate-pulse', label: '等待扫码...' },
  scanned: { color: 'bg-blue-400 animate-pulse', label: '已扫码，确认中...' },
  connecting: { color: 'bg-amber-400 animate-pulse', label: '连接中...' },
  connected: { color: 'bg-green-500', label: '已连接' },
  error: { color: 'bg-red-500', label: '连接错误' },
}

export function WeChatSettings(): React.ReactElement {
  const [bridgeState, setBridgeState] = useAtom(wechatBridgeStateAtom)
  const [hasCredentials, setHasCredentials] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  // 加载配置和状态
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getWeChatConfig(),
      window.electronAPI.getWeChatStatus(),
    ]).then(([config, status]) => {
      setHasCredentials(!!config.credentials)
      setBridgeState(status)
      setLoaded(true)
    })
  }, [setBridgeState])

  // 订阅状态变化
  React.useEffect(() => {
    const unsubscribe = window.electronAPI.onWeChatStatusChanged((state) => {
      setBridgeState(state)
      // 登录成功后更新凭证状态
      if (state.status === 'connected') {
        setHasCredentials(true)
      } else if (state.status === 'disconnected') {
        // 可能是登出
        window.electronAPI.getWeChatConfig().then((config) => {
          setHasCredentials(!!config.credentials)
        })
      }
    })
    return unsubscribe
  }, [setBridgeState])

  // 开始扫码登录
  const handleLogin = React.useCallback(async () => {
    try {
      await window.electronAPI.startWeChatLogin()
    } catch (error) {
      toast.error(`登录失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  // 启动 Bridge
  const handleStart = React.useCallback(async () => {
    try {
      await window.electronAPI.startWeChatBridge()
      toast.success('微信 Bridge 已启动')
    } catch (error) {
      toast.error(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  // 停止 Bridge
  const handleStop = React.useCallback(async () => {
    try {
      await window.electronAPI.stopWeChatBridge()
      toast.info('微信 Bridge 已停止')
    } catch (error) {
      toast.error(`停止失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  // 登出
  const handleLogout = React.useCallback(async () => {
    try {
      await window.electronAPI.logoutWeChat()
      setHasCredentials(false)
      toast.info('已退出微信登录')
    } catch (error) {
      toast.error(`登出失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  const statusConfig = STATUS_CONFIG[bridgeState.status]
  const isConnected = bridgeState.status === 'connected'
  const isLoggingIn = bridgeState.status === 'waiting_scan' || bridgeState.status === 'scanned'
  const isConnecting = bridgeState.status === 'connecting'
  const showQRCode = isLoggingIn && bridgeState.qrCodeData

  if (!loaded) return <div />

  return (
    <div className="space-y-8">
      {/* 连接状态 */}
      <SettingsSection
        title="微信集成"
        description="扫码登录微信，在微信中控制 Proma Agent"
      >
        <SettingsCard>
          <SettingsRow label="Bridge 状态">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                <span className="text-sm text-muted-foreground">{statusConfig.label}</span>
              </div>
              {isConnected ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleStop}>
                    <PowerOff size={14} className="mr-1.5" />
                    停止
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleLogout}>
                    <LogOut size={14} className="mr-1.5" />
                    登出
                  </Button>
                </div>
              ) : hasCredentials && !isLoggingIn ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleStart}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <Loader2 size={14} className="animate-spin mr-1.5" />
                    ) : (
                      <Power size={14} className="mr-1.5" />
                    )}
                    启动
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleLogout}>
                    <LogOut size={14} className="mr-1.5" />
                    登出
                  </Button>
                </div>
              ) : !isLoggingIn ? (
                <Button size="sm" onClick={handleLogin}>
                  <QrCode size={14} className="mr-1.5" />
                  扫码登录
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsCard>

        {/* 错误信息 */}
        {bridgeState.status === 'error' && bridgeState.errorMessage && (
          <div className="mt-2 px-3 py-2.5 rounded-lg bg-red-500/10 text-red-700 dark:text-red-400 text-sm">
            {bridgeState.errorMessage}
          </div>
        )}

        {/* 连接成功提示 */}
        {isConnected && (
          <div className="mt-2 px-3 py-2.5 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
            微信已连接，消息将自动接收。
          </div>
        )}
      </SettingsSection>

      {/* QR 码显示区域 */}
      {showQRCode && (
        <SettingsSection
          title="扫码登录"
          description="使用微信扫描下方二维码"
        >
          <SettingsCard divided={false}>
            <div className="flex flex-col items-center py-8 px-4">
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <img
                  src={bridgeState.qrCodeData}
                  alt="微信登录二维码"
                  className="w-52 h-52"
                />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {bridgeState.status === 'scanned' ? (
                  <span className="text-blue-500 font-medium">已扫码，请在手机上确认登录</span>
                ) : (
                  '打开微信，扫描二维码登录'
                )}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={handleLogin}
              >
                刷新二维码
              </Button>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 使用说明 */}
      <SettingsSection
        title="使用说明"
        description="微信机器人的工作方式"
      >
        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-5 text-sm">
            {/* 步骤 1 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">1</span>
                <span className="font-medium text-foreground">扫码登录</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                点击上方「扫码登录」，用微信扫描二维码。
                这会将你的微信账号作为 Bot 接入 Proma。
              </p>
            </div>

            {/* 步骤 2 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">2</span>
                <span className="font-medium text-foreground">自动连接</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                扫码成功后，Proma 会自动建立长连接。
                凭证会加密保存，下次启动 Proma 时自动重连。
              </p>
            </div>

            {/* 步骤 3 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">3</span>
                <span className="font-medium text-foreground">收发消息</span>
              </div>
              <p className="pl-7 text-muted-foreground">
                连接成功后，通过微信发送消息即可与 Proma Agent 交互。
                支持文本、图片、文件等消息类型。
              </p>
            </div>

            {/* 提示 */}
            <div className="pl-7 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
              微信集成基于{' '}
              <button
                type="button"
                className="inline-flex items-center gap-0.5 underline hover:no-underline cursor-pointer"
                onClick={() => openLink('https://ilinkai.weixin.qq.com')}
              >
                iLink Bot API
                <ExternalLink className="size-2.5" />
              </button>
              ，这是微信官方提供的 Bot 接口。
              会话凭证使用系统级加密存储。
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
