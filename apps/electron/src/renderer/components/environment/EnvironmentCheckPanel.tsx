/**
 * Windows 环境检测面板
 *
 * 展示 Shell 环境（Git Bash / WSL）和 Node.js 的检测结果，
 * 用于设置里的 EnvironmentCheckDialog，帮助用户按需启用 Shell 与 Node.js 能力。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnvironmentCheckCard } from './EnvironmentCheckCard'
import {
  installerManifestAtom,
  runtimeStatusAtom,
  isShellEnvironmentOkAtom,
  isNodeJsOkAtom,
} from '@/atoms/environment'
import { useAtomValue } from 'jotai'

interface EnvironmentCheckPanelProps {
  /** 首次挂载时是否自动跑一次检测 */
  autoDetectOnMount?: boolean
}

export function EnvironmentCheckPanel({
  autoDetectOnMount = true,
}: EnvironmentCheckPanelProps) {
  const [runtime, setRuntime] = useAtom(runtimeStatusAtom)
  const setManifest = useSetAtom(installerManifestAtom)
  const shellOk = useAtomValue(isShellEnvironmentOkAtom)
  const nodeOk = useAtomValue(isNodeJsOkAtom)
  const [isChecking, setIsChecking] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setIsChecking(true)
    try {
      const [status, manifest] = await Promise.all([
        window.electronAPI.reinitRuntime(),
        window.electronAPI.fetchInstallerManifest(),
      ])
      setRuntime(status)
      setManifest(manifest)
    } catch (error) {
      console.error('[EnvironmentCheckPanel] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }, [setRuntime, setManifest])

  React.useEffect(() => {
    if (autoDetectOnMount) {
      refresh()
    } else if (!runtime) {
      // 至少拿一次当前状态
      window.electronAPI.getRuntimeStatus().then((status) => {
        if (status) setRuntime(status)
      })
      window.electronAPI
        .fetchInstallerManifest()
        .then((m) => setManifest(m))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- Shell 环境卡片 -----
  const shell = runtime?.shell
  const gitBashAvailable = shell?.gitBash?.available ?? false
  const wslAvailable = shell?.wsl?.available ?? false

  let shellStatus: 'checking' | 'success' | 'warning' = 'warning'
  let shellStatusText = ''
  if (!runtime) {
    shellStatus = 'checking'
    shellStatusText = '正在检测...'
  } else if (gitBashAvailable) {
    shellStatus = 'success'
    shellStatusText = `Git Bash v${shell?.gitBash?.version ?? ''} 已可用`
  } else if (wslAvailable) {
    shellStatus = 'success'
    shellStatusText = `WSL ${shell?.wsl?.defaultDistro ?? ''} 已可用`
  } else {
    shellStatus = 'warning'
    shellStatusText = '未检测到 Git Bash 或 WSL（基础 Agent 仍可用）'
  }

  // ----- Node.js 卡片 -----
  const nodeInfo = runtime?.node
  let nodeStatus: 'checking' | 'success' | 'warning' = 'warning'
  let nodeStatusText = ''
  let nodeVersion: string | undefined = undefined
  if (!runtime) {
    nodeStatus = 'checking'
    nodeStatusText = '正在检测...'
  } else if (nodeInfo?.available) {
    nodeStatus = 'success'
    nodeVersion = nodeInfo.version ?? undefined
    nodeStatusText = nodeVersion ? `v${nodeVersion} 已安装` : '已安装'
  } else {
    nodeStatus = 'warning'
    nodeStatusText = '未安装（可选）'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Windows 环境检测</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            基础 Agent 无需额外环境；Git Bash 或 WSL 可启用 Bash 命令执行
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isChecking}
          className="h-8 text-xs"
        >
          {isChecking ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3 w-3" />
          )}
          重新检测
        </Button>
      </div>

      <div className="space-y-2">
        <EnvironmentCheckCard
          name="Shell 环境"
          status={shellStatus}
          requirement="可选 · 安装 Git Bash 或 WSL 后可使用 Bash 命令"
          statusText={shellStatusText}
          action={
            shellStatus === 'warning'
              ? { type: 'download', installerId: 'git-for-windows' }
              : { type: 'none' }
          }
        />
        <EnvironmentCheckCard
          name="Node.js"
          status={nodeStatus}
          version={nodeVersion}
          requirement="推荐 · 仅在使用 MCP 服务器（npx xxx）时需要"
          statusText={nodeStatusText}
          action={
            nodeStatus === 'warning'
              ? { type: 'download', installerId: 'nodejs' }
              : { type: 'none' }
          }
        />
      </div>

      {!shellOk && runtime && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[12px] text-yellow-700 dark:text-yellow-400">
          未检测到 Git Bash 或 WSL：仍可使用基础 Agent，但本次不会提供 Bash 命令工具。
        </div>
      )}

      {!nodeOk && runtime && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[12px] text-yellow-700 dark:text-yellow-400">
          未检测到 Node.js。如果不使用基于 npx 的 MCP 服务器，可以忽略此项。
        </div>
      )}
    </div>
  )
}
