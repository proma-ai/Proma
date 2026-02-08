/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 280px] | [MainContentPanel 浮动效果]
 *
 * MainContentPanel 根据当前 App 模式（Chat/Agent）自动渲染对应内容
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { MainContentPanel } from './MainContentPanel'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { conversationsAtom, syncProgressAtom, isSyncingAtom, lastSyncResultAtom } from '@/atoms'
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
  return (
    <AppShellProvider value={contextValue}>
      {/* 可拖动标题栏区域，用于窗口拖动 */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-50" />

      <div className="h-screen w-screen flex overflow-hidden bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        {/* 左侧边栏：默认 280px，放大时可收缩到最小 180px */}
        <LeftSidebar />

        {/* 右侧容器：relative z-[60] 使其在 z-50 拖动区域之上；titlebar-no-drag 标记非拖动区域 */}
        <div className="flex-1 min-w-0 p-2 relative z-[60] titlebar-no-drag">
          {/* 主内容面板（根据模式自动切换内容） */}
          <MainContentPanel />
        </div>
      </div>
    </AppShellProvider>
  )
}
