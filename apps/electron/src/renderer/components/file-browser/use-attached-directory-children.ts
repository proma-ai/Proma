import * as React from 'react'
import type { FileEntry } from '@proma/shared'

interface AttachedDirectoryChildrenOptions {
  stateKey: string
  path: string
  sessionId: string
  allowedPaths?: string[]
  expanded: boolean
  isDirectory: boolean
  refreshVersion: number
}

interface DirectorySnapshot {
  identity: string
  children: FileEntry[]
}

const EMPTY_CHILDREN: FileEntry[] = []

/**
 * 展开、恢复与刷新共用一条加载路径。折叠/卸载/切换上下文时丢弃旧响应，
 * IPC 完成只更新子项，不反向打开用户已收起的目录。
 */
export function useAttachedDirectoryChildren({ stateKey, path, sessionId, allowedPaths, expanded, isDirectory, refreshVersion }: AttachedDirectoryChildrenOptions) {
  const allowedPathsKey = JSON.stringify(allowedPaths ?? [])
  const identity = JSON.stringify([stateKey, path, sessionId, allowedPathsKey])
  const [snapshot, setSnapshot] = React.useState<DirectorySnapshot | null>(null)
  const [errorState, setErrorState] = React.useState<{ identity: string; message: string } | null>(null)

  React.useEffect(() => {
    if (!expanded || !isDirectory) return
    let cancelled = false
    setErrorState(null)
    void window.electronAPI.listAttachedDirectory(path, {
      sessionId,
      candidateBasePaths: JSON.parse(allowedPathsKey) as string[],
    }).then((children) => {
      if (!cancelled) setSnapshot({ identity, children })
    }).catch((error: unknown) => {
      if (cancelled) return
      console.error('[AttachedDirectory] 加载子目录失败:', error)
      setErrorState({ identity, message: '加载失败，请收起后重新展开重试' })
    })
    return () => { cancelled = true }
  }, [identity, path, sessionId, allowedPathsKey, expanded, isDirectory, refreshVersion])

  // 物理路径或授权上下文切换的第一帧也不能显示上一目录的内容。
  return {
    children: snapshot?.identity === identity ? snapshot.children : EMPTY_CHILDREN,
    loaded: snapshot?.identity === identity,
    error: errorState?.identity === identity ? errorState.message : null,
  }
}
