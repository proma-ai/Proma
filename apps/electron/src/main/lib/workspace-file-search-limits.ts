/**
 * 右侧文件搜索的扫描边界。
 *
 * 搜索在 Electron 主进程中按需同步建立短期索引；边界必须保持有限，
 * 避免超大工作区的首次搜索长时间阻塞主进程。
 */
export const WORKSPACE_FILE_SEARCH_MAX_DEPTH = 10
export const WORKSPACE_FILE_SEARCH_INDEX_ENTRY_CAP_PER_GROUP = 15_000

/**
 * 判断文件搜索索引是否已达到递归深度或单来源条目上限。
 */
export function shouldStopWorkspaceFileSearchScan(depth: number, entryCount: number): boolean {
  return depth > WORKSPACE_FILE_SEARCH_MAX_DEPTH
    || entryCount >= WORKSPACE_FILE_SEARCH_INDEX_ENTRY_CAP_PER_GROUP
}
