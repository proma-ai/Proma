export type FileScope = 'project' | 'session'

/** 每个附加根独立保存，增删/重排其他根不会改变 key；兼容按会话清理的前缀。 */
export function getAttachedDirectoryStateKey(sessionId: string, scope: FileScope, rootPath: string): string {
  return `${sessionId}\u0002attached\u0002${scope}\u0000${rootPath}`
}

export interface FileBrowserRoot {
  path: string
  scope: FileScope
}

/**
 * 将 FileBrowser 实际消费的根目录属性编码成稳定签名。
 * 调用方常在 render 中临时拼接 roots；同一组根目录不应因此触发目录重新加载。
 */
export function getFileBrowserRootsKey(roots: readonly FileBrowserRoot[] | undefined): string {
  return JSON.stringify(
    (roots ?? [])
      .filter((root) => Boolean(root.path))
      .map(({ scope, path }) => [scope, path]),
  )
}

/** 从稳定签名恢复目录列表，供 useMemo 避免捕获每次 render 都会新建的 roots 数组。 */
export function getFileBrowserRootsFromKey(rootsKey: string, rootPath: string | undefined): FileBrowserRoot[] {
  const roots = JSON.parse(rootsKey) as Array<[FileScope, string]>
  if (roots.length > 0) return roots.map(([scope, path]) => ({ scope, path }))
  return rootPath ? [{ path: rootPath, scope: 'project' }] : []
}
