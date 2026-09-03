/**
 * FileBrowser 异步根目录加载的纯状态判断。
 *
 * 请求无法由 IPC 取消，因此渲染层以单调递增的代次拒绝过期结果；
 * 空态只在当前根目录至少成功加载一次后展示，后台刷新期间保持已确认的空态。
 */

export interface FileBrowserEmptyStateInput {
  /** 当前 FileBrowser 实际消费的根目录稳定签名。 */
  currentRootsKey: string
  /** 最近一次成功完成目录读取的根目录签名。 */
  loadedRootsKey: string | null
  entryCount: number
  hasError: boolean
  hideEmpty: boolean | undefined
}

/** 只有仍属于最新加载代次的异步结果才能写回文件树状态。 */
export function isCurrentFileBrowserLoadRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId
}

/**
 * 判断是否展示“目录为空”。
 *
 * 不以 loading 为条件：已确认为空的目录在 watcher 触发后台刷新时应保持稳定，
 * 避免“目录为空”文案和下方上传区反复出现、消失而造成面板闪烁。
 */
export function shouldShowFileBrowserEmptyState({
  currentRootsKey,
  loadedRootsKey,
  entryCount,
  hasError,
  hideEmpty,
}: FileBrowserEmptyStateInput): boolean {
  return !hasError
    && !hideEmpty
    && entryCount === 0
    && loadedRootsKey === currentRootsKey
}
