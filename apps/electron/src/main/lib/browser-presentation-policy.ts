export function isNewBrowserTabLayoutRevision(revision: number, previousRevision: number): boolean {
  return Number.isSafeInteger(revision) && revision > previousRevision
}

export function canBrowserSessionTakeForeground(input: {
  incomingSessionId: string
  foregroundSessionId: string | null
  revision: number
  latestForegroundRevision: number
}): boolean {
  return input.incomingSessionId === input.foregroundSessionId
    || input.revision > input.latestForegroundRevision
}

/**
 * 隐藏避让请求是否应随 IPC 返回静态占位快照：
 * 只有“真实尺寸的隐藏”（零尺寸是卸载清理）且该 tab 此刻正展示给用户时才有意义。
 */
export function shouldReturnLayoutSnapshotOnHide(input: {
  visible: boolean
  boundsWidth: number
  boundsHeight: number
  tabCurrentlyVisible: boolean
  isPresented: boolean
}): boolean {
  return !input.visible
    && input.boundsWidth > 4
    && input.boundsHeight > 4
    && input.tabCurrentlyVisible
    && input.isPresented
}
