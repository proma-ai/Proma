/**
 * CloudSidebarExtension — 商业版 Cloud 功能在 LeftSidebar 中的扩展
 *
 * 将所有 Cloud 相关的侧边栏逻辑集中到此组件，减少对 LeftSidebar.tsx 的侵入式修改，
 * 降低与上游合并时的冲突面。
 *
 * 包含：
 * - 从云端下载全部对话按钮（含同步中/成功/失败状态反馈）
 * - 侧边栏余额指示器
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { CloudDownload, Info, Check, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isCloudMode } from '@/lib/mode'
import { isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { isSyncingAtom, hasDownloadedAllAtom, downloadAllStatusAtom } from '@/atoms/sync-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { SidebarCreditIndicator } from '@/components/billing/SidebarCreditIndicator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * 云端下载全部对话按钮 — 仅 Cloud + chat 模式下显示
 */
function CloudDownloadButton(): React.ReactElement | null {
  const mode = useAtomValue(appModeAtom)
  const isAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const isSyncing = useAtomValue(isSyncingAtom)
  const [hasDownloadedAll, setHasDownloadedAll] = useAtom(hasDownloadedAllAtom)
  const [downloadAllStatus, setDownloadAllStatus] = useAtom(downloadAllStatusAtom)

  // 初始化：检查是否已执行过"下载全部对话"
  React.useEffect(() => {
    if (!isCloudMode() || !isAuthenticated) return
    window.electronAPI.sync
      .getSyncState()
      .then((state) => {
        if (state.lastDownloadAllAt) {
          setHasDownloadedAll(true)
        }
      })
      .catch(console.error)
  }, [isAuthenticated, setHasDownloadedAll])

  const handleDownloadAll = async (): Promise<void> => {
    try {
      setDownloadAllStatus('idle')
      const result = await window.electronAPI.sync.downloadAllConversations()
      if (result.success) {
        setDownloadAllStatus('success')
        setHasDownloadedAll(true)
        setTimeout(() => setDownloadAllStatus('idle'), 3000)
      } else {
        setDownloadAllStatus('error')
        setTimeout(() => setDownloadAllStatus('idle'), 5000)
      }
    } catch (error) {
      console.error('[侧边栏] 下载全部对话失败:', error)
      setDownloadAllStatus('error')
      setTimeout(() => setDownloadAllStatus('idle'), 5000)
    }
  }

  if (mode !== 'chat' || !isCloudMode() || !isAuthenticated) return null
  if (hasDownloadedAll && downloadAllStatus === 'idle') return null

  return (
    <div className="px-3 pb-1">
      {downloadAllStatus === 'success' ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-green-600 dark:text-green-400">
          <Check size={14} />
          <span>下载完成</span>
        </div>
      ) : downloadAllStatus === 'error' ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-destructive">
          <CircleAlert size={14} />
          <span>下载失败，请稍后重试</span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={handleDownloadAll}
            disabled={isSyncing}
            className={cn(
              'flex-1 flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] transition-colors titlebar-no-drag',
              isSyncing
                ? 'text-foreground/30 cursor-not-allowed'
                : 'text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70'
            )}
          >
            <CloudDownload size={14} className={isSyncing ? 'animate-pulse' : ''} />
            <span>{isSyncing ? '正在下载...' : '从云端下载全部对话'}</span>
          </button>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-shrink-0 p-1 text-foreground/30 cursor-help">
                  <Info size={13} />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[200px] text-xs">
                目前暂不提供对话上传，仅支持下载，架构完成升级后将考虑支持此功能
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  )
}

/**
 * Cloud 侧边栏扩展 — LeftSidebar 中只需插入此组件
 *
 * 内部自动判断 isCloudMode()，非 Cloud 模式渲染为空。
 * 包含两部分：
 * - 下载全部对话按钮（列表区下方）
 * - 余额指示器（底部用户资料上方）
 */
export function CloudSidebarDownloadButton(): React.ReactElement | null {
  if (!isCloudMode()) return null
  return <CloudDownloadButton />
}

export function CloudSidebarCreditIndicator(): React.ReactElement | null {
  if (!isCloudMode()) return null
  return (
    <div className="px-3">
      <SidebarCreditIndicator />
    </div>
  )
}
