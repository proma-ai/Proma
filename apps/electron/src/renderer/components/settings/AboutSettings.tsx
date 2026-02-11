/**
 * AboutSettings - 关于页面
 *
 * 显示应用版本号等基本信息，以及自动更新状态和控制。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCw, Download, Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import type { EnvironmentCheckResult } from '@proma/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from './primitives'
import { updateStatusAtom, updaterAvailableAtom, checkForUpdates, installUpdate } from '@/atoms/updater'
import {
  environmentCheckResultAtom,
  hasEnvironmentIssuesAtom,
} from '@/atoms/environment'
import { EnvironmentCheckCard } from '@/components/environment/EnvironmentCheckCard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

/** 从 package.json 构建时由 Vite define 注入 */
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

/** 更新状态卡片 */
function UpdateCard(): React.ReactElement | null {
  const available = useAtomValue(updaterAvailableAtom)
  const status = useAtomValue(updateStatusAtom)
  const [checking, setChecking] = React.useState(false)

  // updater 不可用时不渲染
  if (!available) return null

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await checkForUpdates()
    } finally {
      // 状态由 atom 订阅自动更新，延迟重置 checking 避免按钮闪烁
      setTimeout(() => setChecking(false), 1000)
    }
  }

  const handleInstall = async (): Promise<void> => {
    await installUpdate()
  }

  const isChecking = checking || status.status === 'checking'

  return (
    <SettingsCard>
      <SettingsRow label="软件更新">
        <div className="flex items-center gap-3">
          {/* 状态文字 */}
          <StatusText status={status.status} version={status.version} error={status.error} />

          {/* 操作按钮 */}
          {status.status === 'downloaded' ? (
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              立即安装
            </button>
          ) : (
            <button
              onClick={handleCheck}
              disabled={isChecking}
              className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              {isChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              检查更新
            </button>
          )}
        </div>
      </SettingsRow>

      {/* 下载进度条 */}
      {status.status === 'downloading' && status.progress && (
        <div className="px-4 pb-4 -mt-2">
          <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${Math.round(status.progress.percent)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            下载中 {Math.round(status.progress.percent)}%
          </p>
        </div>
      )}
    </SettingsCard>
  )
}

/** 状态文字组件 */
function StatusText({ status, version, error }: {
  status: string
  version?: string
  error?: string
}): React.ReactElement {
  switch (status) {
    case 'checking':
      return <span className="text-xs text-muted-foreground">正在检查...</span>
    case 'available':
      return (
        <span className="text-xs text-primary flex items-center gap-1">
          <Download className="h-3 w-3" />
          新版本 v{version} 可用
        </span>
      )
    case 'downloading':
      return <span className="text-xs text-muted-foreground">正在下载更新...</span>
    case 'downloaded':
      return (
        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          v{version} 已就绪，重启后生效
        </span>
      )
    case 'not-available':
      return (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          已是最新版本
        </span>
      )
    case 'error':
      return (
        <span className="text-xs text-destructive flex items-center gap-1" title={error}>
          <AlertCircle className="h-3 w-3" />
          检查失败
        </span>
      )
    default:
      return <span className="text-xs text-muted-foreground">未检查</span>
  }
}

/** 环境检测卡片 */
function EnvironmentCard(): React.ReactElement {
  const hasIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const setEnvironmentResult = useSetAtom(environmentCheckResultAtom)
  const [result, setResult] = React.useState<EnvironmentCheckResult | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)

  // 初始化时加载缓存的检测结果
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      if (settings.lastEnvironmentCheck) {
        setResult(settings.lastEnvironmentCheck)
        setEnvironmentResult(settings.lastEnvironmentCheck)
      }
    })
  }, [])

  // 执行环境检测
  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const checkResult = await window.electronAPI.checkEnvironment()
      setResult(checkResult)
      setEnvironmentResult(checkResult)
    } catch (error) {
      console.error('[环境检测] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  // Node.js 检测状态
  const nodejsStatus = !result
    ? 'checking'
    : result.nodejs.installed && result.nodejs.meetsMinimum
      ? result.nodejs.meetsRecommended
        ? 'success'
        : 'warning'
      : 'error'

  // Git 检测状态
  const gitStatus = !result
    ? 'checking'
    : result.git.installed && result.git.meetsRequirement
      ? 'success'
      : 'error'

  return (
    <SettingsCard>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">环境检测</h3>
            {hasIssues && <Badge variant="destructive">!</Badge>}
          </div>
          <button
            onClick={handleCheck}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isChecking ? '检测中...' : '重新检查'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Agent 模式需要 Node.js 和 Git 支持
        </p>
      </div>

      <div className="p-4 space-y-3">
        {/* Node.js 检测卡片 */}
        <EnvironmentCheckCard
          name="Node.js"
          status={nodejsStatus}
          version={result?.nodejs.version}
          requirement="推荐 22 LTS，最低 18 LTS"
          downloadUrl={result?.nodejs.downloadUrl || 'https://nodejs.org/'}
          statusText={
            result && nodejsStatus === 'warning'
              ? `v${result.nodejs.version} (建议升级到 22 LTS 以获得最佳体验)`
              : undefined
          }
        />

        {/* Git 检测卡片 */}
        <EnvironmentCheckCard
          name="Git"
          status={gitStatus}
          version={result?.git.version}
          requirement="版本 >= 2.0"
          downloadUrl={result?.git.downloadUrl || 'https://git-scm.com/'}
        />

        {/* Windows 提示 */}
        {result?.platform === 'win32' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Windows 用户建议：</strong>
              安装时请选择默认路径（C:\Program Files\...），并确保勾选"添加到 PATH"选项
            </AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsCard>
  )
}

export function AboutSettings(): React.ReactElement {
  return (
    <SettingsSection
      title="关于 Proma"
      description="集成通用 AI Agent 的下一代人工智能软件"
    >
      <SettingsCard>
        <SettingsRow label="版本">
          <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
        </SettingsRow>
        <SettingsRow label="运行时">
          <span className="text-sm text-muted-foreground">Electron + React</span>
        </SettingsRow>
        <SettingsRow
          label="开源协议"
          description="本项目遵循开源协议发布"
        >
          <span className="text-sm text-muted-foreground">MIT</span>
        </SettingsRow>
        <SettingsRow label="项目地址">
          <a
            href="https://github.com/ErlichLiu/Proma.git"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            github.com/ErlichLiu/Proma
          </a>
        </SettingsRow>
      </SettingsCard>

      {/* 自动更新卡片（updater 不可用时不渲染） */}
      <UpdateCard />

      {/* 环境检测卡片 */}
      <EnvironmentCard />
    </SettingsSection>
  )
}
