/**
 * ProxySettings - 代理配置页
 *
 * 全局代理配置，支持系统代理自动检测和手动配置。
 * 所有 AI API 请求（Chat + Agent）都会使用这里的代理配置。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Globe, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInput,
} from './primitives'
import { proxyConfigAtom, loadProxyConfigAtom, updateProxyConfigAtom } from '@/atoms/proxy-atoms'
import { cn } from '@/lib/utils'
import type { ProxyMode } from '@proma/shared'

export function ProxySettings(): React.ReactElement {
  const [config, setConfig] = useAtom(proxyConfigAtom)
  const loadProxyConfig = useSetAtom(loadProxyConfigAtom)
  const updateProxyConfig = useSetAtom(updateProxyConfigAtom)

  const [detecting, setDetecting] = React.useState(false)
  const [detectResult, setDetectResult] = React.useState<{ success: boolean; message: string } | null>(null)

  // 初始化加载配置
  React.useEffect(() => {
    loadProxyConfig()
  }, [loadProxyConfig])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2">加载中...</span>
      </div>
    )
  }

  /** 更新代理配置（本地状态 + 持久化） */
  const handleUpdate = async (updates: Partial<typeof config>): Promise<void> => {
    const updated = { ...config, ...updates }
    setConfig(updated)
    try {
      await updateProxyConfig(updated)
    } catch (error) {
      console.error('[代理设置] 更新失败:', error)
    }
  }

  /** 检测系统代理 */
  const handleDetectSystemProxy = async (): Promise<void> => {
    setDetecting(true)
    setDetectResult(null)

    try {
      const result = await window.electronAPI.detectSystemProxy()
      setDetectResult({
        success: result.success,
        message: result.success
          ? `检测到系统代理: ${result.proxyUrl}`
          : result.message,
      })
    } catch (error) {
      setDetectResult({
        success: false,
        message: '检测失败',
      })
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 代理开关 */}
      <SettingsSection
        title="代理配置"
        description="配置后所有 AI API 请求（Chat + Agent）将通过代理发送"
      >
        <SettingsCard>
          <SettingsToggle
            label="启用代理"
            description="开启后可选择系统代理或手动配置代理地址"
            checked={config.enabled}
            onCheckedChange={(enabled) => handleUpdate({ enabled })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 代理模式选择（仅在启用时显示） */}
      {config.enabled && (
        <SettingsSection title="代理模式">
          <SettingsCard divided={false}>
            {/* 系统代理选项 */}
            <div
              className={cn(
                'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50',
                config.mode === 'system' && 'bg-accent/10'
              )}
              onClick={() => handleUpdate({ mode: 'system' })}
            >
              <input
                type="radio"
                checked={config.mode === 'system'}
                onChange={() => handleUpdate({ mode: 'system' })}
                className="mt-0.5 w-4 h-4 accent-foreground cursor-pointer"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Globe size={16} />
                  <span>系统代理（推荐）</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  自动检测操作系统的代理设置（macOS 网络偏好设置、Windows Internet 选项等）
                </p>
                {config.mode === 'system' && (
                  <div className="mt-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDetectSystemProxy()
                      }}
                      disabled={detecting}
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                    >
                      {detecting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      <span>检测系统代理</span>
                    </button>
                    {detectResult && (
                      <div
                        className={cn(
                          'flex items-center gap-1.5 text-xs mt-2',
                          detectResult.success ? 'text-emerald-600' : 'text-muted-foreground'
                        )}
                      >
                        {detectResult.success ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <XCircle size={12} />
                        )}
                        <span>{detectResult.message}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-b border-border/50" />

            {/* 手动配置选项 */}
            <div
              className={cn(
                'px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50',
                config.mode === 'manual' && 'bg-accent/10'
              )}
              onClick={() => handleUpdate({ mode: 'manual' })}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  checked={config.mode === 'manual'}
                  onChange={() => handleUpdate({ mode: 'manual' })}
                  className="mt-0.5 w-4 h-4 accent-foreground cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">手动配置</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    手动输入代理地址和端口
                  </p>
                </div>
              </div>
              {config.mode === 'manual' && (
                <div className="mt-3 ml-7">
                  <SettingsInput
                    label=""
                    value={config.manualUrl}
                    onChange={(value) => handleUpdate({ manualUrl: value })}
                    placeholder="http://127.0.0.1:7890"
                    description="格式: http://host:port 或 https://host:port"
                  />
                </div>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  )
}
