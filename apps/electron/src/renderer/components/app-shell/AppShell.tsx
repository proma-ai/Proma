/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 可折叠] | [MainArea: TabBar + SplitContainer] | [RightSidePanel 可折叠]
 *
 * MainArea 支持多标签页 + 分屏，Settings 视图为独立覆盖。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { conversationsAtom, syncProgressAtom, isSyncingAtom, lastSyncResultAtom } from '@/atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import type { SyncProgressEvent } from '@proma/shared'

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

/**
 * 订阅启动自动同步的进度事件
 *
 * 主进程在窗口就绪后自动触发增量同步，
 * 这里只负责监听进度并在完成后刷新对话列表。
 */
function useSyncProgressListener(): void {
  const setConversations = useSetAtom(conversationsAtom)
  const setSyncProgress = useSetAtom(syncProgressAtom)
  const setIsSyncing = useSetAtom(isSyncingAtom)
  const setLastSyncResult = useSetAtom(lastSyncResultAtom)

  React.useEffect(() => {
    const cleanup = window.electronAPI.sync.onSyncProgress((event: SyncProgressEvent) => {
      setSyncProgress(event)

      if (event.phase === 'pulling' || event.phase === 'pushing' || event.phase === 'merging') {
        setIsSyncing(true)
      }

      if (event.phase === 'done') {
        setIsSyncing(false)
        // 同步完成后刷新对话列表
        window.electronAPI
          .listConversations()
          .then(setConversations)
          .catch(console.error)
      }

      if (event.phase === 'error') {
        setIsSyncing(false)
        console.warn('[同步] 同步失败:', event.error)
      }
    })

    return cleanup
  }, [setConversations, setSyncProgress, setIsSyncing, setLastSyncResult])
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  // 监听主进程自动同步的进度事件
  useSyncProgressListener()

  const appMode = useAtomValue(appModeAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const showRightPanel = appMode === 'agent' && !!currentSessionId
  const isPanelOpen = currentSessionId ? (sidePanelOpenMap.get(currentSessionId) ?? true) : false

  return (
    <AppShellProvider value={contextValue}>
      {/* 可拖动标题栏区域，用于窗口拖动 */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-50" />

      <div className="shell-bg h-screen w-screen flex overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        {/* 左侧边栏：可折叠，带圆角和内边距 */}
        <div className="p-2 pr-0 relative z-[60]">
          <LeftSidebar />
        </div>

        {/* 中间容器：relative z-[60] 使其在 z-50 拖动区域之上 */}
        <div className="flex-1 min-w-0 p-2 relative z-[60]">
          {/* 主内容区域（TabBar + SplitContainer） */}
          <MainArea />
        </div>

        {/* 右侧边栏：Agent 文件面板，带圆角和内边距 */}
        {showRightPanel && (
          <div className={cn('relative z-[60] transition-[padding] duration-300 ease-in-out', isPanelOpen ? 'p-2 pl-0' : 'p-0')}>
            <RightSidePanel />
          </div>
        )}
      </div>
    </AppShellProvider>
  )
}
